package dev.ryoku.ryotunes

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import android.util.Size
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Capacitor Native Bridge for Ryotunes:
 * - Runtime storage & notification permissions (Android 13+ READ_MEDIA_AUDIO & <= 12 READ_EXTERNAL_STORAGE)
 * - MediaStore local music scanning (.mp3, .flac, .wav, .ogg, .m4a) + ID3/AlbumArt thumbnail cache
 * - Bidirectional control, system volume & telemetry sync with RyotunesAudioService
 */
@CapacitorPlugin(
    name = "RyotunesNativeMedia",
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO], alias = "audio13"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "audioLegacy"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "visualizerAudio")
    ]
)
class RyotunesNativeMediaPlugin : Plugin(), RyotunesAudioService.ServiceListener {

    private var audioService: RyotunesAudioService? = null
    private var serviceBound = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor: ExecutorService = Executors.newFixedThreadPool(3)

    private data class PendingQueue(
        val tracks: List<NativeTrack>,
        val startIndex: Int,
        val autoPlay: Boolean,
        val startPosition: Double
    )

    private var pendingQueue: PendingQueue? = null

    /** Dispatch service / ExoPlayer operations onto the main looper thread required by Media3. */
    private fun runOnService(call: PluginCall? = null, block: (RyotunesAudioService?) -> Unit) {
        val task = Runnable {
            try {
                block(audioService)
            } catch (e: Exception) {
                call?.reject("Native playback error: ${e.localizedMessage}", e)
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            task.run()
        } else {
            mainHandler.post(task)
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? RyotunesAudioService.LocalBinder ?: return
            audioService = binder.getService().also { svc ->
                svc.attachListener(this@RyotunesNativeMediaPlugin)
                svc.setUiActive(true)
                pendingQueue?.let { (tracks, startIdx, autoPlay, startPos) ->
                    svc.setQueue(tracks, startIdx, autoPlay, startPos)
                    pendingQueue = null
                }
            }
            serviceBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            audioService = null
            serviceBound = false
        }
    }

    override fun load() {
        super.load()
        runOnService { ensureServiceBound() }
    }

    override fun handleOnStart() {
        super.handleOnStart()
        runOnService { it?.setUiActive(true) }
    }

    override fun handleOnStop() {
        runOnService { it?.setUiActive(false) }
        super.handleOnStop()
    }

    override fun handleOnDestroy() {
        runOnService { svc ->
            svc?.setUiActive(false)
            svc?.attachListener(null)
            if (serviceBound) {
                try {
                    context.unbindService(connection)
                } catch (_: Exception) {}
                serviceBound = false
            }
        }
        ioExecutor.shutdownNow()
        super.handleOnDestroy()
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    private fun hasAudioPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPermissionState("audio13") == PermissionState.GRANTED
        } else {
            getPermissionState("audioLegacy") == PermissionState.GRANTED
        }
    }

    @PluginMethod
    fun checkPermissionsStatus(call: PluginCall) {
        val notifOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPermissionState("notifications") == PermissionState.GRANTED
        } else true
        val vizOk = getPermissionState("visualizerAudio") == PermissionState.GRANTED
        call.resolve(JSObject().apply {
            put("audioGranted", hasAudioPermission())
            put("notificationsGranted", notifOk)
            put("visualizerGranted", vizOk)
        })
    }

    @PluginMethod
    fun requestAudioPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val need = mutableListOf<String>()
            if (getPermissionState("audio13") != PermissionState.GRANTED) need.add("audio13")
            if (getPermissionState("notifications") != PermissionState.GRANTED) need.add("notifications")
            if (need.isEmpty()) {
                checkPermissionsStatus(call)
            } else {
                requestPermissionForAliases(need.toTypedArray(), call, "permissionsCallback")
            }
        } else {
            if (getPermissionState("audioLegacy") == PermissionState.GRANTED) {
                checkPermissionsStatus(call)
            } else {
                requestPermissionForAlias("audioLegacy", call, "permissionsCallback")
            }
        }
    }

    @PluginMethod
    fun requestVisualizerPermission(call: PluginCall) {
        if (getPermissionState("visualizerAudio") == PermissionState.GRANTED) {
            runOnService { it?.rebindVisualizerIfPermitted() }
            checkPermissionsStatus(call)
        } else {
            requestPermissionForAlias("visualizerAudio", call, "visualizerCallback")
        }
    }

    @PermissionCallback
    private fun permissionsCallback(call: PluginCall) {
        checkPermissionsStatus(call)
    }

    @PermissionCallback
    private fun visualizerCallback(call: PluginCall) {
        if (getPermissionState("visualizerAudio") == PermissionState.GRANTED) {
            runOnService { it?.rebindVisualizerIfPermitted() }
        }
        checkPermissionsStatus(call)
    }

    // ── MediaStore Local Music Scanner ────────────────────────────────────────

    @PluginMethod
    fun scanLocalMusic(call: PluginCall) {
        if (!hasAudioPermission()) {
            call.reject("Storage audio permission not granted")
            return
        }

        ioExecutor.execute {
            try {
                val results = queryMediaStoreAudio()
                val arr = JSArray()
                for (t in results) {
                    arr.put(t.toJSObject(null))
                }
                val ret = JSObject().apply {
                    put("tracks", arr)
                    put("count", results.size)
                }
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Failed scanning MediaStore: ${e.localizedMessage}", e)
            }
        }
    }

    private fun queryMediaStoreAudio(): List<NativeTrack> {
        val list = mutableListOf<NativeTrack>()
        val resolver = context.contentResolver
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val artCacheDir = File(context.cacheDir, "ryotunes_art").apply { mkdirs() }

        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.IS_MUSIC
        )

        val selection = "${MediaStore.Audio.Media.DURATION} > 3000"
        val sortOrder = "${MediaStore.Audio.Media.DATE_ADDED} DESC"

        resolver.query(uri, projection, selection, null, sortOrder)?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
            val durCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val isMusicCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.IS_MUSIC)

            while (cursor.moveToNext()) {
                val displayName = cursor.getString(nameCol) ?: ""
                val mime = cursor.getString(mimeCol) ?: ""
                val isMusic = cursor.getInt(isMusicCol) != 0

                if (!isSupportedFormat(displayName, mime) && !isMusic) continue

                val id = cursor.getLong(idCol)
                val title = cursor.getString(titleCol)?.takeIf { it.isNotBlank() }
                    ?: displayName.substringBeforeLast('.')
                val artist = cursor.getString(artistCol)?.takeIf { it != "<unknown>" && it.isNotBlank() }
                    ?: "Unknown Artist"
                val album = cursor.getString(albumCol)?.takeIf { it != "<unknown>" && it.isNotBlank() }
                    ?: "Local Device"
                val albumId = cursor.getLong(albumIdCol)
                val durationSec = cursor.getLong(durCol) / 1000.0
                val contentUri = ContentUris.withAppendedId(uri, id)

                val ext = displayName.substringAfterLast('.', "").uppercase().ifEmpty { "AUDIO" }
                val artPath = cacheArtwork(contentUri, albumId, id, artCacheDir)

                list.add(
                    NativeTrack(
                        id = "LOCAL:$id",
                        title = title,
                        artist = artist,
                        album = album,
                        durationSec = durationSec,
                        contentUri = contentUri.toString(),
                        artworkPath = artPath,
                        format = ext
                    )
                )
            }
        }
        return list
    }

    private fun isSupportedFormat(name: String, mime: String): Boolean {
        val lower = name.lowercase()
        if (lower.endsWith(".mp3") || lower.endsWith(".flac") || lower.endsWith(".wav") ||
            lower.endsWith(".ogg") || lower.endsWith(".m4a") || lower.endsWith(".opus") || lower.endsWith(".aac")
        ) {
            return true
        }
        return mime.startsWith("audio/") && !mime.contains("amr")
    }

    private fun cacheArtwork(trackUri: Uri, albumId: Long, trackId: Long, dir: File): String? {
        val outFile = File(dir, "alb_${if (albumId > 0) albumId else trackId}.jpg")
        if (outFile.exists() && outFile.length() > 128) return outFile.absolutePath

        var bmp: Bitmap? = null
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                bmp = try {
                    context.contentResolver.loadThumbnail(trackUri, Size(320, 320), null)
                } catch (_: Exception) {
                    null
                }
            }
            if (bmp == null && albumId > 0) {
                val albumArtUri = ContentUris.withAppendedId(
                    Uri.parse("content://media/external/audio/albumart"),
                    albumId
                )
                bmp = try {
                    context.contentResolver.openInputStream(albumArtUri)?.use { stream ->
                        BitmapFactory.decodeStream(stream)
                    }
                } catch (_: Exception) {
                    null
                }
            }
            if (bmp == null) {
                val mmr = MediaMetadataRetriever()
                try {
                    mmr.setDataSource(context, trackUri)
                    val pic = mmr.embeddedPicture
                    if (pic != null) {
                        bmp = BitmapFactory.decodeByteArray(pic, 0, pic.size)
                    }
                } catch (_: Exception) {
                } finally {
                    try {
                        mmr.release()
                    } catch (_: Exception) {}
                }
            }

            if (bmp != null) {
                val scaled = if (bmp.width > 320 || bmp.height > 320) {
                    Bitmap.createScaledBitmap(bmp, 320, 320, true)
                } else bmp
                FileOutputStream(outFile).use { fos ->
                    scaled.compress(Bitmap.CompressFormat.JPEG, 86, fos)
                }
                if (scaled !== bmp) scaled.recycle()
                bmp.recycle()
                return outFile.absolutePath
            }
        } catch (_: Exception) {
            bmp?.recycle()
        }
        return null
    }

    // ── Playback & System Volume Bridge Methods ───────────────────────────────

    private fun ensureServiceBound() {
        if (!serviceBound) {
            val intent = Intent(context, RyotunesAudioService::class.java)
            context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }
    }

    @PluginMethod
    fun setQueue(call: PluginCall) {
        val arr = call.getArray("tracks") ?: JSArray()
        val startIndex = call.getInt("startIndex", 0) ?: 0
        val autoPlay = call.getBoolean("autoPlay", true) ?: true
        val startPosition = call.getDouble("startPosition") ?: 0.0

        val parsed = mutableListOf<NativeTrack>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            parsed.add(NativeTrack.fromJson(obj))
        }
        runOnService(call) { svc ->
            ensureServiceBound()
            if (svc != null) {
                svc.setQueue(parsed, startIndex, autoPlay, startPosition)
            } else {
                pendingQueue = PendingQueue(parsed, startIndex, autoPlay, startPosition)
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val boundSvc = audioService
        if (serviceBound && boundSvc != null) {
            runOnService(call) { svc ->
                svc?.playImmediate()
                call.resolve()
            }
            return
        }
        runOnService(call) { svc ->
            ensureServiceBound()
            svc?.playImmediate()
            call.resolve()
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        runOnService(call) { svc ->
            svc?.pauseImmediate()
            call.resolve()
        }
    }

    @PluginMethod
    fun togglePlay(call: PluginCall) {
        val boundSvc = audioService
        if (serviceBound && boundSvc != null) {
            runOnService(call) { svc ->
                svc?.togglePlayImmediate()
                call.resolve()
            }
            return
        }
        runOnService(call) { svc ->
            ensureServiceBound()
            svc?.togglePlayImmediate()
            call.resolve()
        }
    }

    @PluginMethod
    fun next(call: PluginCall) {
        runOnService(call) { svc ->
            svc?.nextTrack()
            call.resolve()
        }
    }

    @PluginMethod
    fun prev(call: PluginCall) {
        runOnService(call) { svc ->
            svc?.prevTrack()
            call.resolve()
        }
    }

    @PluginMethod
    fun seek(call: PluginCall) {
        val pos = call.getDouble("position") ?: 0.0
        runOnService(call) { svc ->
            svc?.seekTo(pos)
            call.resolve()
        }
    }

    @PluginMethod
    fun setShuffle(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        runOnService(call) { svc ->
            svc?.setShuffle(enabled)
            call.resolve()
        }
    }

    @PluginMethod
    fun setRepeat(call: PluginCall) {
        val mode = call.getString("mode", "off") ?: "off"
        runOnService(call) { svc ->
            svc?.setRepeat(mode)
            call.resolve()
        }
    }

    @PluginMethod
    fun setStopAfterCurrent(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        runOnService(call) { svc ->
            svc?.setStopAfterCurrent(enabled)
            call.resolve()
        }
    }

    @PluginMethod
    fun searchOnline(call: PluginCall) {
        val query = call.getString("query") ?: ""
        val provider = call.getString("provider") ?: "all"
        ioExecutor.execute {
            try {
                val items = RyotunesOnlineResolver.searchOnline(query, provider)
                call.resolve(JSObject().apply { put("items", items) })
            } catch (e: Exception) {
                call.reject(e.localizedMessage ?: "Search failed")
            }
        }
    }

    @PluginMethod
    fun resolveStream(call: PluginCall) {
        val id = call.getString("id") ?: ""
        val provider = call.getString("provider") ?: "youtube"
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val quality = call.getString("quality") ?: "HIGH"
        ioExecutor.execute {
            try {
                val resolved = RyotunesOnlineResolver.resolveStream(context, id, provider, title, artist, quality)
                val wfArr = JSArray()
                resolved.waveform.forEach { wfArr.put(it) }
                call.resolve(JSObject().apply {
                    put("streamUrl", resolved.streamUrl)
                    put("mimeType", resolved.mimeType)
                    put("duration", resolved.durationSec)
                    if (resolved.waveform.isNotEmpty()) put("waveform", wfArr)
                })
            } catch (e: Exception) {
                call.reject(e.localizedMessage ?: "Stream resolve failed")
            }
        }
    }

    @PluginMethod
    fun downloadOffline(call: PluginCall) {
        val trackObj = call.getObject("track") ?: run {
            call.reject("Missing track object")
            return
        }
        val quality = call.getString("quality") ?: "HIGH"
        val trackId = trackObj.optString("id", "")
        ioExecutor.execute {
            try {
                val saved = RyotunesOnlineResolver.downloadOffline(context, trackObj, quality) { pct ->
                    notifyListeners("downloadProgress", JSObject().apply {
                        put("trackId", trackId)
                        put("progress", pct)
                        put("status", if (pct >= 100) "completed" else "downloading")
                    })
                }
                call.resolve(JSObject().apply { put("track", saved) })
            } catch (e: Exception) {
                notifyListeners("downloadProgress", JSObject().apply {
                    put("trackId", trackId)
                    put("progress", 0)
                    put("status", "failed")
                    put("error", e.localizedMessage ?: "Download error")
                })
                call.reject(e.localizedMessage ?: "Offline download failed")
            }
        }
    }

    @PluginMethod
    fun listOfflineTracks(call: PluginCall) {
        ioExecutor.execute {
            val arr = RyotunesOnlineResolver.listOfflineTracks(context)
            call.resolve(JSObject().apply { put("tracks", arr) })
        }
    }

    @PluginMethod
    fun removeOfflineTrack(call: PluginCall) {
        val id = call.getString("id") ?: ""
        ioExecutor.execute {
            RyotunesOnlineResolver.removeOfflineTrack(context, id)
            call.resolve()
        }
    }

    @PluginMethod
    fun clearStreamCache(call: PluginCall) {
        ioExecutor.execute {
            RyotunesOnlineResolver.clearStreamCache(context)
            call.resolve()
        }
    }

    @PluginMethod
    fun fetchLyrics(call: PluginCall) {
        val title = call.getString("title") ?: ""
        val artist = call.getString("artist") ?: ""
        val album = call.getString("album") ?: ""
        val durationSec = call.getDouble("durationSec") ?: 0.0
        ioExecutor.execute {
            try {
                val res = RyotunesOnlineResolver.fetchLyrics(title, artist, album, durationSec)
                call.resolve(res)
            } catch (e: Throwable) {
                call.reject("Lyrics fetch failed: ${e.message}")
            }
        }
    }

    // ── Multi-Provider Accounts & Cloud Playlist Sync ─────────────────────────

    @PluginMethod
    fun connectAccount(call: PluginCall) {
        val rawProvider = call.getString("provider") ?: "ytmusic"
        val provider = RyotunesAccountVault.normalizeProvider(rawProvider)
        val intent = Intent(context, RyotunesAccountAuthActivity::class.java).apply {
            putExtra(RyotunesAccountAuthActivity.EXTRA_PROVIDER, provider)
        }
        startActivityForResult(call, intent, "handleAccountAuthResult")
    }

    @ActivityCallback
    private fun handleAccountAuthResult(call: PluginCall, result: ActivityResult) {
        val data = result.data
        val provider = data?.getStringExtra(RyotunesAccountAuthActivity.RESULT_PROVIDER)
            ?: RyotunesAccountVault.normalizeProvider(call.getString("provider") ?: "ytmusic")
        val connected = result.resultCode == Activity.RESULT_OK &&
            (data?.getBooleanExtra(RyotunesAccountAuthActivity.RESULT_CONNECTED, false) == true)
        val accountName = data?.getStringExtra(RyotunesAccountAuthActivity.RESULT_ACCOUNT_NAME) ?: ""
        call.resolve(JSObject().apply {
            put("connected", connected)
            put("provider", provider)
            put("accountName", accountName)
        })
    }

    @PluginMethod
    fun disconnectAccount(call: PluginCall) {
        val rawProvider = call.getString("provider") ?: ""
        val provider = RyotunesAccountVault.normalizeProvider(rawProvider)
        if (provider.isBlank()) {
            call.reject("Missing provider")
            return
        }
        RyotunesAccountVault.disconnect(context, provider)
        call.resolve(JSObject().apply {
            put("connected", false)
            put("provider", provider)
        })
    }

    @PluginMethod
    fun getConnectedAccounts(call: PluginCall) {
        call.resolve(RyotunesAccountVault.getConnectedAccountsJson(context))
    }

    @PluginMethod
    fun syncAccountPlaylists(call: PluginCall) {
        val rawProvider = call.getString("provider") ?: ""
        val provider = RyotunesAccountVault.normalizeProvider(rawProvider)
        if (provider.isBlank()) {
            call.reject("Missing provider")
            return
        }
        ioExecutor.execute {
            try {
                val res = RyotunesAccountSync.syncAccountPlaylists(context, provider)
                call.resolve(res)
            } catch (e: Throwable) {
                call.reject(e.localizedMessage ?: "No se pudieron sincronizar las playlists")
            }
        }
    }

    @PluginMethod
    fun importPlaylistByUrl(call: PluginCall) {
        val url = call.getString("url") ?: ""
        if (url.isBlank()) {
            call.reject("Pega un enlace de playlist válido")
            return
        }
        ioExecutor.execute {
            try {
                val res = RyotunesAccountSync.importPlaylistByUrl(context, url)
                call.resolve(res)
            } catch (e: Throwable) {
                call.reject(e.localizedMessage ?: "No se pudo importar la playlist")
            }
        }
    }

    // ── GitHub Releases OTA Auto-Updater ──────────────────────────────────────

    @PluginMethod
    fun getAppVersionInfo(call: PluginCall) {
        call.resolve(RyotunesUpdater.getAppVersionInfo())
    }

    @PluginMethod
    fun checkGithubUpdate(call: PluginCall) {
        ioExecutor.execute {
            try {
                val res = RyotunesUpdater.checkGithubUpdate()
                call.resolve(res)
            } catch (e: Throwable) {
                call.reject(e.localizedMessage ?: "No se pudo consultar actualizaciones")
            }
        }
    }

    @PluginMethod
    fun downloadAndInstallUpdate(call: PluginCall) {
        val apkUrl = call.getString("apkUrl") ?: ""
        val version = call.getString("version") ?: ""
        if (apkUrl.isBlank()) {
            call.reject("Missing apkUrl")
            return
        }
        ioExecutor.execute {
            try {
                val res = RyotunesUpdater.downloadAndInstallUpdate(context, apkUrl) { pct ->
                    notifyListeners("updateProgress", JSObject().apply {
                        put("progress", pct)
                        put("version", version)
                    })
                }
                call.resolve(res)
            } catch (e: Throwable) {
                call.reject(e.localizedMessage ?: "Error al descargar la actualización")
            }
        }
    }

    @PluginMethod
    fun setAudioFx(call: PluginCall) {
        val speed = (call.getDouble("speed") ?: 1.0).toFloat()
        val semitones = call.getInt("semitones", 0) ?: 0
        val reverb = (call.getDouble("reverb") ?: 0.0).toFloat()
        val bass = call.getInt("bass", 0) ?: 0
        val width = (call.getDouble("width") ?: 0.0).toFloat()
        runOnService(call) { svc ->
            svc?.setAudioFx(speed, semitones, reverb, bass, width)
            call.resolve()
        }
    }

    @PluginMethod
    fun getSystemVolume(call: PluginCall) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val cur = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val pct = ((cur.toFloat() / max.toFloat()) * 100f).roundToInt().coerceIn(0, 100)
        call.resolve(JSObject().apply {
            put("volume", pct)
            put("muted", cur == 0)
        })
    }

    @PluginMethod
    fun setSystemVolume(call: PluginCall) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val pct = (call.getInt("volume", 75) ?: 75).coerceIn(0, 100)
        val muted = call.getBoolean("muted", false) ?: false
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val target = if (muted) 0 else ((pct / 100f) * max).roundToInt().coerceIn(0, max)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
        call.resolve()
    }

    @PluginMethod
    fun getPlaybackState(call: PluginCall) {
        runOnService(call) { svc ->
            val snap = svc?.getCurrentSnapshot()
            val obj = JSObject()
            if (snap != null) {
                snap.forEach { (k, v) -> obj.put(k, v) }
            }
            call.resolve(obj)
        }
    }

    // ── ServiceListener -> WebView Events ─────────────────────────────────────

    override fun onPlaybackStateChanged(
        trackId: String?,
        isPlaying: Boolean,
        positionSec: Double,
        durationSec: Double,
        queueIndex: Int,
        shuffle: Boolean,
        repeat: String,
        stopAfterCurrent: Boolean,
        ended: Boolean
    ) {
        val payload = JSObject().apply {
            put("trackId", trackId)
            put("isPlaying", isPlaying)
            put("position", positionSec)
            put("duration", durationSec)
            put("queueIndex", queueIndex)
            put("shuffle", shuffle)
            put("repeat", repeat)
            put("stopAfterCurrent", stopAfterCurrent)
            put("ended", ended)
        }
        notifyListeners("playbackState", payload)
    }

    override fun onSpectrumFrame(bands: DoubleArray) {
        val arr = JSArray()
        for (b in bands) arr.put(b)
        notifyListeners("spectrum", JSObject().apply { put("bands", arr) })
    }

    override fun onPlaybackError(message: String) {
        notifyListeners("playbackError", JSObject().apply { put("message", message) })
    }
}
