package dev.ryoku.ryotunes

import com.getcapacitor.JSObject
import org.json.JSONObject

data class NativeTrack(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationSec: Double,
    val contentUri: String,
    val artworkPath: String? = null,
    val artworkUrl: String? = null,
    val format: String = "AUDIO",
    val lyricsText: String? = null,
    val mimeType: String? = null
) {
    fun toJSObject(convertedArtUrl: String?): JSObject {
        return JSObject().apply {
            put("id", id)
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("duration", durationSec)
            put("src", contentUri)
            if (convertedArtUrl != null) put("artwork", convertedArtUrl)
            if (artworkPath != null) put("artworkPath", artworkPath)
            put("format", format)
            put("source", "local")
            if (lyricsText != null) put("lyricsText", lyricsText)
            if (mimeType != null) put("mimeType", mimeType)
        }
    }

    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("id", id)
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("duration", durationSec)
            put("src", contentUri)
            if (artworkPath != null) put("artworkPath", artworkPath)
            if (artworkUrl != null) put("artwork", artworkUrl)
            put("format", format)
            if (mimeType != null) put("mimeType", mimeType)
        }
    }

    companion object {
        fun fromJson(obj: JSONObject): NativeTrack {
            return NativeTrack(
                id = obj.optString("id", ""),
                title = obj.optString("title", "Untitled Track"),
                artist = obj.optString("artist", "Unknown Artist"),
                album = obj.optString("album", "Local Device"),
                durationSec = obj.optDouble("duration", 0.0),
                contentUri = obj.optString("src", ""),
                artworkPath = obj.optString("artworkPath", "").takeIf { it.isNotEmpty() },
                artworkUrl = obj.optString("artwork", "").takeIf { it.startsWith("http") },
                format = obj.optString("format", "AUDIO"),
                mimeType = obj.optString("mimeType", "").takeIf { it.isNotEmpty() }
            )
        }
    }
}

object RyoFormat {
    fun formatClock(seconds: Double): String {
        val safe = if (seconds.isFinite() && seconds > 0) seconds.toInt() else 0
        val m = safe / 60
        val s = safe % 60
        return "$m:${if (s < 10) "0$s" else "$s"}"
    }
}
