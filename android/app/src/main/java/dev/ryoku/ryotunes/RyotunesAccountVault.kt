package dev.ryoku.ryotunes

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.WebStorage
import com.getcapacitor.JSObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Private on-device account session vault (MODE_PRIVATE SharedPreferences) with
 * hardware-backed Android Keystore AES-256-GCM encryption at rest.
 * Never exposes raw cookies or OAuth tokens to JS or logcat.
 */
object RyotunesAccountVault {

    private const val PREFS_NAME = "ryotunes_accounts_vault"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val MASTER_KEY_ALIAS = "ryotunes_vault_master_key"
    private const val ENC_PREFIX = "enc:v1:"
    private const val GCM_IV_LEN_BYTES = 12
    private const val GCM_TAG_LEN_BITS = 128

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

    // ── Android Keystore AES-256-GCM Helpers ──────────────────────────────────

    @Synchronized
    private fun getOrCreateMasterKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = runCatching { ks.getKey(MASTER_KEY_ALIAS, null) as? SecretKey }.getOrNull()
        if (existing != null) return existing

        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            MASTER_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGen.init(spec)
        return keyGen.generateKey()
    }

    private fun encryptSecret(plain: String): String {
        if (plain.isEmpty()) return ""
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
            val iv = cipher.iv
            val cipherBytes = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            val combined = ByteArray(iv.size + cipherBytes.size)
            System.arraycopy(iv, 0, combined, 0, iv.size)
            System.arraycopy(cipherBytes, 0, combined, iv.size, cipherBytes.size)
            ENC_PREFIX + Base64.encodeToString(combined, Base64.NO_WRAP)
        }.getOrElse {
            // Do not crash on broken vendor Keystore; fail safe without leaking plaintext to logs
            ""
        }
    }

    private fun decryptSecret(stored: String?): Pair<String, Boolean> {
        if (stored.isNullOrEmpty()) return "" to false
        if (!stored.startsWith(ENC_PREFIX)) {
            // Transparent legacy plaintext migration flag = true
            return stored to true
        }
        val plain = runCatching {
            val b64 = stored.removePrefix(ENC_PREFIX)
            val combined = Base64.decode(b64, Base64.NO_WRAP)
            if (combined.size <= GCM_IV_LEN_BYTES) return@runCatching ""
            val iv = combined.copyOfRange(0, GCM_IV_LEN_BYTES)
            val ct = combined.copyOfRange(GCM_IV_LEN_BYTES, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateMasterKey(), GCMParameterSpec(GCM_TAG_LEN_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        }.getOrDefault("")
        return plain to false
    }

    /**
     * Redacts bearer tokens, auth cookies, and session secrets from error messages
     * before returning them to JS UI or logging.
     */
    fun sanitizeErrorMessage(msg: String?): String {
        if (msg.isNullOrBlank()) return "Error inesperado"
        return msg
            .replace(Regex("(?i)Bearer\\s+[A-Za-z0-9._~+/=-]+"), "Bearer [REDACTED]")
            .replace(Regex("(?i)OAuth\\s+[A-Za-z0-9._~+/=-]+"), "OAuth [REDACTED]")
            .replace(Regex("(?i)SAPISID(?:1P|3P)?HASH\\s+[A-Za-z0-9_]+"), "SAPISIDHASH [REDACTED]")
            .replace(Regex("(?i)(sp_dc|sp_key|sp_t|SAPISID|__Secure-3PAPISID|__Secure-1PAPISID|oauth_token|client-token|access_token|accessToken)\\s*[=:]\\s*[^;\\s\"'&,]+"), "$1=[REDACTED]")
            .take(280)
    }

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
        val encCookie = encryptSecret(cookieHeader)
        val encPrimary = encryptSecret(primaryToken)
        val encAccess = if (accessToken.isNotBlank()) encryptSecret(accessToken.trim()) else ""
        val encClient = if (clientToken.isNotBlank()) encryptSecret(clientToken.trim()) else ""

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
            putBoolean("${p}_connected", true)
            putString("${p}_cookie", encCookie)
            putString("${p}_token", encPrimary)
            putString("${p}_name", cleanName)
            putLong("${p}_at", now)
            if (encAccess.isNotBlank()) {
                putString("${p}_access_token", encAccess)
                putLong("${p}_token_at", now)
            }
            if (encClient.isNotBlank()) {
                putString("${p}_client_token", encClient)
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
                val encAccess = encryptSecret(accessToken.trim())
                if (encAccess.isNotBlank()) {
                    putString("${p}_access_token", encAccess)
                    putLong("${p}_token_at", System.currentTimeMillis())
                }
            }
            if (clientToken.isNotBlank()) {
                val encClient = encryptSecret(clientToken.trim())
                if (encClient.isNotBlank()) {
                    putString("${p}_client_token", encClient)
                }
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
        if (json.isBlank() || json.length > 2 * 1024 * 1024) return
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

        val (cookie, migCookie) = decryptSecret(prefs.getString("${p}_cookie", ""))
        val (token, migToken) = decryptSecret(prefs.getString("${p}_token", ""))
        val (accessToken, migAccess) = decryptSecret(prefs.getString("${p}_access_token", ""))
        val (clientToken, migClient) = decryptSecret(prefs.getString("${p}_client_token", ""))

        // Transparently re-encrypt any legacy plaintext values in-place so existing users stay signed in
        if (migCookie || migToken || migAccess || migClient) {
            prefs.edit().apply {
                if (migCookie && cookie.isNotBlank()) putString("${p}_cookie", encryptSecret(cookie))
                if (migToken && token.isNotBlank()) putString("${p}_token", encryptSecret(token))
                if (migAccess && accessToken.isNotBlank()) putString("${p}_access_token", encryptSecret(accessToken))
                if (migClient && clientToken.isNotBlank()) putString("${p}_client_token", encryptSecret(clientToken))
                apply()
            }
        }

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
