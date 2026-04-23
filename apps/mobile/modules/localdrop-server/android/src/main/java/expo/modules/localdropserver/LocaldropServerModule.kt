package expo.modules.localdropserver

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.ServerSocket
import java.net.Socket
import java.io.OutputStream
import java.io.InputStream
import java.io.File
import java.io.FileInputStream
import android.net.Uri
import android.provider.OpenableColumns
import android.content.Intent
import android.provider.Settings
import android.os.Environment
import kotlinx.coroutines.*
import java.net.URLDecoder

class LocaldropServerModule : Module() {
  private var serverSocket: ServerSocket? = null
  private var serverJob: Job? = null
  private val coroutineScope = CoroutineScope(Dispatchers.IO)

  override fun definition() = ModuleDefinition {
    Name("LocaldropServer")

    AsyncFunction("startServer") { port: Int ->
      if (serverSocket != null) {
        true
      } else {
        try {
          serverSocket = ServerSocket(port)
          serverJob = coroutineScope.launch {
            while (isActive) {
              try {
                val socket = serverSocket?.accept() ?: break
                launch { handleClient(socket) }
              } catch (e: Exception) {
                break
              }
            }
          }
          true
        } catch (e: Exception) {
          false
        }
      }
    }

    AsyncFunction("stopServer") {
      serverJob?.cancel()
      serverSocket?.close()
      serverSocket = null
      true
    }

    AsyncFunction("requestAllFilesAccess") {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        if (!Environment.isExternalStorageManager()) {
          val context = appContext.reactContext
          if (context != null) {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
            intent.data = Uri.parse("package:" + context.packageName)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            false
          } else {
            false
          }
        } else {
          true
        }
      } else {
        true
      }
    }
  }

  private fun handleClient(socket: Socket) {
    try {
      val input = socket.getInputStream().bufferedReader()
      val output = socket.getOutputStream()
      
      val requestLine = input.readLine() ?: return
      if (!requestLine.startsWith("GET ")) {
        sendError(output, 405, "Method Not Allowed")
        return
      }

      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val pathWithArgs = parts[1]
      
      if (!pathWithArgs.startsWith("/download?uri=")) {
        sendError(output, 404, "Not Found")
        return
      }

      val encodedUri = pathWithArgs.substringAfter("/download?uri=")
      val decodedUriStr = URLDecoder.decode(encodedUri, "UTF-8")

      val context = appContext.reactContext ?: return
      
      var fileSize: Long = 0
      var fileName = "downloaded_file"
      var inputStream: InputStream? = null
      
      if (decodedUriStr.startsWith("content://")) {
        val uri = Uri.parse(decodedUriStr)
        try {
          context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
              val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
              if (sizeIndex != -1) fileSize = cursor.getLong(sizeIndex)
              val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
              if (nameIndex != -1) fileName = cursor.getString(nameIndex)
            }
          }
          inputStream = context.contentResolver.openInputStream(uri)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      } else {
        // Handle raw file paths (file:// or /storage/...)
        val path = if (decodedUriStr.startsWith("file://")) decodedUriStr.substring(7) else decodedUriStr
        val file = File(path)
        if (file.exists()) {
          fileSize = file.length()
          fileName = file.name
          inputStream = FileInputStream(file)
        }
      }

      if (inputStream == null) {
        sendError(output, 404, "File Not Found")
        return
      }

      val headers = """
        HTTP/1.1 200 OK
        Content-Type: application/octet-stream
        Content-Disposition: attachment; filename="${fileName}"
        Content-Length: $fileSize
        Connection: close
        Access-Control-Allow-Origin: *
        
      """.trimIndent().replace("\n", "\r\n") + "\r\n"

      output.write(headers.toByteArray())
      
      val buffer = ByteArray(1024 * 1024) // 1MB buffer
      var bytesRead: Int
      inputStream.use { stream ->
        while (stream.read(buffer).also { bytesRead = it } != -1) {
          output.write(buffer, 0, bytesRead)
        }
      }
      
      output.flush()

    } catch (e: Exception) {
      e.printStackTrace()
    } finally {
      try {
        socket.close()
      } catch (e: Exception) {}
    }
  }

  private fun sendError(output: OutputStream, code: Int, message: String) {
    val response = "HTTP/1.1 $code $message\r\nConnection: close\r\n\r\n"
    output.write(response.toByteArray())
    output.flush()
  }
}
