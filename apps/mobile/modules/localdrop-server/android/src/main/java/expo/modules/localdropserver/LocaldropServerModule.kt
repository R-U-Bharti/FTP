package expo.modules.localdropserver

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.ServerSocket
import java.net.Socket
import java.io.OutputStream
import java.io.InputStream
import java.io.File
import java.io.FileInputStream
import java.io.BufferedOutputStream
import java.io.RandomAccessFile
import java.util.zip.ZipOutputStream
import java.util.zip.ZipEntry
import java.util.zip.Deflater
import java.nio.channels.Channels
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
          serverSocket!!.receiveBufferSize = 64 * 1024
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
      socket.sendBufferSize = 4 * 1024 * 1024  // 4MB kernel send buffer
      
      val rawInput = socket.getInputStream()
      val rawOutput = socket.getOutputStream()
      
      // Read ALL HTTP headers (IDM sends Range, Connection, etc.)
      val reader = rawInput.bufferedReader()
      val requestLine = reader.readLine() ?: return
      if (!requestLine.startsWith("GET ")) {
        sendError(rawOutput, 405, "Method Not Allowed")
        return
      }

      // Parse all headers
      val headers = mutableMapOf<String, String>()
      var headerLine = reader.readLine()
      while (headerLine != null && headerLine.isNotEmpty()) {
        val colonIndex = headerLine.indexOf(':')
        if (colonIndex > 0) {
          val key = headerLine.substring(0, colonIndex).trim().lowercase()
          val value = headerLine.substring(colonIndex + 1).trim()
          headers[key] = value
        }
        headerLine = reader.readLine()
      }

      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val pathWithArgs = parts[1]
      
      if (pathWithArgs.startsWith("/zip?")) {
        handleZipRequest(rawOutput, pathWithArgs)
        return
      }
      
      if (!pathWithArgs.startsWith("/download?uri=")) {
        sendError(rawOutput, 404, "Not Found")
        return
      }

      val encodedUri = pathWithArgs.substringAfter("/download?uri=")
      val decodedUriStr = URLDecoder.decode(encodedUri, "UTF-8")

      val context = appContext.reactContext ?: return
      
      var fileSize: Long = 0
      var fileName = "downloaded_file"
      var filePath: String? = null
      var contentStream: InputStream? = null
      
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
          contentStream = context.contentResolver.openInputStream(uri)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      } else {
        val path = if (decodedUriStr.startsWith("file://")) decodedUriStr.substring(7) else decodedUriStr
        val file = File(path)
        if (file.exists()) {
          fileSize = file.length()
          fileName = file.name
          filePath = path  // Store path for RandomAccessFile (Range support)
        }
      }

      if (filePath == null && contentStream == null) {
        sendError(rawOutput, 404, "File Not Found")
        return
      }

      // === PARSE RANGE HEADER (for IDM multi-threaded downloads) ===
      val rangeHeader = headers["range"]  // e.g. "bytes=0-1048575"
      var rangeStart: Long = 0
      var rangeEnd: Long = fileSize - 1
      var isRangeRequest = false
      
      if (rangeHeader != null && rangeHeader.startsWith("bytes=") && filePath != null) {
        isRangeRequest = true
        val rangeSpec = rangeHeader.substring(6) // remove "bytes="
        val rangeParts = rangeSpec.split("-")
        if (rangeParts.size == 2) {
          if (rangeParts[0].isNotEmpty()) {
            rangeStart = rangeParts[0].toLong()
          }
          if (rangeParts[1].isNotEmpty()) {
            rangeEnd = rangeParts[1].toLong()
          } else {
            rangeEnd = fileSize - 1
          }
        }
        // Clamp to valid range
        if (rangeEnd >= fileSize) rangeEnd = fileSize - 1
        if (rangeStart > rangeEnd) rangeStart = 0
      }
      
      val contentLength = if (isRangeRequest) (rangeEnd - rangeStart + 1) else fileSize

      if (isRangeRequest) {
        // 206 Partial Content — IDM multi-thread mode
        val responseHeaders = "HTTP/1.1 206 Partial Content\r\n" +
          "Content-Type: application/octet-stream\r\n" +
          "Content-Disposition: attachment; filename=\"${fileName}\"\r\n" +
          "Content-Length: $contentLength\r\n" +
          "Content-Range: bytes $rangeStart-$rangeEnd/$fileSize\r\n" +
          "Accept-Ranges: bytes\r\n" +
          "Connection: close\r\n" +
          "Access-Control-Allow-Origin: *\r\n\r\n"
        rawOutput.write(responseHeaders.toByteArray())
        rawOutput.flush()
      } else {
        // 200 OK — Full file download (single thread or browser)
        val responseHeaders = "HTTP/1.1 200 OK\r\n" +
          "Content-Type: application/octet-stream\r\n" +
          "Content-Disposition: attachment; filename=\"${fileName}\"\r\n" +
          "Content-Length: $fileSize\r\n" +
          "Accept-Ranges: bytes\r\n" +
          "Connection: close\r\n" +
          "Access-Control-Allow-Origin: *\r\n\r\n"
        rawOutput.write(responseHeaders.toByteArray())
        rawOutput.flush()
      }
      
      if (filePath != null) {
        // === ZERO-COPY with Range support ===
        // Use FileChannel.transferTo() → maps to Linux sendfile() syscall
        val raf = RandomAccessFile(filePath, "r")
        val fileChannel = raf.channel
        val socketChannel = Channels.newChannel(rawOutput)
        var position = rangeStart
        val endPosition = rangeStart + contentLength
        while (position < endPosition) {
          val toTransfer = minOf(endPosition - position, 8L * 1024 * 1024) // 8MB chunks
          val transferred = fileChannel.transferTo(position, toTransfer, socketChannel)
          if (transferred <= 0) break
          position += transferred
        }
        fileChannel.close()
        raf.close()
      } else if (contentStream != null) {
        // Content URIs can't use zero-copy, use large manual buffer
        val buffer = ByteArray(4 * 1024 * 1024)
        var bytesRead: Int
        contentStream.use { stream ->
          while (stream.read(buffer).also { bytesRead = it } != -1) {
            rawOutput.write(buffer, 0, bytesRead)
          }
        }
      }
      
      rawOutput.flush()

    } catch (e: Exception) {
      e.printStackTrace()
    } finally {
      try {
        socket.close()
      } catch (e: Exception) {}
    }
  }

  private fun handleZipRequest(output: OutputStream, pathWithArgs: String) {
    try {
      val query = pathWithArgs.substringAfter("/zip?")
      val paths = query.substringAfter("paths=").split(",").map { URLDecoder.decode(it, "UTF-8") }
      
      val headers = "HTTP/1.1 200 OK\r\n" +
        "Content-Type: application/zip\r\n" +
        "Content-Disposition: attachment; filename=\"localdrop_files.zip\"\r\n" +
        "Connection: close\r\n" +
        "Access-Control-Allow-Origin: *\r\n\r\n"
      
      val bufferedOut = BufferedOutputStream(output, 4 * 1024 * 1024)
      bufferedOut.write(headers.toByteArray())

      val zipOut = ZipOutputStream(bufferedOut)
      zipOut.setLevel(Deflater.NO_COMPRESSION)
      val context = appContext.reactContext ?: return

      paths.forEach { path ->
        if (path.startsWith("content://")) {
          zipContentUri(zipOut, Uri.parse(path), "", context)
        } else {
          val cleanPath = if (path.startsWith("file://")) path.substring(7) else path
          val file = File(cleanPath)
          zipFile(zipOut, file, "")
        }
      }
      
      zipOut.finish()
      zipOut.flush()
      bufferedOut.flush()
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  private fun zipFile(zipOut: ZipOutputStream, file: File, parentPath: String) {
    if (!file.exists() || !file.canRead()) return
    val entryPath = if (parentPath.isEmpty()) file.name else "$parentPath/${file.name}"
    
    if (file.isDirectory) {
      file.listFiles()?.forEach { child ->
        zipFile(zipOut, child, entryPath)
      }
    } else {
      val entry = ZipEntry(entryPath)
      entry.size = file.length()
      zipOut.putNextEntry(entry)
      FileInputStream(file).use { fis ->
        val buffer = ByteArray(4 * 1024 * 1024)
        var bytesRead: Int
        while (fis.read(buffer).also { bytesRead = it } != -1) {
          zipOut.write(buffer, 0, bytesRead)
        }
      }
      zipOut.closeEntry()
    }
  }

  private fun zipContentUri(zipOut: ZipOutputStream, uri: Uri, parentPath: String, context: android.content.Context) {
    try {
      var fileName = "file"
      context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIndex != -1) fileName = cursor.getString(nameIndex)
        }
      }
      val entryPath = if (parentPath.isEmpty()) fileName else "$parentPath/$fileName"
      zipOut.putNextEntry(ZipEntry(entryPath))
      context.contentResolver.openInputStream(uri)?.use { stream ->
        val buffer = ByteArray(4 * 1024 * 1024)
        var bytesRead: Int
        while (stream.read(buffer).also { bytesRead = it } != -1) {
          zipOut.write(buffer, 0, bytesRead)
        }
      }
      zipOut.closeEntry()
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  private fun sendError(output: OutputStream, code: Int, message: String) {
    val response = "HTTP/1.1 $code $message\r\nConnection: close\r\n\r\n"
    output.write(response.toByteArray())
    output.flush()
  }
}
