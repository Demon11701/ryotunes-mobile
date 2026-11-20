package dev.ryoku.ryotunes

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import com.getcapacitor.JSObject

/**
 * Private on-device account session vault (MODE_PRIVATE SharedPreferences).
 * Never exposes raw cookies or OAuth tokens to JS or logcat.
 */
object RyotunesAccountVault {

    private const val PREFS_NAME = "ryotunes_accounts_vault"

    data class AccountSession(
        val provider: String,
        val cookieHeader: String,
        val primaryToken: String,
        val accountName: String,
        val connectedAt: Long,
        val accessToken: String = "",
        val clientToken: String = "",
        val tokenCapturedAt: Long = 0L
    )

    fun normalizeProvider(raw: String): String {
        return when (raw.trim().lowercase()) {
            "youtube", "yt", "ytmusic", "youtube-music" -> "ytmusic"
            "spotify", "sp" -> "spotify"
            "soundcloud", "sc" -> "soundcloud"
            "tidal", "td" -> "tidal"
            else -> raw.trim().lowercase()
        }
    }

    fun saveSession(
        context: Context,
        rawProvider: String,
        cookieHeader: String,
        primaryToken: String,
        accountName: String,
        accessToken: String = "",
        clientToken: String = ""
    ) {
        val p = normalizeProvider(rawProvider)
        val cleanName = accountName.trim().ifBlank { defaultAccountLabel(p) }
        val now = System.currentTimeMillis()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            putBoolean("${p}_connected", true)
            putString("${p}_cookie", cookieHeader)
            putString("${p}_token", primaryToken)
            putString("${p}_name", cleanName)
            putLong("${p}_at", now)
            if (accessToken.isNotBlank()) {
                putString("${p}_access_token", accessToken.trim())
                putLong("${p}_token_at", now)
            }
            if (clientToken.isNotBlank()) {
                putString("${p}_client_token", clientToken.trim())
            }
            apply()
        }
    }

    fun updateTokens(
        context: Context,
        rawProvider: String,
        accessToken: String,
        clientToken: String = ""
    ) {
        val p = normalizeProvider(rawProvider)
        if (accessToken.isBlank() && clientToken.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            if (accessToken.isNotBlank()) {
                putString("${p}_access_token", accessToken.trim())
                putLong("${p}_token_at", System.currentTimeMillis())
            }
            if (clientToken.isNotBlank()) {
                putString("${p}_client_token", clientToken.trim())
            }
            apply()
        }
    }

    fun updateAccountName(context: Context, rawProvider: String, accountName: String) {
        val p = normalizeProvider(rawProvider)
        if (accountName.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean("${p}_connected", false)) return
        prefs.edit().putString("${p}_name", accountName.trim()).apply()
    }

    fun saveScrapedLibraryJson(context: Context, rawProvider: String, json: String) {
        val p = normalizeProvider(rawProvider)
        if (json.isBlank()) return
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("${p}_scraped_lib", json)
            .apply()
    }

    fun getScrapedLibraryJson(context: Context, rawProvider: String): String {
        val p = normalizeProvider(rawProvider)
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("${p}_scraped_lib", "") ?: ""
    }

    fun getSession(context: Context, rawProvider: String): AccountSession? {
        val p = normalizeProvider(rawProvider)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean("${p}_connected", false)) return null
        val cookie = prefs.getString("${p}_cookie", "") ?: ""
        val token = prefs.getString("${p}_token", "") ?: ""
        val accessToken = prefs.getString("${p}_access_token", "") ?: ""
        val clientToken = prefs.getString("${p}_client_token", "") ?: ""
        val tokenAt = prefs.getLong("${p}_token_at", 0L)
        if (cookie.isBlank() && token.isBlank() && accessToken.isBlank()) return null
        val name = prefs.getString("${p}_name", defaultAccountLabel(p)) ?: defaultAccountLabel(p)
        val at = prefs.getLong("${p}_at", 0L)
        return AccountSession(p, cookie, token, name, at, accessToken, clientToken, tokenAt)
    }

    fun disconnect(context: Context, rawProvider: String) {
        val p = normalizeProvider(rawProvider)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            remove("${p}_connected")
            remove("${p}_cookie")
            remove("${p}_token")
            remove("${p}_access_token")
            remove("${p}_client_token")
            remove("${p}_token_at")
            remove("${p}_scraped_lib")
            remove("${p}_name")
            remove("${p}_at")
            apply()
        }
        clearWebViewCookiesForProvider(p)
    }

    fun getConnectedAccountsJson(context: Context): JSObject {
        val out = JSObject()
        for (p in listOf("ytmusic", "spotify", "soundcloud", "tidal")) {
            val s = getSession(context, p)
            out.put(p, JSObject().apply {
                put("provider", p)
                put("connected", s != null)
                put("accountName", s?.accountName ?: "")
                put("connectedAt", s?.connectedAt ?: 0L)
            })
        }
        return out
    }

    fun parseCookieMap(cookieHeader: String?): Map<String, String> {
        if (cookieHeader.isNullOrBlank()) return emptyMap()
        val map = LinkedHashMap<String, String>()
        cookieHeader.split(';').forEach { part ->
            val idx = part.indexOf('=')
            if (idx > 0) {
                val k = part.substring(0, idx).trim()
                val v = part.substring(idx + 1).trim()
                if (k.isNotEmpty()) map[k] = v
            }
        }
        return map
    }

    private fun clearWebViewCookiesForProvider(provider: String) {
        try {
            val cm = CookieManager.getInstance()
            val urls = when (provider) {
                "ytmusic" -> listOf("https://music.youtube.com", "https://youtube.com", "https://accounts.google.com")
                "spotify" -> listOf(
                    "https://open.spotify.com",
                    "https://accounts.spotify.com",
                    "https://spotify.com",
                    "https://.spotify.com"
                )
                "soundcloud" -> listOf("https://soundcloud.com", "https://secure.soundcloud.com")
                "tidal" -> listOf("https://listen.tidal.com", "https://login.tidal.com", "https://tidal.com")
                else -> emptyList()
            }
            val rootDomain = when (provider) {
                "ytmusic" -> ".youtube.com"
                "spotify" -> ".spotify.com"
                "soundcloud" -> ".soundcloud.com"
                "tidal" -> ".tidal.com"
                else -> ""
            }
            val expSuffix = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
            for (u in urls) {
                val raw = cm.getCookie(u) ?: continue
                raw.split(';').forEach { pair ->
                    val name = pair.substringBefore('=').trim()
                    if (name.isNotEmpty()) {
                        cm.setCookie(u, "$name=; $expSuffix")
                        cm.setCookie(u, "$name=; $expSuffix; Secure")
                        if (rootDomain.isNotEmpty()) {
                            cm.setCookie(u, "$name=; Domain=$rootDomain; $expSuffix")
                            cm.setCookie(u, "$name=; Domain=$rootDomain; $expSuffix; Secure")
                        }
                    }
                }
            }
            if (provider == "spotify") {
                val spotifyAuthCookies = listOf(
                    "sp_dc",
                    "sp_t",
                    "sp_key",
                    "sp_landing",
                    "sp_phash",
                    "__Host-sp_csrf_sid",
                    "sp_sso_csrf_token"
                )
                for (name in spotifyAuthCookies) {
                    for (u in urls) {
                        cm.setCookie(u, "$name=; $expSuffix")
                        cm.setCookie(u, "$name=; $expSuffix; Secure")
                        cm.setCookie(u, "$name=; Domain=.spotify.com; $expSuffix; Secure")
                    }
                }
            }
            cm.flush()

            // Clear WebStorage (localStorage / IndexedDB) for provider origins
            runCatching {
                val ws = WebStorage.getInstance()
                urls.filter { !it.contains("://.") }.forEach { origin ->
                    ws.deleteOrigin(origin)
                }
            }
        } catch (_: Throwable) {
            // Safe no-op if WebView provider is uninitialized
        }
    }

    private fun defaultAccountLabel(provider: String): String {
        return when (provider) {
            "ytmusic" -> "YouTube Music Account"
            "spotify" -> "Spotify Account"
            "soundcloud" -> "SoundCloud Account"
            "tidal" -> "TIDAL Account"
            else -> "Connected Account"
        }
    }
}
