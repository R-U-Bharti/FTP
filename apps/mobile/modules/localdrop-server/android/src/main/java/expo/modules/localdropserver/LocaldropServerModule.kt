package expo.modules.localdropserver

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.ServerSocket
import java.net.Socket
import java.io.OutputStream
import java.io.InputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.BufferedOutputStream
import java.io.RandomAccessFile
import java.util.zip.ZipOutputStream
import java.util.zip.ZipEntry
import java.util.zip.Deflater
import java.nio.channels.Channels
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.os.Environment
import kotlinx.coroutines.*
import java.net.URLDecoder

class LocaldropServerModule : Module() {
  private var serverSocket: ServerSocket? = null
  private var serverJob: Job? = null
  private val coroutineScope = CoroutineScope(Dispatchers.IO)

  // Root directory currently shared by the app (file:// path or content:// tree/document URI).
  // Set from JS via setSharedRoot() so uploads that target the explorer "root" (".") can be resolved.
  @Volatile private var sharedRootUri: String? = null

  override fun definition() = ModuleDefinition {
    Name("LocaldropServer")

    AsyncFunction("startServer") { port: Int ->
      if (serverSocket != null) {
        true
      } else {
        try {
          serverSocket = ServerSocket(port)
          serverSocket!!.receiveBufferSize = 4 * 1024 * 1024
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
          appContext.reactContext?.let { LocaldropServerService.start(it) }
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
      appContext.reactContext?.let { LocaldropServerService.stop(it) }
      true
    }

    // Lets JS tell the native server which folder is currently "shared" so that
    // uploads targeting "." (the explorer root) can be written to the right place.
    AsyncFunction("setSharedRoot") { uri: String ->
      sharedRootUri = uri
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
      socket.receiveBufferSize = 4 * 1024 * 1024
      socket.tcpNoDelay = true

      // Wrap the raw stream ONCE. We parse the header block byte-by-byte off this
      // same buffered stream, then read the (possibly binary) request body from it —
      // never a BufferedReader, which would swallow body bytes into its char buffer.
      val input = BufferedInputStream(socket.getInputStream(), 64 * 1024)
      val rawOutput = socket.getOutputStream()

      // ── Read the HTTP header block (up to the blank CRLFCRLF line) ──
      val headerText = StringBuilder()
      var b: Int
      while (true) {
        b = input.read()
        if (b == -1) break
        headerText.append(b.toChar())
        val len = headerText.length
        if (len >= 4 &&
          headerText[len - 4] == '\r' && headerText[len - 3] == '\n' &&
          headerText[len - 2] == '\r' && headerText[len - 1] == '\n'
        ) break
        if (len > 32 * 1024) { sendError(rawOutput, 431, "Headers Too Large"); return } // guard
      }
      if (headerText.isEmpty()) return

      val lines = headerText.toString().split("\r\n")
      val requestLine = lines.firstOrNull() ?: return
      val headers = mutableMapOf<String, String>()
      for (i in 1 until lines.size) {
        val line = lines[i]
        if (line.isEmpty()) continue
        val colonIndex = line.indexOf(':')
        if (colonIndex > 0) {
          val key = line.substring(0, colonIndex).trim().lowercase()
          val value = line.substring(colonIndex + 1).trim()
          headers[key] = value
        }
      }

      val parts = requestLine.split(" ")
      if (parts.size < 2) return
      val method = parts[0].uppercase()
      val pathWithArgs = parts[1]

      // ── CORS preflight (browser sends this before the PUT/POST with custom headers) ──
      if (method == "OPTIONS") {
        sendCorsPreflight(rawOutput)
        return
      }

      // ── PC → phone upload ──
      if (method == "POST" && pathWithArgs.startsWith("/upload")) {
        handleUpload(input, rawOutput, headers)
        return
      }

      if (method != "GET") {
        sendError(rawOutput, 405, "Method Not Allowed")
        return
      }

      if (pathWithArgs.startsWith("/zip?")) {
        handleZipRequest(rawOutput, pathWithArgs)
        return
      }

      if (!pathWithArgs.startsWith("/download?uri=")) {
        sendError(rawOutput, 404, "Not Found")
        return
      }

      handleDownload(rawOutput, pathWithArgs, headers)

    } catch (e: Exception) {
      e.printStackTrace()
    } finally {
      try {
        socket.close()
      } catch (e: Exception) {}
    }
  }

  private fun handleDownload(rawOutput: OutputStream, pathWithArgs: String, headers: Map<String, String>) {
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
        "Access-Control-Allow-Origin: *\r\n" +
        "Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\r\n"
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
        "Access-Control-Allow-Origin: *\r\n" +
        "Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n\r\n"
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
        val toTransfer = minOf(endPosition - position, 16L * 1024 * 1024) // 16MB chunks
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
  }

  // ── PC → phone upload: stream the raw request body straight to disk ──
  private fun handleUpload(input: InputStream, output: OutputStream, headers: Map<String, String>) {
    val context = appContext.reactContext
    if (context == null) {
      sendJson(output, 500, "{\"error\":\"No app context\"}")
      return
    }

    val contentLength = headers["content-length"]?.toLongOrNull() ?: -1L
    val fileName = try {
      URLDecoder.decode(headers["x-file-name"] ?: "upload.bin", "UTF-8")
    } catch (e: Exception) { "upload.bin" }
      .let { sanitizeName(it) }

    var targetDir = try {
      URLDecoder.decode(headers["x-target-dir"] ?: "", "UTF-8")
    } catch (e: Exception) { "" }

    // The explorer "root" is sent as "." — resolve it to whatever folder is shared.
    if (targetDir.isEmpty() || targetDir == ".") {
      targetDir = sharedRootUri ?: ""
    }

    if (targetDir.isEmpty()) {
      drain(input, contentLength)
      sendJson(output, 400, "{\"error\":\"No shared folder selected on the phone\"}")
      return
    }

    try {
      if (targetDir.startsWith("content://")) {
        writeToSaf(context, input, output, targetDir, fileName, contentLength)
      } else {
        val dirPath = if (targetDir.startsWith("file://")) targetDir.substring(7) else targetDir
        val dir = File(dirPath)
        if (!dir.exists()) dir.mkdirs()
        if (!dir.isDirectory) {
          drain(input, contentLength)
          sendJson(output, 400, "{\"error\":\"Target is not a directory\"}")
          return
        }

        val totalSize = headers["x-total-size"]?.toLongOrNull() ?: -1L
        val offset = headers["x-offset"]?.toLongOrNull() ?: -1L

        if (totalSize >= 0 && offset >= 0) {
          // Parallel/positional write: fixed name, preallocate to full size, seek + write this part.
          // Multiple connections write disjoint regions of the same file concurrently.
          val outFile = File(dir, fileName)
          val raf = RandomAccessFile(outFile, "rw")
          try {
            if (raf.length() < totalSize) raf.setLength(totalSize)
            raf.seek(offset)
            copyExactToRaf(input, raf, contentLength)
          } finally {
            raf.close()
          }
          sendJson(output, 200, "{\"success\":true,\"name\":\"${jsonEscape(fileName)}\"}")
        } else {
          val outFile = uniqueFile(dir, fileName)
          FileOutputStream(outFile).use { fos ->
            BufferedOutputStream(fos, 4 * 1024 * 1024).use { bos ->
              copyExact(input, bos, contentLength)
              bos.flush()
            }
          }
          sendJson(output, 200, "{\"success\":true,\"name\":\"${jsonEscape(outFile.name)}\"}")
        }
      }
    } catch (e: Exception) {
      e.printStackTrace()
      sendJson(output, 500, "{\"error\":\"${jsonEscape(e.message ?: "upload failed")}\"}")
    }
  }

  // Write into a Storage-Access-Framework folder (content:// tree/document URI).
  private fun writeToSaf(
    context: Context,
    input: InputStream,
    output: OutputStream,
    dirUri: String,
    fileName: String,
    length: Long,
  ) {
    try {
      val parentUri = Uri.parse(dirUri)
      // Resolve the parent to a *document* URI (createDocument needs a document, not a raw tree).
      val docUri = if (DocumentsContract.isTreeUri(parentUri) && !DocumentsContract.isDocumentUri(context, parentUri)) {
        DocumentsContract.buildDocumentUriUsingTree(parentUri, DocumentsContract.getTreeDocumentId(parentUri))
      } else {
        parentUri
      }

      val newFileUri = DocumentsContract.createDocument(
        context.contentResolver, docUri, "application/octet-stream", fileName,
      )
      if (newFileUri == null) {
        drain(input, length)
        sendJson(output, 500, "{\"error\":\"Could not create file in shared folder\"}")
        return
      }

      context.contentResolver.openOutputStream(newFileUri)?.use { os ->
        BufferedOutputStream(os, 4 * 1024 * 1024).use { bos ->
          copyExact(input, bos, length)
          bos.flush()
        }
      } ?: run {
        sendJson(output, 500, "{\"error\":\"Could not open output stream\"}")
        return
      }
      sendJson(output, 200, "{\"success\":true,\"name\":\"${jsonEscape(fileName)}\"}")
    } catch (e: Exception) {
      e.printStackTrace()
      drain(input, length)
      sendJson(output, 500, "{\"error\":\"SAF write failed: ${jsonEscape(e.message ?: "")}\"}")
    }
  }

  // Copy exactly `length` bytes (or until EOF if length < 0) from input to output.
  private fun copyExact(input: InputStream, output: OutputStream, length: Long) {
    val buffer = ByteArray(4 * 1024 * 1024)
    if (length < 0) {
      var read: Int
      while (input.read(buffer).also { read = it } != -1) output.write(buffer, 0, read)
      return
    }
    var remaining = length
    while (remaining > 0) {
      val toRead = minOf(buffer.size.toLong(), remaining).toInt()
      val read = input.read(buffer, 0, toRead)
      if (read == -1) break
      output.write(buffer, 0, read)
      remaining -= read
    }
  }

  // Positional copy of exactly `length` bytes into a RandomAccessFile at its current seek position.
  private fun copyExactToRaf(input: InputStream, raf: RandomAccessFile, length: Long) {
    val buffer = ByteArray(4 * 1024 * 1024)
    var remaining = length
    while (remaining > 0) {
      val toRead = minOf(buffer.size.toLong(), remaining).toInt()
      val read = input.read(buffer, 0, toRead)
      if (read == -1) break
      raf.write(buffer, 0, read)
      remaining -= read
    }
  }

  // Consume and discard `length` bytes of body so the connection can be closed cleanly on error.
  private fun drain(input: InputStream, length: Long) {
    try {
      val buffer = ByteArray(64 * 1024)
      if (length < 0) return
      var remaining = length
      while (remaining > 0) {
        val toRead = minOf(buffer.size.toLong(), remaining).toInt()
        val read = input.read(buffer, 0, toRead)
        if (read == -1) break
        remaining -= read
      }
    } catch (e: Exception) {}
  }

  // Avoid clobbering an existing file: "name.ext" → "name (1).ext", "name (2).ext", ...
  private fun uniqueFile(dir: File, name: String): File {
    var candidate = File(dir, name)
    if (!candidate.exists()) return candidate
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var i = 1
    while (candidate.exists() && i < 10000) {
      candidate = File(dir, "$base ($i)$ext")
      i++
    }
    return candidate
  }

  private fun sanitizeName(name: String): String {
    // Strip any path components and characters that are illegal in file names.
    val base = name.substringAfterLast('/').substringAfterLast('\\')
    val cleaned = base.replace(Regex("[\\x00-\\x1f/\\\\:*?\"<>|]"), "_").trim()
    return if (cleaned.isEmpty()) "upload.bin" else cleaned
  }

  private fun jsonEscape(s: String): String =
    s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ")

  private fun sendCorsPreflight(output: OutputStream) {
    val response = "HTTP/1.1 204 No Content\r\n" +
      "Access-Control-Allow-Origin: *\r\n" +
      "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
      "Access-Control-Allow-Headers: *\r\n" +
      "Access-Control-Max-Age: 86400\r\n" +
      "Content-Length: 0\r\n" +
      "Connection: close\r\n\r\n"
    output.write(response.toByteArray())
    output.flush()
  }

  private fun sendJson(output: OutputStream, code: Int, body: String) {
    val bodyBytes = body.toByteArray()
    val response = "HTTP/1.1 $code ${statusText(code)}\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: ${bodyBytes.size}\r\n" +
      "Access-Control-Allow-Origin: *\r\n" +
      "Connection: close\r\n\r\n"
    output.write(response.toByteArray())
    output.write(bodyBytes)
    output.flush()
  }

  private fun statusText(code: Int): String = when (code) {
    200 -> "OK"
    204 -> "No Content"
    400 -> "Bad Request"
    404 -> "Not Found"
    405 -> "Method Not Allowed"
    431 -> "Request Header Fields Too Large"
    500 -> "Internal Server Error"
    else -> "Error"
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
    val response = "HTTP/1.1 $code $message\r\n" +
      "Access-Control-Allow-Origin: *\r\n" +
      "Connection: close\r\n\r\n"
    output.write(response.toByteArray())
    output.flush()
  }
}
