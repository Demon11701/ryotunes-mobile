@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package dev.ryoku.ryotunes

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.PresetReverb
import android.media.audiofx.Virtualizer
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * Background Media Playback Foreground Service:
 * Media3 ExoPlayer + Real PCM-16 FFT AudioProcessor + Spotify-grade MediaSessionCompat +
 * 512x512 Async Cover Art + AudioFX DSP + Nothing OS Bento Widget sync.
 */
class RyotunesAudioService : Service() {

    interface ServiceListener {
        fun onPlaybackStateChanged(
            trackId: String?,
            isPlaying: Boolean,
            positionSec: Double,
            durationSec: Double,
            queueIndex: Int,
            shuffle: Boolean,
            repeat: String,
            stopAfterCurrent: Boolean,
            ended: Boolean = false
        )
        fun onSpectrumFrame(bands: DoubleArray)
        fun onPlaybackError(message: String)
    }

    inner class LocalBinder : Binder() {
        fun getService(): RyotunesAudioService = this@RyotunesAudioService
    }

    private val binder = LocalBinder()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val artExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private lateinit var player: ExoPlayer
    private lateinit var pcmFftProcessor: PcmFftAudioProcessor
    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var notificationManager: NotificationManager
    private lateinit var powerManager: PowerManager

    private var queue: List<NativeTrack> = emptyList()
    private var currentIndex: Int = 0
    private var shuffle: Boolean = false
    private var repeatModeStr: String = "off"
    private var stopAfterCurrent: Boolean = false
    private var restoredPositionMs: Long = 0L
    private var consecutiveErrors: Int = 0

    private var listener: ServiceListener? = null
    private var uiActive: Boolean = false
    @Volatile
    private var cachedIsPlaying: Boolean = false
    private var isForegroundStarted: Boolean = false
    private var lastNotifKey: String = ""
    private var lastNotifAtMs: Long = 0L

    private var bassBoost: BassBoost? = null
    private var presetReverb: PresetReverb? = null
    private var virtualizer: Virtualizer? = null
    private var equalizer: Equalizer? = null
    private var currentSpeed: Float = 1f
    private var currentSemitones: Int = 0
    private var currentBassDb: Int = 0
    private var currentReverb: Float = 0f
    private var currentWidth: Float = 0f

    private var cachedArtKey: String? = null
    private var cachedArtDiskPath: String? = null
    private var cachedArtBitmap: Bitmap? = null
    private var lastSpectrumBands: DoubleArray? = null
    private var lastPersistAtMs: Long = 0L

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY &&
                ::player.isInitialized && player.isPlaying
            ) {
                pauseImmediate()
            }
        }
    }
    private var noisyRegistered = false

    private val positionTicker = object : Runnable {
        override fun run() {
            if (::player.isInitialized && player.isPlaying) {
                if (uiActive) emitState()
                val now = System.currentTimeMillis()
                if (now - lastPersistAtMs >= 3000L) {
                    persistServiceState()
                    lastPersistAtMs = now
                }
                mainHandler.postDelayed(this, 250L)
            }
        }
    }

    private val widgetLiveTicker = object : Runnable {
        override fun run() {
            if (::player.isInitialized && cachedIsPlaying && isScreenInteractive()) {
                updateFftCaptureState()
                val track = queue.getOrNull(currentIndex)
                val durMs = when {
                    player.duration > 0L -> player.duration
                    (track?.durationSec ?: 0.0) > 0.0 -> ((track!!.durationSec) * 1000.0).toLong()
                    else -> 0L
                }
                RyotunesBentoWidgetProvider.updateLiveSpectrumAndProgress(
                    this@RyotunesAudioService,
                    lastSpectrumBands,
                    player.currentPosition.coerceAtLeast(0L),
                    durMs,
                    true
                )
                mainHandler.postDelayed(this, 350L)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        ensureNotificationChannel()

        pcmFftProcessor = PcmFftAudioProcessor { bands ->
            mainHandler.post {
                lastSpectrumBands = bands
                if (uiActive && cachedIsPlaying) {
                    listener?.onSpectrumFrame(bands)
                }
            }
        }

        val attrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(RyotunesOnlineResolver.STREAM_UA)
            .setAllowCrossProtocolRedirects(true)
        val routedHttpFactory = DataSource.Factory {
            ChunkedGoogleVideoDataSource(httpFactory.createDataSource())
        }
        val dataSourceFactory = DefaultDataSource.Factory(this, routedHttpFactory)

        val renderersFactory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean
            ): AudioSink {
                return DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(false)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .setAudioProcessors(arrayOf(pcmFftProcessor))
                    .build()
            }
        }

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15_000, 50_000, 150, 300)
            .build()

        player = ExoPlayer.Builder(this, renderersFactory)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .setAudioAttributes(attrs, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        mediaSession = MediaSessionCompat(this, "RyotunesMediaSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = play()
                override fun onPause() = pause()
                override fun onSkipToNext() = nextTrack()
                override fun onSkipToPrevious() = prevTrack()
                override fun onSeekTo(pos: Long) = seekTo(pos / 1000.0)
                override fun onCustomAction(action: String?, extras: Bundle?) {
                    if (action == CUSTOM_ACTION_SHUFFLE) {
                        setShuffle(!shuffle)
                        syncMediaSessionAndNotification(forceNotify = true)
                    }
                }
                override fun onStop() {
                    pause()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    isForegroundStarted = false
                }
            })
            isActive = true
        }

        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                cachedIsPlaying = isPlaying
                if (isPlaying) consecutiveErrors = 0
                updateFftCaptureState()
                syncMediaSessionAndNotification()
                emitState()
                updateWidget()
                persistServiceState()
                mainHandler.removeCallbacks(positionTicker)
                mainHandler.removeCallbacks(widgetLiveTicker)
                if (isPlaying) {
                    mainHandler.post(positionTicker)
                    if (isScreenInteractive()) {
                        mainHandler.postDelayed(widgetLiveTicker, 350L)
                    }
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    consecutiveErrors = 0
                }
                if (playbackState == Player.STATE_ENDED) {
                    handleTrackEnded()
                } else {
                    syncMediaSessionAndNotification()
                    emitState()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val trackName = queue.getOrNull(currentIndex)?.title ?: "Audio track"
                consecutiveErrors++
                listener?.onPlaybackError("Skipped \"$trackName\": ${error.errorCodeName}")
                if (queue.isNotEmpty() && consecutiveErrors < queue.size) {
                    nextTrack()
                } else {
                    consecutiveErrors = 0
                    player.pause()
                    emitState()
                    updateWidget()
                }
            }
        })

        ContextCompat.registerReceiver(
            this,
            noisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        noisyRegistered = true
        restoreServiceState()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Satisfy Android 14/15 startForegroundService contract immediately upon entering
        if (intent?.action != null) {
            promoteToForeground()
        }
        MediaButtonReceiver.handleIntent(mediaSession, intent)
        when (intent?.action) {
            ACTION_PLAY, ACTION_TOGGLE_PLAY, ACTION_NEXT, ACTION_PREV -> {
                if (queue.isEmpty()) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    isForegroundStarted = false
                    stopSelf(startId)
                } else {
                    when (intent.action) {
                        ACTION_PLAY -> play()
                        ACTION_TOGGLE_PLAY -> togglePlay()
                        ACTION_NEXT -> nextTrack()
                        ACTION_PREV -> prevTrack()
                    }
                }
            }
            ACTION_PAUSE -> pause()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        persistServiceState()
        mainHandler.removeCallbacks(positionTicker)
        mainHandler.removeCallbacks(widgetLiveTicker)
        pcmFftProcessor.activeCapture = false
        releaseAudioEffects()
        artExecutor.shutdownNow()
        if (noisyRegistered) {
            try {
                unregisterReceiver(noisyReceiver)
            } catch (_: Exception) {}
            noisyRegistered = false
        }
        cachedArtBitmap?.recycle()
        cachedArtBitmap = null
        mediaSession.isActive = false
        mediaSession.release()
        player.release()
        super.onDestroy()
    }

    fun attachListener(l: ServiceListener?) {
        listener = l
        if (l != null) emitState()
    }

    fun setUiActive(active: Boolean) {
        uiActive = active
        updateFftCaptureState()
        mainHandler.removeCallbacks(positionTicker)
        if (active && ::player.isInitialized && player.isPlaying) {
            mainHandler.post(positionTicker)
        }
    }

    fun rebindVisualizerIfPermitted() {
        updateFftCaptureState()
    }

    fun setQueue(tracks: List<NativeTrack>, startIndex: Int, autoPlay: Boolean, startPositionSec: Double = 0.0) {
        queue = tracks
        consecutiveErrors = 0
        if (queue.isEmpty()) return
        currentIndex = startIndex.coerceIn(0, queue.lastIndex)
        restoredPositionMs = (startPositionSec.coerceAtLeast(0.0) * 1000.0).toLong()
        loadCurrentTrack(autoPlay, restoredPositionMs)
        persistServiceState()
    }

    fun play() = playImmediate()

    fun pause() = pauseImmediate()

    fun togglePlay() = togglePlayImmediate()

    fun playImmediate() {
        if (queue.isEmpty()) return
        promoteToForeground()
        if (player.playbackState == Player.STATE_IDLE) {
            loadCurrentTrack(true, restoredPositionMs)
            return
        }
        cachedIsPlaying = true
        player.playWhenReady = true
        updateFftCaptureState()
        emitPlaybackStateNow(isPlayingOverride = true)
        syncMediaSessionAndNotification(isPlayingOverride = true)
        updateWidget()
        mainHandler.removeCallbacks(positionTicker)
        mainHandler.post(positionTicker)
        mainHandler.removeCallbacks(widgetLiveTicker)
        if (isScreenInteractive()) {
            mainHandler.postDelayed(widgetLiveTicker, 350L)
        }
    }

    fun pauseImmediate() {
        cachedIsPlaying = false
        player.playWhenReady = false
        mainHandler.removeCallbacks(widgetLiveTicker)
        updateFftCaptureState()
        emitPlaybackStateNow(isPlayingOverride = false)
        persistServiceState()
        syncMediaSessionAndNotification(forceNotify = true, isPlayingOverride = false)
        updateWidget()
    }

    fun togglePlayImmediate() {
        val currentlyPlaying = player.isPlaying || (player.playWhenReady && player.playbackState == Player.STATE_BUFFERING)
        if (currentlyPlaying) pauseImmediate() else playImmediate()
    }

    fun nextTrack() {
        if (queue.isEmpty()) return
        currentIndex = if (shuffle && queue.size > 1) {
            var pick = currentIndex
            while (pick == currentIndex) pick = Random.nextInt(queue.size)
            pick
        } else if (currentIndex + 1 < queue.size) {
            currentIndex + 1
        } else {
            0
        }
        restoredPositionMs = 0L
        loadCurrentTrack(true, 0L)
        persistServiceState()
    }

    fun prevTrack() {
        if (queue.isEmpty()) return
        if (player.currentPosition > 3000L) {
            seekTo(0.0)
            return
        }
        currentIndex = if (currentIndex > 0) currentIndex - 1 else queue.lastIndex
        restoredPositionMs = 0L
        loadCurrentTrack(true, 0L)
        persistServiceState()
    }

    fun seekTo(seconds: Double) {
        val ms = (seconds.coerceAtLeast(0.0) * 1000.0).toLong()
        restoredPositionMs = ms
        player.seekTo(ms)
        persistServiceState()
        syncMediaSessionAndNotification()
        emitState()
        updateWidget()
    }

    fun setShuffle(enabled: Boolean) {
        shuffle = enabled
        persistServiceState()
        syncMediaSessionAndNotification()
        emitState()
    }

    fun setRepeat(mode: String) {
        repeatModeStr = mode
        persistServiceState()
        emitState()
    }

    fun setStopAfterCurrent(enabled: Boolean) {
        stopAfterCurrent = enabled
        emitState()
    }

    fun setAudioFx(speed: Float, semitones: Int, reverb: Float, bassDb: Int, width: Float = 0f) {
        currentSpeed = speed.coerceIn(0.25f, 2.0f)
        currentSemitones = semitones.coerceIn(-12, 12)
        currentReverb = reverb.coerceIn(0f, 1f)
        currentBassDb = bassDb.coerceIn(-6, 12)
        currentWidth = width.coerceIn(0f, 1f)

        val pitch = Math.pow(2.0, currentSemitones / 12.0).toFloat()
        player.playbackParameters = PlaybackParameters(currentSpeed, pitch)

        val sessionId = player.audioSessionId
        if (sessionId != C.AUDIO_SESSION_ID_UNSET && sessionId != AudioManager.ERROR) {
            applyDspEffects(sessionId)
        }
        persistServiceState()
    }

    fun getCurrentSnapshot(): Map<String, Any?> {
        if (!::player.isInitialized) return emptyMap()
        val track = queue.getOrNull(currentIndex)
        val posSec = (player.currentPosition.coerceAtLeast(0L)) / 1000.0
        val durSec = if (player.duration > 0) player.duration / 1000.0 else (track?.durationSec ?: 0.0)
        return mapOf(
            "trackId" to track?.id,
            "isPlaying" to player.isPlaying,
            "position" to posSec,
            "duration" to durSec,
            "queueIndex" to currentIndex,
            "shuffle" to shuffle,
            "repeat" to repeatModeStr,
            "stopAfterCurrent" to stopAfterCurrent
        )
    }

    private fun isScreenInteractive(): Boolean {
        return !::powerManager.isInitialized || powerManager.isInteractive
    }

    private fun updateFftCaptureState() {
        val active = ::player.isInitialized && cachedIsPlaying && (uiActive || isScreenInteractive())
        pcmFftProcessor.activeCapture = active
        if (!active) {
            lastSpectrumBands = null
            listener?.onSpectrumFrame(DoubleArray(40) { 0.0 })
        }
    }

    private fun handleTrackEnded() {
        if (stopAfterCurrent) {
            stopAfterCurrent = false
            player.seekTo(0)
            player.pause()
            cachedIsPlaying = false
            updateFftCaptureState()
            emitState()
            updateWidget()
            return
        }
        if (repeatModeStr == "one") {
            player.seekTo(0)
            player.play()
            return
        }
        if (currentIndex + 1 < queue.size || repeatModeStr == "all" || shuffle) {
            nextTrack()
        } else {
            player.pause()
            cachedIsPlaying = false
            updateFftCaptureState()
            player.seekTo(0)
            emitState(ended = true)
            updateWidget()
        }
    }

    private fun loadCurrentTrack(autoPlay: Boolean, initialPosMs: Long = 0L) {
        val track = queue.getOrNull(currentIndex) ?: return
        try {
            if (autoPlay) promoteToForeground()
            val itemBuilder = MediaItem.Builder().setUri(Uri.parse(track.contentUri))
            if (track.mimeType == "application/x-mpegURL" || track.contentUri.contains(".m3u8")) {
                itemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8)
            } else if (track.mimeType?.contains("webm") == true || track.contentUri.contains("mime=audio%2Fwebm")) {
                itemBuilder.setMimeType(MimeTypes.AUDIO_WEBM)
            }
            player.setMediaItem(itemBuilder.build())
            player.prepare()
            if (initialPosMs > 0L) {
                player.seekTo(initialPosMs)
            }
            val pitch = Math.pow(2.0, currentSemitones / 12.0).toFloat()
            player.playbackParameters = PlaybackParameters(currentSpeed, pitch)
            cachedIsPlaying = autoPlay
            player.playWhenReady = autoPlay
            updateFftCaptureState()

            val sessionId = player.audioSessionId
            if (sessionId != C.AUDIO_SESSION_ID_UNSET && sessionId != AudioManager.ERROR) {
                applyDspEffects(sessionId)
            }

            loadArtworkForTrack(track)
            syncMediaSessionAndNotification(forceNotify = autoPlay)
            emitState()
            updateWidget()
        } catch (e: Exception) {
            listener?.onPlaybackError("Cannot open \"${track.title}\": ${e.localizedMessage ?: "error"}")
            if (consecutiveErrors < queue.size) {
                consecutiveErrors++
                nextTrack()
            }
        }
    }

    private fun persistServiceState() {
        try {
            val arr = JSONArray()
            for (t in queue) arr.put(t.toJson())
            val posMs = if (::player.isInitialized && player.playbackState != Player.STATE_IDLE) {
                player.currentPosition.coerceAtLeast(0L)
            } else restoredPositionMs

            getSharedPreferences(SERVICE_PREFS, Context.MODE_PRIVATE).edit().apply {
                putString("queueJson", arr.toString())
                putInt("currentIndex", currentIndex)
                putLong("positionMs", posMs)
                putBoolean("shuffle", shuffle)
                putString("repeat", repeatModeStr)
                putFloat("speed", currentSpeed)
                putInt("semitones", currentSemitones)
                putFloat("reverb", currentReverb)
                putInt("bassDb", currentBassDb)
                putFloat("width", currentWidth)
                apply()
            }
        } catch (_: Exception) {}
    }

    private fun restoreServiceState() {
        try {
            val prefs = getSharedPreferences(SERVICE_PREFS, Context.MODE_PRIVATE)
            val json = prefs.getString("queueJson", null) ?: return
            val arr = JSONArray(json)
            val list = mutableListOf<NativeTrack>()
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                list.add(NativeTrack.fromJson(obj))
            }
            if (list.isEmpty()) return
            queue = list
            currentIndex = prefs.getInt("currentIndex", 0).coerceIn(0, list.lastIndex)
            restoredPositionMs = prefs.getLong("positionMs", 0L).coerceAtLeast(0L)
            shuffle = prefs.getBoolean("shuffle", false)
            repeatModeStr = prefs.getString("repeat", "off") ?: "off"
            currentSpeed = prefs.getFloat("speed", 1f)
            currentSemitones = prefs.getInt("semitones", 0)
            currentReverb = prefs.getFloat("reverb", 0f)
            currentBassDb = prefs.getInt("bassDb", 0)
            currentWidth = prefs.getFloat("width", 0f)

            val track = queue.getOrNull(currentIndex)
            if (track != null) {
                loadArtworkForTrack(track)
                RyotunesBentoWidgetProvider.saveAndUpdateAll(
                    this,
                    RyotunesBentoWidgetProvider.WidgetState(
                        title = track.title,
                        artist = track.artist,
                        isPlaying = false,
                        positionSec = restoredPositionMs / 1000.0,
                        durationSec = track.durationSec,
                        artworkPath = cachedArtDiskPath ?: track.artworkPath,
                        spectrumBands = null
                    )
                )
            }
        } catch (_: Exception) {}
    }

    private fun promoteToForeground() {
        val notif = buildNotification()
        try {
            if (!isForegroundStarted) {
                ContextCompat.startForegroundService(this, Intent(this, RyotunesAudioService::class.java))
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notif,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIFICATION_ID, notif)
            }
            isForegroundStarted = true
            val track = queue.getOrNull(currentIndex)
            lastNotifKey = "${track?.id}|${::player.isInitialized && player.isPlaying}"
            lastNotifAtMs = System.currentTimeMillis()
        } catch (_: Exception) {
            notificationManager.notify(NOTIFICATION_ID, notif)
        }
    }

    private fun scaleBitmap512(src: Bitmap): Bitmap {
        return if (src.width == 512 && src.height == 512) {
            src
        } else {
            val scaled = Bitmap.createScaledBitmap(src, 512, 512, true)
            if (scaled !== src) src.recycle()
            scaled
        }
    }

    private fun loadArtworkForTrack(track: NativeTrack) {
        val key = track.artworkPath ?: track.artworkUrl
        if (key == cachedArtKey) return
        cachedArtKey = key
        cachedArtDiskPath = track.artworkPath
        cachedArtBitmap?.recycle()
        cachedArtBitmap = null

        val trackIdSnapshot = track.id
        if (!track.artworkPath.isNullOrEmpty()) {
            try {
                val bmp = BitmapFactory.decodeFile(track.artworkPath)
                if (bmp != null) {
                    cachedArtBitmap = scaleBitmap512(bmp)
                }
            } catch (_: Exception) {}
            return
        }

        val remoteUrl = track.artworkUrl
        if (!remoteUrl.isNullOrEmpty()) {
            artExecutor.execute {
                try {
                    val artDir = File(cacheDir, "ryotunes_art").apply { mkdirs() }
                    val safeFile = File(artDir, "url_${trackIdSnapshot.hashCode()}.jpg")
                    var bmp: Bitmap? = if (safeFile.exists() && safeFile.length() > 128L) {
                        BitmapFactory.decodeFile(safeFile.absolutePath)
                    } else null

                    if (bmp == null) {
                        val conn = (URL(remoteUrl).openConnection() as HttpURLConnection).apply {
                            connectTimeout = 7000
                            readTimeout = 7000
                            setRequestProperty("User-Agent", "Mozilla/5.0")
                            instanceFollowRedirects = true
                        }
                        try {
                            if (conn.responseCode in 200..299) {
                                val bytes = conn.inputStream.use { it.readBytes() }
                                if (bytes.isNotEmpty()) {
                                    bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                                }
                            }
                        } finally {
                            conn.disconnect()
                        }
                    }

                    if (bmp != null) {
                        val scaled = scaleBitmap512(bmp)
                        if (!safeFile.exists() || safeFile.length() <= 128L) {
                            runCatching {
                                FileOutputStream(safeFile).use { fos ->
                                    scaled.compress(Bitmap.CompressFormat.JPEG, 88, fos)
                                }
                            }
                        }
                        mainHandler.post {
                            if (queue.getOrNull(currentIndex)?.id == trackIdSnapshot) {
                                cachedArtBitmap?.recycle()
                                cachedArtBitmap = scaled
                                cachedArtDiskPath = safeFile.absolutePath
                                syncMediaSessionAndNotification(forceNotify = true)
                                updateWidget()
                            } else {
                                scaled.recycle()
                            }
                        }
                    }
                } catch (_: Exception) {}
            }
        }
    }

    private fun syncMediaSessionAndNotification(forceNotify: Boolean = false, isPlayingOverride: Boolean? = null) {
        val track = queue.getOrNull(currentIndex)
        val playing = isPlayingOverride ?: (::player.isInitialized && player.isPlaying)
        val durMs = when {
            player.duration > 0L -> player.duration
            (track?.durationSec ?: 0.0) > 0.0 -> ((track!!.durationSec) * 1000.0).toLong()
            else -> 1L
        }

        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, track?.title ?: "Ryotunes")
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, track?.artist ?: "Nothing × Ryoku Purple")
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, track?.album ?: "Local Device")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durMs)
            .apply {
                cachedArtBitmap?.let { bmp ->
                    putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp)
                    putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, bmp)
                }
            }
            .build()
        mediaSession.setMetadata(metadata)

        val stateCode = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val pbState = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_SEEK_TO or
                    PlaybackStateCompat.ACTION_STOP
            )
            .addCustomAction(
                PlaybackStateCompat.CustomAction.Builder(
                    CUSTOM_ACTION_SHUFFLE,
                    if (shuffle) "Shuffle: ON" else "Shuffle: OFF",
                    if (shuffle) R.drawable.ic_ryo_notif else R.drawable.ic_ryo_album
                ).build()
            )
            .setState(stateCode, player.currentPosition.coerceAtLeast(0L), currentSpeed)
            .build()
        mediaSession.setPlaybackState(pbState)

        if (isForegroundStarted || playing) {
            val key = "${track?.id}|$playing|$shuffle|${cachedArtBitmap != null}"
            val now = System.currentTimeMillis()
            if (forceNotify || key != lastNotifKey || (now - lastNotifAtMs) >= 400L) {
                lastNotifKey = key
                lastNotifAtMs = now
                notificationManager.notify(NOTIFICATION_ID, buildNotification(playing))
            }
        }
    }

    private fun buildNotification(isPlayingOverride: Boolean? = null): Notification {
        val playing = isPlayingOverride ?: (::player.isInitialized && player.isPlaying)
        val track = queue.getOrNull(currentIndex)
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPending = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevPending = serviceActionPending(1, ACTION_PREV)
        val togglePending = serviceActionPending(2, ACTION_TOGGLE_PLAY)
        val nextPending = serviceActionPending(3, ACTION_NEXT)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_ryo_notif)
            .setContentTitle(track?.title ?: "Ryotunes")
            .setContentText(track?.artist ?: "Nothing × Ryoku Purple")
            .setSubText("RYOTUNES // ${(track?.format ?: "AUDIO").uppercase()}")
            .setLargeIcon(cachedArtBitmap)
            .setContentIntent(contentPending)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setColor(0xFFA855F7.toInt())
            .addAction(R.drawable.ic_ryo_prev, "Previous", prevPending)
            .addAction(
                if (playing) R.drawable.ic_ryo_pause else R.drawable.ic_ryo_play,
                if (playing) "Pause" else "Play",
                togglePending
            )
            .addAction(R.drawable.ic_ryo_next, "Next", nextPending)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    private fun serviceActionPending(reqCode: Int, actionCmd: String): PendingIntent {
        val intent = Intent(this, RyotunesAudioService::class.java).apply {
            action = actionCmd
        }
        return PendingIntent.getService(
            this,
            reqCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Ryotunes Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Media playback controls & lock screen telemetry"
                setShowBadge(false)
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun applyDspEffects(sessionId: Int) {
        val bassActive = currentBassDb > 0
        try {
            if (bassActive) {
                if (bassBoost == null) bassBoost = BassBoost(0, sessionId)
                bassBoost?.apply {
                    if (strengthSupported) {
                        setStrength(((currentBassDb / 12f) * 650f).toInt().coerceIn(0, 750).toShort())
                    }
                    enabled = true
                }
            } else {
                bassBoost?.enabled = false
            }
        } catch (_: Exception) {}

        val eqNeeded = currentBassDb != 0
        try {
            if (eqNeeded) {
                if (equalizer == null) equalizer = Equalizer(0, sessionId)
                equalizer?.apply {
                    val range = bandLevelRange
                    val minMb = range.getOrElse(0) { -1500 }.toInt()
                    val maxMb = range.getOrElse(1) { 1500 }.toInt()
                    val nBands = numberOfBands.toInt()
                    for (b in 0 until nBands) {
                        val bandIdx = b.toShort()
                        val hz = getCenterFreq(bandIdx) / 1000
                        val targetMb = if (currentBassDb > 0) {
                            when {
                                hz <= 90 -> (currentBassDb * 60).coerceIn(0, minOf(700, maxMb))
                                hz <= 180 -> (currentBassDb * 40).coerceIn(0, minOf(480, maxMb))
                                hz <= 350 -> (currentBassDb * 15).coerceIn(0, minOf(200, maxMb))
                                else -> if (currentBassDb >= 6) -100.coerceAtLeast(minMb) else 0
                            }
                        } else {
                            if (hz <= 160) (currentBassDb * 100).coerceIn(minMb, 0) else 0
                        }
                        setBandLevel(bandIdx, targetMb.coerceIn(minMb, maxMb).toShort())
                    }
                    enabled = true
                }
            } else {
                equalizer?.enabled = false
            }
        } catch (_: Exception) {}

        // True Hardware Bypass: PresetReverb degrades stereo clarity if active near 0
        val reverbActive = currentReverb > 0.02f
        try {
            if (reverbActive) {
                if (presetReverb == null) presetReverb = PresetReverb(0, sessionId)
                presetReverb?.apply {
                    preset = when {
                        currentReverb > 0.7f -> PresetReverb.PRESET_LARGEHALL
                        currentReverb > 0.35f -> PresetReverb.PRESET_MEDIUMHALL
                        else -> PresetReverb.PRESET_SMALLROOM
                    }
                    enabled = true
                }
            } else {
                presetReverb?.preset = PresetReverb.PRESET_NONE
                presetReverb?.enabled = false
            }
        } catch (_: Exception) {}

        // True Hardware Bypass for Virtualizer
        val widthActive = currentWidth > 0.02f
        try {
            if (widthActive) {
                if (virtualizer == null) virtualizer = Virtualizer(0, sessionId)
                virtualizer?.apply {
                    if (strengthSupported) {
                        setStrength((currentWidth * 900f).toInt().coerceIn(0, 950).toShort())
                    }
                    enabled = true
                }
            } else {
                virtualizer?.enabled = false
            }
        } catch (_: Exception) {}
    }

    private fun releaseAudioEffects() {
        try { bassBoost?.release() } catch (_: Exception) {}
        bassBoost = null
        try { equalizer?.release() } catch (_: Exception) {}
        equalizer = null
        try { presetReverb?.release() } catch (_: Exception) {}
        presetReverb = null
        try { virtualizer?.release() } catch (_: Exception) {}
        virtualizer = null
    }

    private fun emitPlaybackStateNow(ended: Boolean = false, isPlayingOverride: Boolean? = null) {
        emitState(ended = ended, isPlayingOverride = isPlayingOverride)
    }

    private fun emitState(ended: Boolean = false, isPlayingOverride: Boolean? = null) {
        val track = queue.getOrNull(currentIndex)
        val posSec = player.currentPosition.coerceAtLeast(0L) / 1000.0
        val durSec = if (player.duration > 0) player.duration / 1000.0 else (track?.durationSec ?: 0.0)
        val effectivePlaying = isPlayingOverride ?: player.isPlaying
        listener?.onPlaybackStateChanged(
            track?.id,
            effectivePlaying,
            posSec,
            durSec,
            currentIndex,
            shuffle,
            repeatModeStr,
            stopAfterCurrent,
            ended
        )
    }

    private fun updateWidget() {
        val track = queue.getOrNull(currentIndex)
        val posSec = player.currentPosition.coerceAtLeast(0L) / 1000.0
        val durSec = if (player.duration > 0) player.duration / 1000.0 else (track?.durationSec ?: 0.0)
        RyotunesBentoWidgetProvider.saveAndUpdateAll(
            this,
            RyotunesBentoWidgetProvider.WidgetState(
                title = track?.title ?: "OPEN RYOTUNES",
                artist = track?.artist ?: "NOTHING × RYOKU PURPLE",
                isPlaying = player.isPlaying,
                positionSec = posSec,
                durationSec = durSec,
                artworkPath = cachedArtDiskPath ?: track?.artworkPath,
                spectrumBands = if (player.isPlaying) lastSpectrumBands else null
            )
        )
    }

    companion object {
        const val CHANNEL_ID = "ryotunes_playback"
        const val NOTIFICATION_ID = 7041
        private const val SERVICE_PREFS = "ryotunes_service_state"
        const val CUSTOM_ACTION_SHUFFLE = "dev.ryoku.ryotunes.ACTION_TOGGLE_SHUFFLE"

        const val ACTION_PLAY = "dev.ryoku.ryotunes.ACTION_PLAY"
        const val ACTION_PAUSE = "dev.ryoku.ryotunes.ACTION_PAUSE"
        const val ACTION_TOGGLE_PLAY = "dev.ryoku.ryotunes.ACTION_TOGGLE_PLAY"
        const val ACTION_NEXT = "dev.ryoku.ryotunes.ACTION_NEXT"
        const val ACTION_PREV = "dev.ryoku.ryotunes.ACTION_PREV"
    }
}
