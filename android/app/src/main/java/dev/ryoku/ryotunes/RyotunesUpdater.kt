package dev.ryoku.ryotunes

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Native GitHub Releases OTA updater for Demon11701/ryotunes-mobile.
 * Supports SemVer + prerelease ordering, strict HTTPS origin/redirect allowlisting,
 * cryptographic APK signer SHA-256 verification against the installed app certificate,
 * Android 8+ unknown-sources handoff, and FileProvider installation.
 */
object RyotunesUpdater {

    private const val REPO_LATEST_URL =
        "https://api.github.com/repos/Demon11701/ryotunes-mobile/releases/latest"
    private const val REPO_LIST_URL =
        "https://api.github.com/repos/Demon11701/ryotunes-mobile/releases?per_page=1"
    private const val GITHUB_UA = "Ryotunes-Mobile"
    private const val ALLOWED_REPO_PREFIX = "https://github.com/Demon11701/ryotunes-mobile/"

    private fun isAllowedApkUrl(rawUrl: String): Boolean {
        val urlStr = rawUrl.trim()
        if (!urlStr.startsWith("https://", ignoreCase = true)) return false
        val parsed = runCatching { URL(urlStr) }.getOrNull() ?: return false
        if (!parsed.protocol.equals("https", ignoreCase = true)) return false
        val host = parsed.host?.lowercase().orEmpty()
        if (parsed.userInfo != null) return false
        if (parsed.port != -1 && parsed.port != 443) return false
        return when (host) {
            "github.com" -> urlStr.startsWith(ALLOWED_REPO_PREFIX)
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com" -> true
            else -> false
        }
    }

    private fun assertAllowedApkUrl(rawUrl: String) {
        if (!isAllowedApkUrl(rawUrl)) {
            throw SecurityException("Origen de descarga OTA no permitido")
        }
    }

    fun getAppVersionInfo(): JSObject {
        return JSObject().apply {
            put("versionName", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
        }
    }

    fun checkGithubUpdate(): JSObject {
        val currentVersion = BuildConfig.VERSION_NAME
        val releaseObj = fetchLatestReleaseJson()
        if (releaseObj == null) {
            return JSObject().apply {
                put("hasUpdate", false)
                put("currentVersion", currentVersion)
                put("latestVersion", currentVersion)
                put("releaseNotes", "")
                put("apkUrl", "")
                put("apkSizeBytes", 0L)
                put("publishedAt", "")
            }
        }

        val rawTag = releaseObj.optString("tag_name", "").trim()
        val latestVersion = rawTag.removePrefix("v").removePrefix("V")
        val releaseNotes = releaseObj.optString("body", "")
        val publishedAt = releaseObj.optString("published_at", "")
        val assets = releaseObj.optJSONArray("assets") ?: JSONArray()

        var bestApkUrl = ""
        var bestApkSize = 0L
        var fallbackApkUrl = ""
        var fallbackApkSize = 0L

        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            val name = asset.optString("name", "")
            val dlUrl = asset.optString("browser_download_url", "")
            val size = asset.optLong("size", 0L)
            if (!name.endsWith(".apk", ignoreCase = true) || !isAllowedApkUrl(dlUrl)) continue
            if (name.contains("release.apk", ignoreCase = true)) {
                bestApkUrl = dlUrl
                bestApkSize = size
                break
            }
            if (fallbackApkUrl.isBlank()) {
                fallbackApkUrl = dlUrl
                fallbackApkSize = size
            }
        }

        val finalApkUrl = bestApkUrl.ifBlank { fallbackApkUrl }
        val finalApkSize = if (bestApkUrl.isNotBlank()) bestApkSize else fallbackApkSize
        val hasUpdate = latestVersion.isNotBlank() &&
            isAllowedApkUrl(finalApkUrl) &&
            compareSemVer(latestVersion, currentVersion) > 0

        return JSObject().apply {
            put("hasUpdate", hasUpdate)
            put("currentVersion", currentVersion)
            put("latestVersion", latestVersion.ifBlank { currentVersion })
            put("releaseNotes", releaseNotes)
            put("apkUrl", finalApkUrl)
            put("apkSizeBytes", finalApkSize)
            put("publishedAt", publishedAt)
        }
    }

    private fun extractSignerSha256Set(info: PackageInfo?): Set<String> {
        if (info == null) return emptySet()
        val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val si = info.signingInfo
            when {
                si == null -> emptyArray()
                si.hasMultipleSigners() -> si.apkContentsSigners ?: emptyArray()
                else -> si.signingCertificateHistory ?: si.apkContentsSigners ?: emptyArray()
            }
        } else {
            @Suppress("DEPRECATION")
            info.signatures ?: emptyArray()
        }
        val md = MessageDigest.getInstance("SHA-256")
        val hashes = LinkedHashSet<String>()
        for (sig in sigs) {
            val digest = md.digest(sig.toByteArray())
            hashes.add(digest.joinToString("") { "%02x".format(it) })
        }
        return hashes
    }

    private fun verifyDownloadedApkSignature(context: Context, apkFile: File) {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }

        val archiveInfo = pm.getPackageArchiveInfo(apkFile.absolutePath, flags)
            ?: throw SecurityException("No se pudo inspeccionar el APK descargado")

        if (archiveInfo.packageName != context.packageName) {
            throw SecurityException("El identificador del APK no coincide con ${context.packageName}")
        }

        val installedInfo = pm.getPackageInfo(context.packageName, flags)
        val installedHashes = extractSignerSha256Set(installedInfo)
        val archiveHashes = extractSignerSha256Set(archiveInfo)

        if (installedHashes.isEmpty() || archiveHashes.isEmpty() || installedHashes != archiveHashes) {
            throw SecurityException("Firma criptográfica del APK inválida. Actualización cancelada por seguridad.")
        }
    }

    private fun purgeUpdateApks(updatesDir: File) {
        runCatching {
            updatesDir.listFiles()?.forEach { f ->
                if (f.isFile && f.name.endsWith(".apk", ignoreCase = true)) {
                    f.delete()
                }
            }
        }
    }

    fun downloadAndInstallUpdate(
        context: Context,
        apkUrl: String,
        onProgress: (Int) -> Unit
    ): JSObject {
        if (apkUrl.isBlank()) {
            throw IllegalArgumentException("Missing APK download URL")
        }
        assertAllowedApkUrl(apkUrl)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            val permIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(permIntent)
            return JSObject().apply {
                put("started", false)
                put("needsPermission", true)
            }
        }

        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        purgeUpdateApks(updatesDir)
        val apkFile = File(updatesDir, "ryotunes-update.apk")

        onProgress(1)
        var verified = false
        try {
            val conn = openFollowingRedirects(apkUrl, 12_000, 30_000)
            try {
                if (conn.responseCode !in 200..299) {
                    throw IllegalStateException("GitHub APK download HTTP ${conn.responseCode}")
                }
                val total = conn.contentLengthLong.coerceAtLeast(1L)
                var downloaded = 0L
                var lastPct = 1
                conn.inputStream.use { input ->
                    FileOutputStream(apkFile).use { fos ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            if (n == 0) continue
                            fos.write(buf, 0, n)
                            downloaded += n
                            val pct = if (conn.contentLengthLong > 0L) {
                                ((downloaded * 96L) / total).toInt().coerceIn(2, 97)
                            } else {
                                minOf(95, 5 + (downloaded / (128 * 1024)).toInt())
                            }
                            if (pct != lastPct) {
                                lastPct = pct
                                onProgress(pct)
                            }
                        }
                        fos.flush()
                    }
                }
            } finally {
                conn.disconnect()
            }

            if (!apkFile.exists() || apkFile.length() <= 1_000_000L) {
                throw IllegalStateException("El APK descargado está incompleto (${apkFile.length()} bytes)")
            }

            onProgress(98)
            verifyDownloadedApkSignature(context, apkFile)
            verified = true
        } finally {
            if (!verified) {
                purgeUpdateApks(updatesDir)
            }
        }

        onProgress(100)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(installIntent)

        return JSObject().apply {
            put("started", true)
            put("needsPermission", false)
        }
    }

    /**
     * Compares SemVer strings including prerelease identifiers:
     * 1.3.0-beta.2 > 1.3.0-beta.1, 1.3.0 > 1.3.0-beta.9, 1.3.1 > 1.3.0.
     */
    fun compareSemVer(aRaw: String, bRaw: String): Int {
        val aClean = aRaw.trim().removePrefix("v").removePrefix("V")
        val bClean = bRaw.trim().removePrefix("v").removePrefix("V")

        val aSplit = aClean.split('-', limit = 2)
        val bSplit = bClean.split('-', limit = 2)

        val aCore = aSplit[0].split('.').map { it.toIntOrNull() ?: 0 }
        val bCore = bSplit[0].split('.').map { it.toIntOrNull() ?: 0 }
        val maxCore = maxOf(aCore.size, bCore.size, 3)
        for (i in 0 until maxCore) {
            val av = aCore.getOrElse(i) { 0 }
            val bv = bCore.getOrElse(i) { 0 }
            if (av != bv) return av.compareTo(bv)
        }

        val aPre = aSplit.getOrNull(1)?.takeIf { it.isNotBlank() }
        val bPre = bSplit.getOrNull(1)?.takeIf { it.isNotBlank() }
        if (aPre == null && bPre == null) return 0
        if (aPre == null) return 1 // Stable > Prerelease
        if (bPre == null) return -1

        val aParts = aPre.split('.')
        val bParts = bPre.split('.')
        val maxPre = maxOf(aParts.size, bParts.size)
        for (i in 0 until maxPre) {
            val ap = aParts.getOrNull(i)
            val bp = bParts.getOrNull(i)
            if (ap == null && bp == null) return 0
            if (ap == null) return -1
            if (bp == null) return 1
            val ai = ap.toIntOrNull()
            val bi = bp.toIntOrNull()
            val cmp = if (ai != null && bi != null) ai.compareTo(bi) else ap.compareTo(bp, ignoreCase = true)
            if (cmp != 0) return cmp
        }
        return 0
    }

    private fun fetchLatestReleaseJson(): JSONObject? {
        val latest = httpGetJsonText(REPO_LATEST_URL, 8000)
        if (!latest.isNullOrBlank()) {
            val obj = runCatching { JSONObject(latest) }.getOrNull()
            if (obj != null && obj.has("tag_name")) return obj
        }
        val listRaw = httpGetJsonText(REPO_LIST_URL, 8000) ?: return null
        val arr = runCatching { JSONArray(listRaw) }.getOrNull() ?: return null
        return if (arr.length() > 0) arr.optJSONObject(0) else null
    }

    private fun httpGetJsonText(urlStr: String, timeoutMs: Int): String? {
        return runCatching {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                setRequestProperty("User-Agent", GITHUB_UA)
                setRequestProperty("Accept", "application/vnd.github+json")
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

    private fun openFollowingRedirects(urlStr: String, connectMs: Int, readMs: Int): HttpURLConnection {
        var currentUrl = urlStr
        for (hop in 0..5) {
            assertAllowedApkUrl(currentUrl)
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = connectMs
                readTimeout = readMs
                setRequestProperty("User-Agent", GITHUB_UA)
                instanceFollowRedirects = false
            }
            val code = conn.responseCode
            if (code in 300..399) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (loc.isNullOrBlank()) throw IllegalStateException("Redirect missing Location header")
                val resolved = URL(URL(currentUrl), loc).toString()
                assertAllowedApkUrl(resolved)
                currentUrl = resolved
                continue
            }
            return conn
        }
        throw IllegalStateException("Too many redirects downloading update")
    }
}
