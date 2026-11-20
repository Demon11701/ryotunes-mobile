@file:OptIn(androidx.media3.common.util.UnstableApi::class)
package dev.ryoku.ryotunes

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.roundToInt

/**
 * Native Android streaming provider resolver & offline cache manager:
 * - YouTube Music (InnerTube WEB_REMIX search + IOS audio/mp4 stream)
 * - SoundCloud (dynamic client_id + api-v2 search + waveform + progressive/HLS stream)
 * - Spotify & TIDAL catalog enrichment + high-bitrate audio match
 * - Persistent offline downloads in filesDir/ryotunes_offline/ (audio + cover art)
 */
object RyotunesOnlineResolver {

    const val YT_IOS_UA =
        "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"

    const val VISIONOS_UA =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

    const val STREAM_UA = VISIONOS_UA

    private const val OFFLINE_PREFS = "ryotunes_offline_library"
    private const val OFFLINE_KEY = "tracks_json"

    @Volatile
    private var cachedScClientId: String = ""
    @Volatile
    private var cachedScAtMs: Long = 0L
    @Volatile
    private var cachedYtApiKey: String = ""
    @Volatile
    private var cachedYtVisitorData: String = ""
    @Volatile
    private var cachedYtCfgAtMs: Long = 0L

    data class ResolvedStream(
        val streamUrl: String,
        val mimeType: String,
        val durationSec: Double,
        val waveform: List<Int>
    )

    fun searchOnline(query: String, provider: String): JSArray {
        val q = query.trim()
        val result = JSArray()
        if (q.isEmpty()) return result

        val items: List<JSObject> = when (provider.lowercase()) {
            "youtube" -> searchYouTubeMusic(q)
            "soundcloud" -> searchSoundCloud(q)
            "spotify" -> searchCatalog(q, "spotify")
            "tidal" -> searchCatalog(q, "tidal")
            else -> {
                val yt = runCatching { searchYouTubeMusic(q) }.getOrDefault(emptyList())
                val sp = runCatching { searchCatalog(q, "spotify") }.getOrDefault(emptyList())
                val sc = runCatching { searchSoundCloud(q) }.getOrDefault(emptyList())
                val td = runCatching { searchCatalog(q, "tidal") }.getOrDefault(emptyList())
                val lists = listOf(yt, sp, sc, td)
                val maxLen = lists.maxOfOrNull { it.size } ?: 0
                val merged = mutableListOf<JSObject>()
                for (i in 0 until maxLen) {
                    for (list in lists) {
                        if (i < list.size) merged.add(list[i])
                    }
                }
                merged
            }
        }
        items.take(32).forEach { result.put(it) }
        return result
    }

    fun resolveStream(
        context: Context,
        id: String,
        provider: String,
        title: String,
        artist: String,
        quality: String,
        preferProgressiveForDownload: Boolean = false
    ): ResolvedStream {
        // Offline-first check
        getOfflineRecord(context, id)?.let { rec ->
            val src = rec.optString("src", "")
            val fPath = src.removePrefix("file://")
            val file = File(fPath)
            if (file.exists() && file.length() > 1024L) {
                val offlineMime = when {
                    src.endsWith(".webm", ignoreCase = true) -> "audio/webm"
                    src.endsWith(".mp3", ignoreCase = true) -> "audio/mpeg"
                    else -> "audio/mp4"
                }
                return ResolvedStream(
                    streamUrl = src,
                    mimeType = offlineMime,
                    durationSec = rec.optDouble("duration", 0.0),
                    waveform = jsonArrayToIntList(rec.optJSONArray("waveform"))
                )
            }
        }

        return when {
            id.startsWith("yt:") -> {
                val vid = id.removePrefix("yt:")
                runCatching {
                    val res = resolveYoutubeAudio(vid, quality, preferProgressiveForDownload)
                    if (preferProgressiveForDownload && isHlsStream(res)) {
                        throw IllegalStateException("Skipping HLS manifest for offline download")
                    }
                    res
                }.getOrElse { ytErr ->
                    if (title.isNotBlank()) {
                        val sc = runCatching { searchSoundCloud("$artist $title".trim()) }.getOrDefault(emptyList())
                        val scId = sc.firstOrNull()?.optString("remoteId", "") ?: ""
                        if (scId.isNotEmpty()) {
                            return resolveSoundCloudAudio(scId, quality, preferProgressiveForDownload)
                        }
                    }
                    throw ytErr
                }
            }
            id.startsWith("sc:") -> resolveSoundCloudAudio(id.removePrefix("sc:"), quality, preferProgressiveForDownload)
            else -> {
                val q = "$artist $title".trim()
                val ytMatches = runCatching { searchYouTubeMusic(q) }.getOrDefault(emptyList())
                val vid = ytMatches.firstOrNull()?.optString("remoteId", "") ?: ""
                if (vid.isNotEmpty()) {
                    val ytRes = runCatching {
                        val res = resolveYoutubeAudio(vid, quality, preferProgressiveForDownload)
                        if (preferProgressiveForDownload && isHlsStream(res)) null else res
                    }.getOrNull()
                    if (ytRes != null) return ytRes
                }
                val scMatches = runCatching { searchSoundCloud(q) }.getOrDefault(emptyList())
                val scId = scMatches.firstOrNull()?.optString("remoteId", "") ?: ""
                if (scId.isNotEmpty()) return resolveSoundCloudAudio(scId, quality, preferProgressiveForDownload)
                throw IllegalStateException("No matching progressive stream found for \"$title\"")
            }
        }
    }

    private fun isHlsStream(stream: ResolvedStream): Boolean {
        return stream.mimeType.contains("mpegURL", ignoreCase = true) ||
            stream.streamUrl.contains(".m3u8", ignoreCase = true)
    }

    fun downloadOffline(
        context: Context,
        trackJson: JSObject,
        quality: String,
        onProgress: (Int) -> Unit
    ): JSObject {
        val id = trackJson.optString("id", "").ifBlank {
            throw IllegalArgumentException("Missing track id")
        }
        val title = trackJson.optString("title", "Untitled")
        val artist = trackJson.optString("artist", "Unknown Artist")
        val album = trackJson.optString("album", "Ryotunes Offline")
        val provider = trackJson.optString("provider", "youtube")
        val format = trackJson.optString("format", "OFFLINE")
        val artUrl = trackJson.optString("artwork", "")
        var duration = trackJson.optDouble("duration", 0.0)
        val initialWaveform = jsonArrayToIntList(trackJson.optJSONArray("waveform"))

        onProgress(10)
        val candidates = mutableListOf<ResolvedStream>()
        val primary = resolveStream(
            context = context,
            id = id,
            provider = provider,
            title = title,
            artist = artist,
            quality = quality,
            preferProgressiveForDownload = true
        )
        if (!isHlsStream(primary)) {
            candidates.add(primary)
        }

        // Prepare IOS fallback or SoundCloud progressive fallback if primary download rejects
        val ytVidFallback = if (id.startsWith("yt:")) id.removePrefix("yt:") else null
        if (ytVidFallback != null) {
            runCatching {
                val iosRes = resolveYoutubeAudio(ytVidFallback, quality, preferProgressiveForDownload = true, skipVisionOs = true)
                if (!isHlsStream(iosRes) && candidates.none { it.streamUrl == iosRes.streamUrl }) {
                    candidates.add(iosRes)
                }
            }
        }
        if (candidates.isEmpty()) {
            val sc = runCatching { searchSoundCloud("$artist $title".trim()) }.getOrDefault(emptyList())
            val scId = sc.firstOrNull()?.optString("remoteId", "") ?: ""
            if (scId.isNotEmpty()) {
                val scRes = resolveSoundCloudAudio(scId, quality, preferProgressiveForDownload = true)
                if (!isHlsStream(scRes)) candidates.add(scRes)
            }
        }
        if (candidates.isEmpty()) {
            throw IllegalStateException("No progressive offline stream available for \"$title\"")
        }

        val offlineDir = File(context.filesDir, "ryotunes_offline").apply { mkdirs() }
        val safeKey = id.replace(Regex("[^a-zA-Z0-9._-]"), "_")

        var downloadedStream: ResolvedStream? = null
        var downloadedFile: File? = null
        var lastError: Throwable? = null

        for (candidate in candidates) {
            if (candidate.durationSec > 0) duration = candidate.durationSec
            val ext = when {
                candidate.mimeType.contains("mpeg") -> "mp3"
                candidate.mimeType.contains("webm") -> "webm"
                candidate.mimeType.contains("ogg") -> "ogg"
                else -> "m4a"
            }
            val outFile = File(offlineDir, "$safeKey.$ext")
            onProgress(22)
            try {
                downloadUrlToFile(candidate.streamUrl, outFile, onProgress)
                if (outFile.exists() && outFile.length() > 32_768L) {
                    downloadedStream = candidate
                    downloadedFile = outFile
                    break
                }
            } catch (err: Throwable) {
                lastError = err
                runCatching { outFile.delete() }
            }
        }

        val finalStream = downloadedStream ?: throw (lastError ?: IllegalStateException("Offline download failed"))
        val outFile = downloadedFile ?: throw IllegalStateException("Offline file missing")
        val waveform = if (finalStream.waveform.isNotEmpty()) finalStream.waveform else initialWaveform

        var localArtPath: String? = null
        if (artUrl.startsWith("http")) {
            runCatching {
                val artFile = File(offlineDir, "art_$safeKey.jpg")
                val artBytes = httpGetBytes(artUrl, 8000)
                if (artBytes.isNotEmpty()) {
                    FileOutputStream(artFile).use { it.write(artBytes) }
                    localArtPath = artFile.absolutePath
                }
            }
        }

        val fileUriStr = Uri.fromFile(outFile).toString()
        val savedObj = JSObject().apply {
            put("id", id)
            put("originalId", id)
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("duration", duration)
            put("src", fileUriStr)
            put("contentUri", fileUriStr)
            put("localPath", outFile.absolutePath)
            put("mimeType", finalStream.mimeType)
            put("offline", true)
            if (localArtPath != null) put("artworkPath", localArtPath)
            put("format", format)
            put("provider", provider)
            put("sizeBytes", outFile.length())
            if (waveform.isNotEmpty()) {
                val wfArr = JSArray()
                waveform.forEach { wfArr.put(it) }
                put("waveform", wfArr)
            }
        }

        upsertOfflineRecord(context, savedObj)
        onProgress(100)
        return savedObj
    }

    fun listOfflineTracks(context: Context): JSArray {
        val prefs = context.getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(OFFLINE_KEY, "[]") ?: "[]"
        val srcArr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        val valid = JSONArray()
        val out = JSArray()

        for (i in 0 until srcArr.length()) {
            val obj = srcArr.optJSONObject(i) ?: continue
            val filePath = obj.optString("localPath", "").ifBlank {
                obj.optString("src", "").removePrefix("file://")
            }
            val f = File(filePath)
            if (f.exists() && f.length() > 32_768L) {
                valid.put(obj)
                out.put(JSObject(obj.toString()))
            } else {
                runCatching { f.delete() }
            }
        }
        if (valid.length() != srcArr.length()) {
            prefs.edit().putString(OFFLINE_KEY, valid.toString()).apply()
        }
        return out
    }

    fun removeOfflineTrack(context: Context, trackId: String) {
        val prefs = context.getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE)
        val srcArr = runCatching { JSONArray(prefs.getString(OFFLINE_KEY, "[]") ?: "[]") }.getOrDefault(JSONArray())
        val kept = JSONArray()
        for (i in 0 until srcArr.length()) {
            val obj = srcArr.optJSONObject(i) ?: continue
            if (obj.optString("id", "") == trackId || obj.optString("originalId", "") == trackId) {
                val fPath = obj.optString("localPath", "").ifBlank { obj.optString("src", "").removePrefix("file://") }
                runCatching { File(fPath).delete() }
                val artPath = obj.optString("artworkPath", "")
                if (artPath.isNotEmpty()) runCatching { File(artPath).delete() }
            } else {
                kept.put(obj)
            }
        }
        prefs.edit().putString(OFFLINE_KEY, kept.toString()).apply()
    }

    fun clearStreamCache(context: Context) {
        val offlineDir = File(context.filesDir, "ryotunes_offline")
        if (offlineDir.exists()) offlineDir.deleteRecursively()
        context.getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        cachedScClientId = ""
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private fun searchYouTubeMusic(query: String): List<JSObject> {
        val payload = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB_REMIX")
                    put("clientVersion", "1.20241104.01.00")
                    put("hl", "en")
                    put("gl", "US")
                })
            })
            put("query", query)
            put("params", "EgWKAQIIAWoMEAMQBBAJEAoQBRAV")
        }
        val body = httpPostJson("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", payload.toString(), "Mozilla/5.0")
        val json = JSONObject(body)
        val tabs = json.optJSONObject("contents")
            ?.optJSONObject("tabbedSearchResultsRenderer")
            ?.optJSONArray("tabs")
            ?.optJSONObject(0)
            ?.optJSONObject("tabRenderer")
            ?.optJSONObject("content")
            ?.optJSONObject("sectionListRenderer")
            ?.optJSONArray("contents") ?: return emptyList()

        val list = mutableListOf<JSObject>()
        for (sIdx in 0 until tabs.length()) {
            val rows = tabs.optJSONObject(sIdx)
                ?.optJSONObject("musicShelfRenderer")
                ?.optJSONArray("contents") ?: continue
            for (rIdx in 0 until rows.length()) {
                val renderer = rows.optJSONObject(rIdx)?.optJSONObject("musicResponsiveListItemRenderer") ?: continue
                val vid = renderer.optJSONObject("playlistItemData")?.optString("videoId", "") ?: ""
                if (vid.isEmpty()) continue
                val flexCols = renderer.optJSONArray("flexColumns") ?: continue
                val title = extractRuns(flexCols.optJSONObject(0))
                if (title.isEmpty()) continue
                val metaParts = extractRunsList(flexCols.optJSONObject(1))
                    .filter { it != "•" && it != "·" && it != "," && it != "&" }
                val artist = metaParts.firstOrNull() ?: "YouTube Music"
                val lastPart = metaParts.lastOrNull() ?: ""
                val dur = parseDuration(lastPart)
                val album = if (metaParts.size >= 3) metaParts[metaParts.size - 2] else "YouTube Music"

                val thumbs = renderer.optJSONObject("thumbnail")
                    ?.optJSONObject("musicThumbnailRenderer")
                    ?.optJSONObject("thumbnail")
                    ?.optJSONArray("thumbnails")
                var thumb = if (thumbs != null && thumbs.length() > 0) {
                    thumbs.optJSONObject(thumbs.length() - 1)?.optString("url", "") ?: ""
                } else ""
                if (thumb.isEmpty()) thumb = "https://i.ytimg.com/vi/$vid/hqdefault.jpg"
                thumb = thumb.replace(Regex("=w\\d+-h\\d+[^&]*"), "=w512-h512-l90-rj")

                list.add(JSObject().apply {
                    put("id", "yt:$vid")
                    put("provider", "youtube")
                    put("remoteId", vid)
                    put("title", title)
                    put("artist", artist)
                    put("album", album)
                    put("duration", dur)
                    put("artwork", thumb)
                    put("format", "YTM AAC")
                })
                if (list.size >= 16) return list
            }
        }
        return list
    }

    internal fun getSoundCloudClientId(): String {
        val now = System.currentTimeMillis()
        if (cachedScClientId.isNotEmpty() && now - cachedScAtMs < 3_600_000L) {
            return cachedScClientId
        }
        val html = String(httpGetBytes("https://soundcloud.com", 6000))
        val matches = Regex("src=\"(https://a-v2\\.sndcdn\\.com/assets/[^\"]+\\.js)\"").findAll(html).toList()
        for (m in matches.takeLast(6).reversed()) {
            val js = runCatching { String(httpGetBytes(m.groupValues[1], 5000)) }.getOrDefault("")
            val cid = Regex("client_id\\s*:\\s*\"([a-zA-Z0-9]{20,40})\"").find(js)?.groupValues?.getOrNull(1)
            if (!cid.isNullOrEmpty()) {
                cachedScClientId = cid
                cachedScAtMs = now
                return cid
            }
        }
        return ""
    }

    private fun searchSoundCloud(query: String): List<JSObject> {
        val cid = getSoundCloudClientId()
        if (cid.isEmpty()) return emptyList()
        val encQ = URLEncoder.encode(query, "UTF-8")
        val url = "https://api-v2.soundcloud.com/search/tracks?q=$encQ&client_id=$cid&limit=14"
        val json = JSONObject(String(httpGetBytes(url, 7000)))
        val arr = json.optJSONArray("collection") ?: return emptyList()
        val out = mutableListOf<JSObject>()
        for (i in 0 until arr.length()) {
            val t = arr.optJSONObject(i) ?: continue
            val scId = t.optLong("id", 0L)
            val title = t.optString("title", "")
            if (scId <= 0L || title.isEmpty()) continue
            val user = t.optJSONObject("user")
            val art = (t.optString("artwork_url", "").ifEmpty { user?.optString("avatar_url", "") ?: "" })
                .replace("-large.", "-t500x500.")
            out.add(JSObject().apply {
                put("id", "sc:$scId")
                put("provider", "soundcloud")
                put("remoteId", scId.toString())
                put("title", title)
                put("artist", user?.optString("username", "SoundCloud") ?: "SoundCloud")
                put("album", t.optString("genre", "SoundCloud").ifBlank { "SoundCloud" })
                put("duration", (t.optLong("duration", 0L) / 1000.0))
                if (art.isNotEmpty()) put("artwork", art)
                put("format", "SOUNDCLOUD")
            })
        }
        return out
    }

    private fun searchCatalog(query: String, provider: String): List<JSObject> {
        val encQ = URLEncoder.encode(query, "UTF-8")
        val url = "https://itunes.apple.com/search?term=$encQ&media=music&entity=song&limit=14"
        val json = JSONObject(String(httpGetBytes(url, 6000)))
        val arr = json.optJSONArray("results") ?: return emptyList()
        val out = mutableListOf<JSObject>()
        for (i in 0 until arr.length()) {
            val r = arr.optJSONObject(i) ?: continue
            val tid = r.optLong("trackId", 0L)
            val title = r.optString("trackName", "")
            if (tid <= 0L || title.isEmpty()) continue
            val art = r.optString("artworkUrl100", "").replace("100x100bb", "600x600bb")
            out.add(JSObject().apply {
                put("id", "$provider:track:$tid")
                put("provider", provider)
                put("remoteId", tid.toString())
                put("title", title)
                put("artist", r.optString("artistName", "Unknown Artist"))
                put("album", r.optString("collectionName", if (provider == "spotify") "Spotify" else "TIDAL Masters"))
                put("duration", (r.optLong("trackTimeMillis", 0L) / 1000.0))
                if (art.isNotEmpty()) put("artwork", art)
                put("format", if (provider == "spotify") "SPOTIFY" else "TIDAL FLAC")
            })
        }
        return out
    }

    private fun ensureYtClientConfig(videoId: String): Pair<String, String> {
        val now = System.currentTimeMillis()
        if (cachedYtApiKey.isNotEmpty() && cachedYtVisitorData.isNotEmpty() && now - cachedYtCfgAtMs < 1_800_000L) {
            return cachedYtApiKey to cachedYtVisitorData
        }
        val html = String(httpGetBytes("https://www.youtube.com/watch?v=$videoId", 8000))
        val key = Regex("\"INNERTUBE_API_KEY\"\\s*:\\s*\"([^\"]+)\"").find(html)?.groupValues?.getOrNull(1) ?: ""
        val vd = Regex("\"VISITOR_DATA\"\\s*:\\s*\"([^\"]+)\"").find(html)?.groupValues?.getOrNull(1) ?: ""
        if (key.isNotEmpty() && vd.isNotEmpty()) {
            cachedYtApiKey = key
            cachedYtVisitorData = vd
            cachedYtCfgAtMs = now
        }
        return key to vd
    }

    private fun pickAudioFormatStream(
        json: JSONObject,
        quality: String,
        preferProgressiveForDownload: Boolean = false
    ): ResolvedStream? {
        val fmts = json.optJSONObject("streamingData")?.optJSONArray("adaptiveFormats") ?: JSONArray()
        val rawAudioList = mutableListOf<JSONObject>()
        for (i in 0 until fmts.length()) {
            val f = fmts.optJSONObject(i) ?: continue
            val mime = f.optString("mimeType", "")
            val url = f.optString("url", "")
            if (url.isNotEmpty() && mime.startsWith("audio/") &&
                !url.contains(".m3u8", ignoreCase = true) &&
                !mime.contains("mpegURL", ignoreCase = true)
            ) {
                rawAudioList.add(f)
            }
        }
        if (rawAudioList.isEmpty()) return null

        val highBitrateList = rawAudioList.filter { it.optInt("bitrate", 0) >= 96000 }
        val pool = if (quality != "LOW" && highBitrateList.isNotEmpty()) highBitrateList else rawAudioList

        val picked = if (quality == "LOW") {
            pool.minByOrNull { it.optInt("bitrate", Int.MAX_VALUE) }
        } else {
            // Hi-Fi priority: itag 251 (WebM Opus ~160kbps @ 48kHz) -> itag 141 (256kbps AAC) -> itag 140 (128kbps AAC-LC) -> max bitrate
            // Note: itag 140/251 are direct progressive audio streams suitable for bounded chunked download
            pool.sortedWith(
                compareByDescending<JSONObject> { f ->
                    val itag = f.optInt("itag", -1)
                    if (preferProgressiveForDownload) {
                        when (itag) {
                            140 -> 5
                            251 -> 4
                            141 -> 3
                            else -> 0
                        }
                    } else {
                        when (itag) {
                            251 -> 4
                            141 -> 3
                            140 -> 2
                            else -> if (f.optString("mimeType", "").contains("opus")) 1 else 0
                        }
                    }
                }.thenByDescending { it.optInt("bitrate", 0) }
            ).firstOrNull()
        } ?: return null

        val dur = json.optJSONObject("videoDetails")?.optString("lengthSeconds", "0")?.toDoubleOrNull() ?: 0.0
        return ResolvedStream(
            streamUrl = picked.getString("url"),
            mimeType = picked.optString("mimeType", "audio/mp4").substringBefore(";"),
            durationSec = dur,
            waveform = emptyList()
        )
    }

    private fun resolveYoutubeAudio(
        videoId: String,
        quality: String,
        preferProgressiveForDownload: Boolean = false,
        skipVisionOs: Boolean = false
    ): ResolvedStream {
        // Primary: VISIONOS client returns full un-throttled audio/mp4 & audio/webm streams (200 OK / 206 Range)
        if (!skipVisionOs) {
            val voResult = runCatching {
                val (apiKey, visitorData) = ensureYtClientConfig(videoId)
                val payload = JSONObject().apply {
                    put("context", JSONObject().apply {
                        put("client", JSONObject().apply {
                            put("clientName", "VISIONOS")
                            put("clientVersion", "1.02")
                            put("deviceMake", "Apple")
                            put("deviceModel", "RealityDevice17,1")
                            put("userAgent", ChunkedGoogleVideoDataSource.UA_VISIONOS)
                            put("osName", "visionOS")
                            put("osVersion", "26.5.23O471")
                            put("hl", "en")
                            put("gl", "US")
                            if (visitorData.isNotEmpty()) put("visitorData", visitorData)
                        })
                    })
                    put("videoId", videoId)
                    put("contentCheckOk", true)
                    put("racyCheckOk", true)
                }
                val endpoint = if (apiKey.isNotEmpty()) {
                    "https://www.youtube.com/youtubei/v1/player?key=$apiKey&prettyPrint=false"
                } else {
                    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
                }
                val extraHeaders = mutableMapOf(
                    "Origin" to "https://www.youtube.com",
                    "X-YouTube-Client-Name" to "101",
                    "X-YouTube-Client-Version" to "1.02"
                )
                if (visitorData.isNotEmpty()) extraHeaders["X-Goog-Visitor-Id"] = visitorData
                val body = httpPostJson(endpoint, payload.toString(), ChunkedGoogleVideoDataSource.UA_VISIONOS, extraHeaders)
                pickAudioFormatStream(JSONObject(body), quality, preferProgressiveForDownload)
            }.getOrNull()
            if (voResult != null) return voResult
        }

        // Fallback: IOS client (bounded 512KB Range downloads supported by ChunkedGoogleVideoDataSource)
        val payload = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "IOS")
                    put("clientVersion", "21.26.4")
                    put("deviceMake", "Apple")
                    put("deviceModel", "iPhone16,2")
                    put("osName", "iPhone")
                    put("osVersion", "18.3.2.22D82")
                    put("hl", "en")
                    put("gl", "US")
                })
            })
            put("videoId", videoId)
        }
        val body = httpPostJson("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", payload.toString(), ChunkedGoogleVideoDataSource.UA_IOS)
        val json = JSONObject(body)
        pickAudioFormatStream(json, quality, preferProgressiveForDownload)?.let { return it }

        if (!preferProgressiveForDownload) {
            val hls = json.optJSONObject("streamingData")?.optString("hlsManifestUrl", "") ?: ""
            val dur = json.optJSONObject("videoDetails")?.optString("lengthSeconds", "0")?.toDoubleOrNull() ?: 0.0
            if (hls.isNotEmpty()) {
                return ResolvedStream(
                    streamUrl = hls,
                    mimeType = "application/x-mpegURL",
                    durationSec = dur,
                    waveform = emptyList()
                )
            }
        }
        throw IllegalStateException("No playable progressive YouTube audio stream")
    }

    private fun resolveSoundCloudAudio(
        scId: String,
        quality: String,
        preferProgressiveForDownload: Boolean
    ): ResolvedStream {
        val cid = getSoundCloudClientId()
        if (cid.isEmpty()) throw IllegalStateException("SoundCloud client_id unavailable")
        val track = JSONObject(String(httpGetBytes("https://api-v2.soundcloud.com/tracks/$scId?client_id=$cid", 7000)))
        val dur = track.optLong("duration", 0L) / 1000.0
        val wfUrl = track.optString("waveform_url", "")
        val waveform = if (wfUrl.startsWith("http")) {
            runCatching {
                val samples = JSONObject(String(httpGetBytes(wfUrl, 4000))).optJSONArray("samples") ?: JSONArray()
                resampleWaveform(samples)
            }.getOrDefault(emptyList())
        } else emptyList()

        val transcodings = track.optJSONObject("media")?.optJSONArray("transcodings") ?: JSONArray()
        val candidates = mutableListOf<Triple<Int, Boolean, Pair<String, String>>>()
        for (i in 0 until transcodings.length()) {
            val t = transcodings.optJSONObject(i) ?: continue
            val fmt = t.optJSONObject("format")
            val proto = fmt?.optString("protocol", "") ?: ""
            val mime = fmt?.optString("mime_type", "") ?: ""
            val preset = t.optString("preset", "")
            val qStr = t.optString("quality", "")
            val tUrl = t.optString("url", "")
            if (tUrl.isEmpty()) continue
            val isProg = proto == "progressive"
            var score = if (qStr == "hq") 40 else 10
            if (preset.contains("aac_160", ignoreCase = true) || mime.contains("aac", ignoreCase = true)) score += 30
            else if (preset.contains("opus", ignoreCase = true) || mime.contains("ogg", ignoreCase = true)) score += 25
            else if (preset.contains("mp3", ignoreCase = true) || mime.contains("mpeg", ignoreCase = true)) score += 15
            if (preferProgressiveForDownload && isProg) score += 100
            val outMime = when {
                !isProg -> "application/x-mpegURL"
                mime.contains("ogg") || mime.contains("opus") -> "audio/ogg"
                mime.contains("mp4") || mime.contains("aac") -> "audio/mp4"
                else -> "audio/mpeg"
            }
            candidates.add(Triple(score, isProg, tUrl to outMime))
        }
        candidates.sortByDescending { it.first }

        for ((_, isProg, urlAndMime) in candidates) {
            if (preferProgressiveForDownload && !isProg) continue
            val (tUrl, outMime) = urlAndMime
            val u = runCatching {
                JSONObject(String(httpGetBytes("$tUrl?client_id=$cid", 6000))).optString("url", "")
            }.getOrDefault("")
            if (u.isNotEmpty()) return ResolvedStream(u, outMime, dur, waveform)
        }

        val artist = track.optJSONObject("user")?.optString("username", "") ?: ""
        val title = track.optString("title", "")
        val ytMatches = searchYouTubeMusic("$artist $title".trim())
        val vid = ytMatches.firstOrNull()?.optString("remoteId", "") ?: ""
        if (vid.isNotEmpty()) {
            val r = resolveYoutubeAudio(vid, quality)
            return r.copy(waveform = waveform)
        }
        throw IllegalStateException("SoundCloud stream unavailable")
    }

    private fun extractRuns(flexObj: JSONObject?): String {
        return extractRunsList(flexObj).joinToString("").trim()
    }

    private fun extractRunsList(flexObj: JSONObject?): List<String> {
        val runs = flexObj
            ?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?.optJSONObject("text")
            ?.optJSONArray("runs") ?: return emptyList()
        val out = mutableListOf<String>()
        for (i in 0 until runs.length()) {
            val txt = runs.optJSONObject(i)?.optString("text", "")?.trim() ?: ""
            if (txt.isNotEmpty()) out.add(txt)
        }
        return out
    }

    private fun parseDuration(text: String): Double {
        if (!Regex("^\\d+:\\d{2}(:\\d{2})?$").matches(text)) return 0.0
        val parts = text.split(":").mapNotNull { it.toIntOrNull() }
        return when (parts.size) {
            2 -> (parts[0] * 60 + parts[1]).toDouble()
            3 -> (parts[0] * 3600 + parts[1] * 60 + parts[2]).toDouble()
            else -> 0.0
        }
    }

    private fun resampleWaveform(samples: JSONArray): List<Int> {
        if (samples.length() == 0) return emptyList()
        val count = 240
        val out = ArrayList<Int>(count)
        for (i in 0 until count) {
            val idx = (i * samples.length()) / count
            out.add(samples.optInt(idx, 12).coerceIn(4, 100))
        }
        return out
    }

    private fun jsonArrayToIntList(arr: JSONArray?): List<Int> {
        if (arr == null) return emptyList()
        val out = ArrayList<Int>(arr.length())
        for (i in 0 until arr.length()) out.add(arr.optInt(i, 12))
        return out
    }

    fun resolveOfflineUriIfSaved(context: Context, id: String): Pair<String, String?>? {
        val rec = getOfflineRecord(context, id) ?: return null
        val path = rec.optString("localPath", "").ifBlank {
            rec.optString("src", "").removePrefix("file://")
        }
        val f = File(path)
        if (!f.exists() || f.length() <= 32_768L) return null
        val uri = Uri.fromFile(f).toString()
        val mime = rec.optString("mimeType", "").ifBlank {
            when {
                path.endsWith(".webm", ignoreCase = true) -> "audio/webm"
                path.endsWith(".mp3", ignoreCase = true) -> "audio/mpeg"
                path.endsWith(".ogg", ignoreCase = true) -> "audio/ogg"
                else -> "audio/mp4"
            }
        }
        return uri to mime
    }

    private fun getOfflineRecord(context: Context, id: String): JSONObject? {
        val prefs = context.getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE)
        val arr = runCatching { JSONArray(prefs.getString(OFFLINE_KEY, "[]") ?: "[]") }.getOrDefault(JSONArray())
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            if (obj.optString("id", "") == id || obj.optString("originalId", "") == id) return obj
        }
        return null
    }

    private fun upsertOfflineRecord(context: Context, rec: JSObject) {
        val prefs = context.getSharedPreferences(OFFLINE_PREFS, Context.MODE_PRIVATE)
        val arr = runCatching { JSONArray(prefs.getString(OFFLINE_KEY, "[]") ?: "[]") }.getOrDefault(JSONArray())
        val targetId = rec.optString("id", "")
        val origId = rec.optString("originalId", targetId)
        val next = JSONArray()
        next.put(JSONObject(rec.toString()))
        for (i in 0 until arr.length()) {
            val existing = arr.optJSONObject(i) ?: continue
            val exId = existing.optString("id", "")
            val exOrig = existing.optString("originalId", "")
            if (exId != targetId && exId != origId && exOrig != targetId) next.put(existing)
        }
        prefs.edit().putString(OFFLINE_KEY, next.toString()).apply()
    }

    /**
     * Download audio stream via shared Media3 DefaultHttpDataSource + ChunkedGoogleVideoDataSource
     * matching c=VISIONOS / c=IOS User-Agents, cross-protocol redirects and bounded 512KB Range chunks.
     */
    @OptIn(UnstableApi::class)
    private fun downloadUrlToFile(urlStr: String, outFile: File, onProgress: (Int) -> Unit) {
        val parsedUri = Uri.parse(urlStr)
        val ua = when {
            urlStr.contains("c=VISIONOS", ignoreCase = true) -> ChunkedGoogleVideoDataSource.UA_VISIONOS
            urlStr.contains("c=IOS", ignoreCase = true) -> ChunkedGoogleVideoDataSource.UA_IOS
            else -> STREAM_UA
        }
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(ua)
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(15_000)
            .setAllowCrossProtocolRedirects(true)
        val ds = ChunkedGoogleVideoDataSource(httpFactory.createDataSource())
        val spec = DataSpec.Builder()
            .setUri(parsedUri)
            .build()
        var success = false
        try {
            val openedLen = ds.open(spec)
            val clenParam = parsedUri.getQueryParameter("clen")?.toLongOrNull() ?: 0L
            val total = when {
                openedLen > 0L -> openedLen
                clenParam > 0L -> clenParam
                else -> 1L
            }
            var downloaded = 0L
            FileOutputStream(outFile).use { fos ->
                val buf = ByteArray(32 * 1024)
                while (true) {
                    val read = ds.read(buf, 0, buf.size)
                    if (read == C.RESULT_END_OF_INPUT || read < 0) break
                    if (read == 0) continue
                    fos.write(buf, 0, read)
                    downloaded += read
                    val pct = if (total > 1L) {
                        (22 + ((downloaded * 70) / total)).toInt().coerceIn(22, 92)
                    } else {
                        minOf(92, 22 + (downloaded / (32 * 1024)).toInt())
                    }
                    onProgress(pct)
                }
                fos.flush()
            }
            if (downloaded <= 32_768L) {
                throw IllegalStateException("Downloaded audio too small ($downloaded bytes)")
            }
            success = true
        } finally {
            runCatching { ds.close() }
            if (!success) {
                runCatching { outFile.delete() }
            }
        }
    }

    private fun httpGetBytes(urlStr: String, timeoutMs: Int): ByteArray {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            setRequestProperty("User-Agent", "Mozilla/5.0")
            instanceFollowRedirects = true
        }
        return try {
            conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    }

    private fun httpPostJson(
        urlStr: String,
        body: String,
        userAgent: String,
        extraHeaders: Map<String, String> = emptyMap()
    ): String {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("User-Agent", userAgent)
            extraHeaders.forEach { (k, v) -> setRequestProperty(k, v) }
        }
        return try {
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Fetches synced (LRC) and plain lyrics from LRCLIB (/api/get + /api/search fallback).
     */
    fun fetchLyrics(
        title: String,
        artist: String,
        album: String = "",
        durationSec: Double = 0.0
    ): JSObject {
        val cleanTitle = cleanLyricsQuery(title)
        val cleanArtist = cleanLyricsArtist(artist)
        val result = JSObject().apply {
            put("syncedLyrics", "")
            put("plainLyrics", "")
            put("source", "")
        }
        if (cleanTitle.isBlank()) return result

        val encTitle = URLEncoder.encode(cleanTitle, "UTF-8")
        val encArtist = URLEncoder.encode(cleanArtist, "UTF-8")

        // 1) Exact match via /api/get
        val getParams = StringBuilder("track_name=").append(encTitle)
        if (cleanArtist.isNotBlank()) getParams.append("&artist_name=").append(encArtist)
        val cleanAlbum = album.trim()
        if (cleanAlbum.isNotBlank() && !cleanAlbum.equals("Local Audio", ignoreCase = true)) {
            getParams.append("&album_name=").append(URLEncoder.encode(cleanAlbum, "UTF-8"))
        }
        if (durationSec > 1.0) {
            getParams.append("&duration=").append(durationSec.roundToInt())
        }
        val exactJson = httpGetNullable("https://lrclib.net/api/get?$getParams")
        if (!exactJson.isNullOrBlank()) {
            val obj = runCatching { JSONObject(exactJson) }.getOrNull()
            val synced = obj?.optString("syncedLyrics", "")?.takeIf { it.isNotBlank() && it != "null" } ?: ""
            val plain = obj?.optString("plainLyrics", "")?.takeIf { it.isNotBlank() && it != "null" } ?: ""
            if (synced.isNotBlank() || plain.isNotBlank()) {
                result.put("syncedLyrics", synced)
                result.put("plainLyrics", plain)
                result.put("source", "lrclib")
                return result
            }
        }

        // 2) Search fallback (/api/search)
        val searchQueries = buildList {
            if (cleanArtist.isNotBlank()) {
                add("https://lrclib.net/api/search?track_name=$encTitle&artist_name=$encArtist")
                add("https://lrclib.net/api/search?q=${URLEncoder.encode("$cleanArtist $cleanTitle", "UTF-8")}")
            }
            add("https://lrclib.net/api/search?q=$encTitle")
        }
        for (url in searchQueries) {
            val raw = httpGetNullable(url) ?: continue
            val arr = runCatching { JSONArray(raw) }.getOrNull() ?: continue
            if (arr.length() == 0) continue

            var bestObj: JSONObject? = null
            var bestScore = Double.NEGATIVE_INFINITY
            for (i in 0 until minOf(arr.length(), 10)) {
                val item = arr.optJSONObject(i) ?: continue
                val synced = item.optString("syncedLyrics", "").takeIf { it.isNotBlank() && it != "null" } ?: ""
                val plain = item.optString("plainLyrics", "").takeIf { it.isNotBlank() && it != "null" } ?: ""
                if (synced.isBlank() && plain.isBlank()) continue

                var score = if (synced.isNotBlank()) 100.0 else 40.0
                val itemDur = item.optDouble("duration", 0.0)
                if (durationSec > 1.0 && itemDur > 1.0) {
                    score -= kotlin.math.abs(itemDur - durationSec) * 0.5
                }
                val itemArtist = item.optString("artistName", "")
                if (cleanArtist.isNotBlank() && itemArtist.contains(cleanArtist, ignoreCase = true)) {
                    score += 30.0
                }
                if (score > bestScore) {
                    bestScore = score
                    bestObj = item
                }
            }
            if (bestObj != null) {
                val synced = bestObj.optString("syncedLyrics", "").takeIf { it.isNotBlank() && it != "null" } ?: ""
                val plain = bestObj.optString("plainLyrics", "").takeIf { it.isNotBlank() && it != "null" } ?: ""
                result.put("syncedLyrics", synced)
                result.put("plainLyrics", plain)
                result.put("source", "lrclib")
                return result
            }
        }
        return result
    }

    private fun httpGetNullable(urlStr: String, timeoutMs: Int = 7000): String? {
        return runCatching {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                setRequestProperty("User-Agent", "Ryotunes/1.2.6 (Android)")
                instanceFollowRedirects = true
            }
            try {
                if (conn.responseCode in 200..299) {
                    conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                } else null
            } finally {
                conn.disconnect()
            }
        }.getOrNull()
    }

    private fun cleanLyricsQuery(raw: String): String {
        return raw
            .replace(Regex("""\s*[\(\[](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyrics?|audio|explicit|hd|4k|remastered(?:\s*\d{4})?|feat\.?[^\)\]]*|ft\.?[^\)\]]*)[\)\]]""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""\s+-\s+(?:official\s*(?:video|audio)|topic).*""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""\s{2,}"""), " ")
            .trim()
    }

    private fun cleanLyricsArtist(raw: String): String {
        val cleaned = raw
            .replace(Regex("""\s*-\s*Topic$""", RegexOption.IGNORE_CASE), "")
            .split(',', '&', ';')
            .firstOrNull()
            ?.trim()
            ?: ""
        return if (cleaned.equals("Unknown Artist", ignoreCase = true) || cleaned.equals("RYOTUNES", ignoreCase = true)) {
            ""
        } else cleaned
    }
}
