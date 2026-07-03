package expo.modules.localdropserver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Foreground service + wake lock that keeps the process (JS socket + native HTTP
 * server) alive while the screen is locked, until the app is closed / stopServer.
 */
class LocaldropServerService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIF_ID, notification)
    }

    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LocalDrop::ServerWakeLock").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    wakeLock = null
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val channelId = "localdrop_server"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(channelId) == null) {
        nm.createNotificationChannel(
          NotificationChannel(channelId, "LocalDrop Server", NotificationManager.IMPORTANCE_LOW),
        )
      }
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(this)
    }
    return builder
      .setContentTitle("LocalDrop is active")
      .setContentText("Keeping the connection alive while locked")
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val NOTIF_ID = 4231

    fun start(context: Context) {
      val intent = Intent(context, LocaldropServerService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LocaldropServerService::class.java))
    }
  }
}
