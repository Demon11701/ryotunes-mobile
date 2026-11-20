package dev.ryoku.ryotunes

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Authenticated multi-provider playlist & favorites synchronizer + public playlist URL importer.
 * Supports YouTube Music (SAPISIDHASH + InnerTube WEB_REMIX), Spotify (sp_dc web token + embed fallback),
 * SoundCloud (oauth_token + api-v2 resolve), and TIDAL (session/JWT + public metadata).
 */
object RyotunesAccountSync {

    private const val WEB_UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
    private const val SYNC_CACHE_PREFS = "ryotunes_synced_playlists_cache"

    fun syncAccountPlaylists(context: Context, rawProvider: String): JSObject {
        val provider = RyotunesAccountVault.normalizeProvider(rawProvider)
        val session = RyotunesAccountVault.getSession(context, provider)
            ?: throw IllegalStateException("Cuenta de $provider no conectada")

        val result = when (provider) {
            "ytmusic" -> syncYouTubeMusic(context, session)
            "spotify" -> syncSpotify(context, session)
            "soundcloud" -> syncSoundCloud(context, session)
            "tidal" -> syncTidal(context, session)
            else -> throw IllegalArgumentException("Proveedor no soportado: $provider")
        }

        runCatching {
            context.getSharedPreferences(SYNC_CACHE_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString("cache_$provider", result.toString())
                .apply()
        }
        return result
    }

    fun importPlaylistByUrl(context: Context, rawUrl: String): JSObject {
        val url = rawUrl.trim()
        if (url.isBlank()) throw IllegalArgumentException("Pega un enlace de playlist válido")
        val normalized = if (url.startsWith("http://") || url.startsWith("https://")) url else "https://$url"
        val uri = Uri.parse(normalized)
        val host = (uri.host ?: "").lowercase()

        return when {
            host.contains("youtube.com") || host == "youtu.be" -> importYouTubePlaylistUrl(context, uri)
            host.contains("spotify.com") -> importSpotifyPlaylistUrl(context, uri)
            host.contains("soundcloud.com") || host.contains("snd.sc") -> importSoundCloudPlaylistUrl(normalized)
            host.contains("tidal.com") -> importTidalPlaylistUrl(context, uri)
            else -> throw IllegalArgumentException("Solo se admiten enlaces de YouTube Music, Spotify, SoundCloud o TIDAL")
        }
    }

    /**
     * Lazy-loads tracks for a synced remote playlist (e.g. PL:spotify:<id>, PL:ytmusic:<id>)
     * whenever the user taps into a playlist whose tracks haven't been hydrated yet.
     */
    fun fetchRemotePlaylistTracks(context: Context, playlistId: String, rawProvider: String = ""): JSObject {
        val cleanId = playlistId.trim()
        val inferred = when {
            cleanId.startsWith("PL:spotify:") -> "spotify"
            cleanId.startsWith("PL:ytmusic:") -> "ytmusic"
            cleanId.startsWith("PL:soundcloud:") -> "soundcloud"
            cleanId.startsWith("PL:tidal:") -> "tidal"
            else -> RyotunesAccountVault.normalizeProvider(rawProvider)
        }
        val remotePart = cleanId.substringAfterLast(':')
        val tracks = mutableListOf<JSObject>()

        when (inferred) {
            "spotify" -> {
                val session = RyotunesAccountVault.getSession(context, "spotify")
                if (remotePart == "liked") {
                    if (session == null) throw IllegalStateException("Conecta tu cuenta de Spotify primero")
                    val (code, raw) = spotifyApiGet(context, "https://api.spotify.com/v1/me/tracks?limit=50")
                    if (code !in 200..299 || raw.isNullOrBlank()) {
                        throw IllegalStateException("No se pudieron cargar Tus Me Gusta de Spotify (HTTP $code)")
                    }
                    val items = JSONObject(raw).optJSONArray("items") ?: JSONArray()
                    for (i in 0 until items.length()) {
                        val trackObj = items.optJSONObject(i)?.optJSONObject("track") ?: continue
                        mapSpotifyTrack(trackObj)?.let { tracks.add(it) }
                    }
                } else {
                    if (session != null) {
                        val (code, raw) = spotifyApiGet(
                            context,
                            "https://api.spotify.com/v1/playlists/$remotePart/tracks?limit=100"
                        )
                        if (code in 200..299 && !raw.isNullOrBlank()) {
                            val items = JSONObject(raw).optJSONArray("items") ?: JSONArray()
                            for (i in 0 until items.length()) {
                                val trackObj = items.optJSONObject(i)?.optJSONObject("track") ?: continue
                                mapSpotifyTrack(trackObj)?.let { tracks.add(it) }
                            }
                        }
                    }
                    if (tracks.isEmpty()) {
                        // Public embed fallback
                        val imported = runCatching {
                            importSpotifyPlaylistUrl(context, Uri.parse("https://open.spotify.com/playlist/$remotePart"))
                        }.getOrNull()
                        val arr = imported?.optJSONArray("tracks")
                        if (arr != null) {
                            for (i in 0 until arr.length()) {
                                arr.optJSONObject(i)?.let { tracks.add(JSObject.fromJSONObject(it)) }
                            }
                        }
                    }
                }
            }
            "ytmusic" -> {
                val session = RyotunesAccountVault.getSession(context, "ytmusic")
                val headers = if (session != null) buildYtmHeaders(session) else emptyMap()
                val browseId = if (remotePart == "liked") {
                    "FEmusic_liked_videos"
                } else if (remotePart.startsWith("VL")) {
                    remotePart
                } else {
                    "VL$remotePart"
                }
                val detail = ytmBrowse(browseId, headers)
                tracks.addAll(extractYtmTracksRecursive(detail))
            }
            "soundcloud" -> {
                val cid = RyotunesOnlineResolver.getSoundCloudClientId()
                val session = RyotunesAccountVault.getSession(context, "soundcloud")
                val headers = buildMap {
                    put("User-Agent", WEB_UA)
                    if (session != null) put("Authorization", "OAuth ${session.primaryToken}")
                }
                val cidQ = if (cid.isNotBlank()) "client_id=$cid&" else ""
                if (remotePart == "liked" && session != null) {
                    val raw = httpGetText("https://api-v2.soundcloud.com/me/track_likes?${cidQ}limit=50", headers, 8000)
                    if (!raw.isNullOrBlank()) {
                        val coll = JSONObject(raw).optJSONArray("collection") ?: JSONArray()
                        for (i in 0 until coll.length()) {
                            val tr = coll.optJSONObject(i)?.optJSONObject("track") ?: continue
                            mapSoundCloudTrack(tr)?.let { tracks.add(it) }
                        }
                    }
                } else {
                    val raw = httpGetText("https://api-v2.soundcloud.com/playlists/$remotePart?${cidQ}", headers, 8000)
                    if (!raw.isNullOrBlank()) {
                        val pl = JSONObject(raw)
                        tracks.addAll(hydrateSoundCloudTracks(pl.optJSONArray("tracks") ?: JSONArray(), cid, headers))
                    }
                }
            }
            "tidal" -> {
                val imported = importTidalPlaylistUrl(context, Uri.parse("https://tidal.com/browse/playlist/$remotePart"))
                val arr = imported.optJSONArray("tracks")
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        arr.optJSONObject(i)?.let { tracks.add(JSObject.fromJSONObject(it)) }
                    }
                }
            }
        }

        val tracksArr = JSArray()
        val idsArr = JSArray()
        tracks.forEach { t ->
            val tid = t.optString("id", "")
            if (tid.isNotBlank()) {
                idsArr.put(tid)
                tracksArr.put(t)
            }
        }
        return JSObject().apply {
            put("playlistId", cleanId)
            put("tracks", tracksArr)
            put("trackIds", idsArr)
        }
    }

    // ── YouTube Music (SAPISIDHASH + InnerTube WEB_REMIX) ────────────────────

    private fun sha1Hex(input: String): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun buildYtmHeaders(session: RyotunesAccountVault.AccountSession): Map<String, String> {
        val ts = System.currentTimeMillis() / 1000L
        val origin = "https://music.youtube.com"
        val cookieMap = RyotunesAccountVault.parseCookieMap(session.cookieHeader)
        val sapisid = cookieMap["SAPISID"] ?: cookieMap["__Secure-3PAPISID"] ?: session.primaryToken
        val sapisid3p = cookieMap["__Secure-3PAPISID"].orEmpty()
        val sapisid1p = cookieMap["__Secure-1PAPISID"].orEmpty()

        val authParts = mutableListOf<String>()
        if (sapisid.isNotBlank()) {
            authParts.add("SAPISIDHASH ${ts}_${sha1Hex("$ts $sapisid $origin")}")
        }
        if (sapisid1p.isNotBlank()) {
            authParts.add("SAPISID1PHASH ${ts}_${sha1Hex("$ts $sapisid1p $origin")}")
        }
        if (sapisid3p.isNotBlank()) {
            authParts.add("SAPISID3PHASH ${ts}_${sha1Hex("$ts $sapisid3p $origin")}")
        }

        return mapOf(
            "Authorization" to authParts.joinToString(" "),
            "Cookie" to session.cookieHeader,
            "Origin" to origin,
            "X-Origin" to origin,
            "X-Goog-AuthUser" to "0",
            "Referer" to "$origin/"
        )
    }

    private fun ytmBrowse(browseId: String, headers: Map<String, String> = emptyMap()): JSONObject {
        val payload = JSONObject().apply {
            put("context", JSONObject().apply {
                put("client", JSONObject().apply {
                    put("clientName", "WEB_REMIX")
                    put("clientVersion", "1.20241104.01.00")
                    put("hl", "es")
                    put("gl", "US")
                })
            })
            put("browseId", browseId)
        }
        val raw = httpPostJson(
            "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false",
            payload.toString(),
            WEB_UA,
            headers
        )
        return JSONObject(raw)
    }

    private fun syncYouTubeMusic(
        context: Context,
        session: RyotunesAccountVault.AccountSession
    ): JSObject {
        val headers = buildYtmHeaders(session)
        val playlistsArr = JSArray()
        val allTracksMap = LinkedHashMap<String, JSObject>()
        val likedIds = mutableListOf<String>()

        // 1) Fetch Liked Songs (FEmusic_liked_videos)
        val likedJson = runCatching { ytmBrowse("FEmusic_liked_videos", headers) }.getOrNull()
        if (likedJson != null) {
            val likedTracks = extractYtmTracksRecursive(likedJson)
            if (likedTracks.isNotEmpty()) {
                val trackIdsArr = JSArray()
                likedTracks.forEach { t ->
                    val tid = t.optString("id", "")
                    if (tid.isNotEmpty()) {
                        allTracksMap[tid] = t
                        likedIds.add(tid)
                        trackIdsArr.put(tid)
                    }
                }
                playlistsArr.put(JSObject().apply {
                    put("id", "PL:ytmusic:liked")
                    put("title", "YT Music · Tus Me Gusta")
                    put("subtitle", "${likedTracks.size} pistas · YouTube Music")
                    put("provider", "youtube")
                    put("artwork", likedTracks.firstOrNull()?.optString("artwork", "") ?: "")
                    put("trackIds", trackIdsArr)
                    put("createdAt", System.currentTimeMillis())
                })
            }
        }

        // 2) Fetch User Playlists (FEmusic_liked_playlists)
        val plListJson = runCatching { ytmBrowse("FEmusic_liked_playlists", headers) }.getOrNull()
        if (plListJson != null) {
            val stubs = extractYtmPlaylistStubsRecursive(plListJson).take(25)
            stubs.forEachIndexed { idx, stub ->
                val browseId = stub.first
                val title = stub.second
                val cover = stub.third
                val normalizedBrowse = if (browseId.startsWith("VL")) browseId else "VL$browseId"
                val idsArr = JSArray()
                var resolvedCover = cover
                if (idx < 10) {
                    val detail = runCatching { ytmBrowse(normalizedBrowse, headers) }.getOrNull()
                    if (detail != null) {
                        val items = extractYtmTracksRecursive(detail)
                        items.forEach { t ->
                            val tid = t.optString("id", "")
                            if (tid.isNotEmpty()) {
                                allTracksMap[tid] = t
                                idsArr.put(tid)
                            }
                        }
                        if (resolvedCover.isBlank()) {
                            resolvedCover = items.firstOrNull()?.optString("artwork", "") ?: ""
                        }
                    }
                }
                val subtitle = if (idsArr.length() > 0) {
                    "${idsArr.length()} pistas · YouTube Music"
                } else {
                    "Toca para cargar · YouTube Music"
                }
                playlistsArr.put(JSObject().apply {
                    put("id", "PL:ytmusic:${browseId.removePrefix("VL")}")
                    put("title", title.ifBlank { "YouTube Playlist" })
                    put("subtitle", subtitle)
                    put("provider", "youtube")
                    put("artwork", resolvedCover)
                    put("trackIds", idsArr)
                    put("createdAt", System.currentTimeMillis())
                })
            }
        }

        val tracksArr = JSArray()
        allTracksMap.values.forEach { tracksArr.put(it) }
        val likedArr = JSArray()
        likedIds.forEach { likedArr.put(it) }

        return JSObject().apply {
            put("provider", "ytmusic")
            put("accountName", session.accountName)
            put("playlists", playlistsArr)
            put("tracks", tracksArr)
            put("likedIds", likedArr)
        }
    }

    private fun importYouTubePlaylistUrl(context: Context, uri: Uri): JSObject {
        val listParam = uri.getQueryParameter("list")?.trim().orEmpty()
        val pathSegs = uri.pathSegments ?: emptyList()
        val rawId = when {
            listParam.isNotEmpty() -> listParam.removePrefix("VL")
            pathSegs.size >= 2 && pathSegs[0] == "browse" && pathSegs[1].startsWith("VL") ->
                pathSegs[1].removePrefix("VL")
            else -> throw IllegalArgumentException("El enlace de YouTube no contiene un parámetro list= de playlist")
        }
        val session = RyotunesAccountVault.getSession(context, "ytmusic")
        val headers = if (session != null) buildYtmHeaders(session) else emptyMap()
        val detail = ytmBrowse("VL$rawId", headers)
        val items = extractYtmTracksRecursive(detail)
        if (items.isEmpty()) {
            throw IllegalStateException("No se encontraron pistas públicas en esa playlist de YouTube Music")
        }
        val title = extractYtmHeaderTitle(detail).ifBlank { "YouTube Playlist" }
        val idsArr = JSArray()
        val tracksArr = JSArray()
        items.forEach { t ->
            val tid = t.optString("id", "")
            if (tid.isNotEmpty()) {
                idsArr.put(tid)
                tracksArr.put(t)
            }
        }
        val playlist = JSObject().apply {
            put("id", "PL:ytmusic:$rawId")
            put("title", title)
            put("subtitle", "${items.size} tracks · YouTube Music")
            put("provider", "youtube")
            put("artwork", items.firstOrNull()?.optString("artwork", "") ?: "")
            put("trackIds", idsArr)
            put("createdAt", System.currentTimeMillis())
        }
        return JSObject().apply {
            put("playlist", playlist)
            put("tracks", tracksArr)
        }
    }

    // ── Spotify (DRM-Enabled Desktop WebView + Dual-Path Vía A / Vía B) ──────

    private const val SPOTIFY_TOKEN_MAX_AGE_MS = 45L * 60L * 1000L

    private data class HeadlessSpotifyResult(
        val accessToken: String = "",
        val clientToken: String = "",
        val playlistsJson: String = "",
        val likedTracksJson: String = "",
        val domPlaylistsJson: String = "",
        val drmBlocked: Boolean = false
    )

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun runSpotifyHeadlessSession(
        context: Context,
        extractPlaylists: Boolean
    ): HeadlessSpotifyResult? {
        if (Looper.myLooper() == Looper.getMainLooper()) return null
        val session = RyotunesAccountVault.getSession(context, "spotify") ?: return null
        val latch = CountDownLatch(1)
        val tokenRef = AtomicReference("")
        val clientRef = AtomicReference("")
        val playlistsJsonRef = AtomicReference("")
        val likedJsonRef = AtomicReference("")
        val domPlaylistsRef = AtomicReference("")
        val drmBlockedRef = AtomicReference(false)
        val webViewRef = AtomicReference<WebView?>(null)
        val mainHandler = Handler(Looper.getMainLooper())
        var released = false
        var fetchTriggered = false

        fun finishOnce() {
            if (released) return
            released = true
            latch.countDown()
        }

        mainHandler.post {
            try {
                val cm = CookieManager.getInstance()
                cm.setAcceptCookie(true)
                val existing = cm.getCookie("https://open.spotify.com").orEmpty()
                if (!existing.contains("sp_dc=") && session.primaryToken.isNotBlank()) {
                    cm.setCookie(
                        "https://open.spotify.com",
                        "sp_dc=${session.primaryToken}; Domain=.spotify.com; Path=/; Secure"
                    )
                    cm.flush()
                }

                val wv = WebView(context.applicationContext)
                webViewRef.set(wv)
                cm.setAcceptThirdPartyCookies(wv, true)
                wv.settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    @Suppress("DEPRECATION")
                    databaseEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                    userAgentString = RyotunesAccountAuthActivity.SPOTIFY_DESKTOP_CHROME_UA
                }

                // Grant Widevine DRM so open.spotify.com Web Player initializes cleanly
                wv.webChromeClient = object : WebChromeClient() {
                    override fun onPermissionRequest(request: PermissionRequest) {
                        val allowed = request.resources.filter {
                            it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                        }.toTypedArray()
                        if (allowed.isNotEmpty()) request.grant(allowed) else request.deny()
                    }
                }

                fun triggerInPageExtraction(view: WebView?) {
                    if (!extractPlaylists || fetchTriggered || view == null) return
                    fetchTriggered = true
                    val tokEsc = JSONObject.quote(tokenRef.get())
                    val ctEsc = JSONObject.quote(clientRef.get())
                    val extractJs = """
                        (async function() {
                          try {
                            var bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
                            if (bodyText.indexOf('reproducción deshabilitada') >= 0 || bodyText.indexOf('playback disabled') >= 0) {
                              window.RyotunesTokenBridge.onDrmBlocked();
                              return;
                            }
                            var tok = $tokEsc;
                            var ct = $ctEsc;
                            var hdrs = { 'Accept': 'application/json' };
                            if (tok) hdrs['Authorization'] = 'Bearer ' + tok;
                            if (ct) hdrs['client-token'] = ct;

                            var plJson = '';
                            var likedJson = '';
                            if (tok) {
                              try {
                                var r1 = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', { headers: hdrs });
                                if (r1 && r1.ok) plJson = await r1.text();
                              } catch (e) {}
                              try {
                                var r2 = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', { headers: hdrs });
                                if (r2 && r2.ok) likedJson = await r2.text();
                              } catch (e) {}
                            }

                            var domList = [];
                            try {
                              var seen = {};
                              var anchors = document.querySelectorAll('a[href^="/playlist/"]');
                              for (var i = 0; i < anchors.length; i++) {
                                var a = anchors[i];
                                var href = a.getAttribute('href') || '';
                                var m = href.match(/\/playlist\/([A-Za-z0-9]+)/);
                                if (!m || seen[m[1]]) continue;
                                seen[m[1]] = true;
                                var name = (a.innerText || a.getAttribute('aria-label') || '').split('\n')[0].trim();
                                var imgEl = a.querySelector('img');
                                var img = imgEl ? (imgEl.getAttribute('src') || '') : '';
                                if (name) domList.push({ id: m[1], name: name, image: img });
                              }
                            } catch (e) {}

                            window.RyotunesTokenBridge.onExtracted(plJson, likedJson, JSON.stringify(domList));
                          } catch (e) {
                            try { window.RyotunesTokenBridge.onExtracted('', '', '[]'); } catch (e2) {}
                          }
                        })();
                    """.trimIndent()
                    mainHandler.post { runCatching { view.evaluateJavascript(extractJs, null) } }
                }

                var gracePosted = false
                fun onCaptured(tok: String, ct: String) {
                    if (tok.length > 24) tokenRef.set(tok)
                    if (ct.length > 10) clientRef.set(ct)
                    if (!extractPlaylists) {
                        if (tokenRef.get().isNotBlank() && clientRef.get().isNotBlank()) {
                            finishOnce()
                        } else if (tokenRef.get().isNotBlank() && !gracePosted) {
                            gracePosted = true
                            mainHandler.postDelayed({ finishOnce() }, 450L)
                        }
                    } else if (tokenRef.get().isNotBlank() && !fetchTriggered) {
                        if (clientRef.get().isNotBlank()) {
                            triggerInPageExtraction(webViewRef.get())
                        } else if (!gracePosted) {
                            gracePosted = true
                            mainHandler.postDelayed({ triggerInPageExtraction(webViewRef.get()) }, 550L)
                        }
                    }
                }

                wv.addJavascriptInterface(object {
                    @JavascriptInterface
                    fun onToken(accessToken: String?, clientToken: String?) {
                        onCaptured(accessToken?.trim().orEmpty(), clientToken?.trim().orEmpty())
                    }

                    @JavascriptInterface
                    fun onExtracted(plJson: String?, likedJson: String?, domJson: String?) {
                        if (!plJson.isNullOrBlank()) playlistsJsonRef.set(plJson)
                        if (!likedJson.isNullOrBlank()) likedJsonRef.set(likedJson)
                        if (!domJson.isNullOrBlank()) domPlaylistsRef.set(domJson)
                        finishOnce()
                    }

                    @JavascriptInterface
                    fun onDrmBlocked() {
                        drmBlockedRef.set(true)
                        finishOnce()
                    }
                }, "RyotunesTokenBridge")

                wv.webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): WebResourceResponse? {
                        if (request != null) {
                            val host = request.url?.host?.lowercase().orEmpty()
                            val hdrs = request.requestHeaders
                            if (hdrs != null &&
                                (host.contains("api.spotify.com") ||
                                    host.contains("api-partner.spotify.com") ||
                                    host.contains("spclient.wg.spotify.com"))
                            ) {
                                var tok = ""
                                var ct = ""
                                for ((k, v) in hdrs) {
                                    val kl = k.lowercase()
                                    if (kl == "authorization" && v.startsWith("Bearer ", ignoreCase = true)) {
                                        tok = v.substring(7).trim()
                                    } else if (kl == "client-token") {
                                        ct = v.trim()
                                    }
                                }
                                if (tok.isNotBlank() || ct.isNotBlank()) {
                                    onCaptured(tok, ct)
                                }
                            }
                        }
                        return super.shouldInterceptRequest(view, request)
                    }

                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                        super.onPageStarted(view, url, favicon)
                        if (url != null && url.contains("open.spotify.com", ignoreCase = true)) {
                            view?.evaluateJavascript(RyotunesAccountAuthActivity.SPOTIFY_TOKEN_HOOK_JS, null)
                        }
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        if (url != null && url.contains("open.spotify.com", ignoreCase = true)) {
                            view?.evaluateJavascript(RyotunesAccountAuthActivity.SPOTIFY_TOKEN_HOOK_JS, null)
                            if (extractPlaylists) {
                                mainHandler.postDelayed({
                                    if (!released && !fetchTriggered) {
                                        triggerInPageExtraction(webViewRef.get())
                                    }
                                }, 3200L)
                            }
                        }
                    }
                }

                wv.loadUrl("https://open.spotify.com/")
            } catch (_: Throwable) {
                finishOnce()
            }
        }

        val waitMs = if (extractPlaylists) 11_500L else 8_500L
        runCatching { latch.await(waitMs, TimeUnit.MILLISECONDS) }

        mainHandler.post {
            runCatching {
                webViewRef.getAndSet(null)?.let { wv ->
                    wv.stopLoading()
                    wv.loadUrl("about:blank")
                    wv.destroy()
                }
            }
        }

        val freshToken = tokenRef.get()
        val freshClient = clientRef.get()
        if (freshToken.isNotBlank()) {
            RyotunesAccountVault.updateTokens(context, "spotify", freshToken, freshClient)
        }
        return HeadlessSpotifyResult(
            accessToken = freshToken,
            clientToken = freshClient,
            playlistsJson = playlistsJsonRef.get(),
            likedTracksJson = likedJsonRef.get(),
            domPlaylistsJson = domPlaylistsRef.get(),
            drmBlocked = drmBlockedRef.get()
        )
    }

    private fun refreshSpotifyTokensHeadless(context: Context): Pair<String, String>? {
        val res = runSpotifyHeadlessSession(context, extractPlaylists = false) ?: return null
        return if (res.accessToken.isNotBlank()) res.accessToken to res.clientToken else null
    }

    private fun resolveSpotifyAuthHeaders(context: Context, forceRefresh: Boolean = false): Map<String, String> {
        val session = RyotunesAccountVault.getSession(context, "spotify")
            ?: throw IllegalStateException("Cuenta de Spotify no conectada")

        val ageMs = if (session.tokenCapturedAt > 0L) {
            System.currentTimeMillis() - session.tokenCapturedAt
        } else {
            Long.MAX_VALUE
        }
        var accessToken = if (!forceRefresh && session.accessToken.isNotBlank() && ageMs < SPOTIFY_TOKEN_MAX_AGE_MS) {
            session.accessToken
        } else {
            ""
        }
        var clientToken = if (!forceRefresh) session.clientToken else ""

        if (accessToken.isBlank()) {
            val refreshed = refreshSpotifyTokensHeadless(context)
            if (refreshed != null) {
                accessToken = refreshed.first
                if (refreshed.second.isNotBlank()) clientToken = refreshed.second
            }
        }

        if (accessToken.isBlank()) {
            throw IllegalStateException("No se obtuvo un Bearer Token válido de Spotify. Desconecta y vuelve a iniciar sesión.")
        }

        return buildMap {
            put("Authorization", "Bearer $accessToken")
            put("User-Agent", RyotunesAccountAuthActivity.SPOTIFY_DESKTOP_CHROME_UA)
            put("Origin", "https://open.spotify.com")
            put("Referer", "https://open.spotify.com/")
            put("Accept", "application/json")
            put("Accept-Language", "es-ES,es;q=0.9,en;q=0.8")
            if (clientToken.isNotBlank()) {
                put("client-token", clientToken)
            }
        }
    }

    private fun spotifyApiGet(context: Context, url: String, timeoutMs: Int = 9000): Pair<Int, String?> {
        val headers = resolveSpotifyAuthHeaders(context, forceRefresh = false)
        val first = httpGetWithStatus(url, headers, timeoutMs)
        if (first.first == 401 || first.first == 403) {
            val freshHeaders = runCatching { resolveSpotifyAuthHeaders(context, forceRefresh = true) }.getOrNull()
                ?: return first
            return httpGetWithStatus(url, freshHeaders, timeoutMs)
        }
        return first
    }

    private fun parseSpotifyLikedJson(
        savedRaw: String,
        playlistsArr: JSArray,
        allTracksMap: LinkedHashMap<String, JSObject>,
        likedIds: MutableList<String>
    ) {
        val items = runCatching { JSONObject(savedRaw).optJSONArray("items") }.getOrNull() ?: return
        val idsArr = JSArray()
        var firstArt = ""
        for (i in 0 until items.length()) {
            val trackObj = items.optJSONObject(i)?.optJSONObject("track") ?: continue
            val mapped = mapSpotifyTrack(trackObj) ?: continue
            val tid = mapped.optString("id", "")
            if (tid.isNotEmpty()) {
                allTracksMap[tid] = mapped
                likedIds.add(tid)
                idsArr.put(tid)
                if (firstArt.isEmpty()) firstArt = mapped.optString("artwork", "")
            }
        }
        if (idsArr.length() > 0) {
            playlistsArr.put(JSObject().apply {
                put("id", "PL:spotify:liked")
                put("title", "Spotify · Tus Me Gusta")
                put("subtitle", "${idsArr.length()} pistas · Spotify")
                put("provider", "spotify")
                put("artwork", firstArt)
                put("trackIds", idsArr)
                put("createdAt", System.currentTimeMillis())
            })
        }
    }

    private fun parseSpotifyPlaylistsJson(
        context: Context,
        plRaw: String,
        playlistsArr: JSArray,
        allTracksMap: LinkedHashMap<String, JSObject>,
        seenPlaylistIds: HashSet<String>,
        hydrateTracks: Boolean
    ) {
        val plItems = runCatching { JSONObject(plRaw).optJSONArray("items") }.getOrNull() ?: return
        for (i in 0 until plItems.length()) {
            val pl = plItems.optJSONObject(i) ?: continue
            val plId = pl.optString("id", "")
            val plTitle = pl.optString("name", "Spotify Playlist")
            if (plId.isBlank() || !seenPlaylistIds.add(plId)) continue
            val plArt = pl.optJSONArray("images")?.optJSONObject(0)?.optString("url", "") ?: ""
            val tracksMeta = pl.optJSONObject("tracks")
            val reportedTotal = tracksMeta?.optInt("total", 0) ?: 0
            val tracksHref = tracksMeta?.optString("href", "").orEmpty()

            val idsArr = JSArray()
            if (hydrateTracks && i < 15) {
                val trUrl = if (tracksHref.startsWith("https://api.spotify.com/")) {
                    val sep = if (tracksHref.contains("?")) "&" else "?"
                    "${tracksHref}${sep}limit=100"
                } else {
                    "https://api.spotify.com/v1/playlists/$plId/tracks?limit=100"
                }
                val (trCode, trRaw) = runCatching { spotifyApiGet(context, trUrl, 8500) }
                    .getOrElse { 0 to null }
                if (trCode in 200..299 && !trRaw.isNullOrBlank()) {
                    val trItems = runCatching { JSONObject(trRaw).optJSONArray("items") }.getOrNull() ?: JSONArray()
                    for (j in 0 until trItems.length()) {
                        val trackObj = trItems.optJSONObject(j)?.optJSONObject("track") ?: continue
                        val mapped = mapSpotifyTrack(trackObj) ?: continue
                        val tid = mapped.optString("id", "")
                        if (tid.isNotEmpty()) {
                            allTracksMap[tid] = mapped
                            idsArr.put(tid)
                        }
                    }
                }
            }

            val countLabel = if (idsArr.length() > 0) idsArr.length() else reportedTotal
            val subtitle = if (countLabel > 0) "$countLabel pistas · Spotify" else "Playlist · Spotify"
            playlistsArr.put(JSObject().apply {
                put("id", "PL:spotify:$plId")
                put("title", plTitle)
                put("subtitle", subtitle)
                put("provider", "spotify")
                put("artwork", plArt)
                put("trackIds", idsArr)
                put("createdAt", System.currentTimeMillis() - i)
            })
        }
    }

    private fun syncSpotify(
        context: Context,
        session: RyotunesAccountVault.AccountSession
    ): JSObject {
        var displayName = session.accountName
        val playlistsArr = JSArray()
        val allTracksMap = LinkedHashMap<String, JSObject>()
        val likedIds = mutableListOf<String>()
        val seenPlaylistIds = HashSet<String>()
        var meCode = 0
        var tracksCode = 0
        var plCode = 0
        var viaAError: String? = null

        // ── VÍA A: Authenticated REST API ─────────────────────────────────────
        runCatching {
            val (codeMe, meRaw) = spotifyApiGet(context, "https://api.spotify.com/v1/me", 7500)
            meCode = codeMe
            if (codeMe in 200..299 && !meRaw.isNullOrBlank()) {
                val me = JSONObject(meRaw)
                val name = me.optString("display_name", "").ifBlank { me.optString("id", "") }
                if (name.isNotBlank()) {
                    displayName = name
                    RyotunesAccountVault.updateAccountName(context, "spotify", name)
                }
            }

            val (codeSaved, savedRaw) = spotifyApiGet(context, "https://api.spotify.com/v1/me/tracks?limit=50", 9000)
            tracksCode = codeSaved
            if (codeSaved in 200..299 && !savedRaw.isNullOrBlank()) {
                parseSpotifyLikedJson(savedRaw, playlistsArr, allTracksMap, likedIds)
            }

            val (codePl, plRaw) = spotifyApiGet(context, "https://api.spotify.com/v1/me/playlists?limit=50", 9500)
            plCode = codePl
            if (codePl in 200..299 && !plRaw.isNullOrBlank()) {
                parseSpotifyPlaylistsJson(context, plRaw, playlistsArr, allTracksMap, seenPlaylistIds, hydrateTracks = true)
            }
        }.onFailure { err ->
            viaAError = err.localizedMessage
        }

        // ── VÍA B: Automatic DRM-Enabled WebView Fallback ─────────────────────
        var drmBlocked = false
        if (playlistsArr.length() == 0 && session.primaryToken.isNotBlank()) {
            val headless = runSpotifyHeadlessSession(context, extractPlaylists = true)
            if (headless != null) {
                drmBlocked = headless.drmBlocked
                if (headless.likedTracksJson.isNotBlank()) {
                    parseSpotifyLikedJson(headless.likedTracksJson, playlistsArr, allTracksMap, likedIds)
                }
                if (headless.playlistsJson.isNotBlank()) {
                    parseSpotifyPlaylistsJson(
                        context,
                        headless.playlistsJson,
                        playlistsArr,
                        allTracksMap,
                        seenPlaylistIds,
                        hydrateTracks = headless.accessToken.isNotBlank()
                    )
                }
                if (playlistsArr.length() == 0 && headless.domPlaylistsJson.isNotBlank()) {
                    val domArr = runCatching { JSONArray(headless.domPlaylistsJson) }.getOrNull() ?: JSONArray()
                    for (i in 0 until domArr.length()) {
                        val item = domArr.optJSONObject(i) ?: continue
                        val pid = item.optString("id", "")
                        val pname = item.optString("name", "")
                        val pimg = item.optString("image", "")
                        if (pid.isBlank() || pname.isBlank() || !seenPlaylistIds.add(pid)) continue
                        playlistsArr.put(JSObject().apply {
                            put("id", "PL:spotify:$pid")
                            put("title", pname)
                            put("subtitle", "Toca para cargar · Spotify")
                            put("provider", "spotify")
                            put("artwork", pimg)
                            put("trackIds", JSArray())
                            put("createdAt", System.currentTimeMillis() - i)
                        })
                    }
                }
            }
        }

        // ── Real Diagnostics (never mask 401/403/DRM errors) ──────────────────
        if (playlistsArr.length() == 0) {
            if (drmBlocked) {
                throw IllegalStateException("Spotify bloqueó el reproductor web (DRM). Desconecta y vuelve a iniciar sesión.")
            }
            val failedCode = listOf(plCode, tracksCode, meCode).firstOrNull { it != 0 && it !in 200..299 } ?: 0
            if (failedCode != 0) {
                throw IllegalStateException(
                    "Spotify devolvió HTTP $failedCode al sincronizar playlists. Desconecta y vuelve a conectar tu cuenta."
                )
            }
            if (!viaAError.isNullOrBlank()) {
                throw IllegalStateException("Error al sincronizar Spotify: $viaAError")
            }
        }

        val tracksArr = JSArray()
        allTracksMap.values.forEach { tracksArr.put(it) }
        val likedArr = JSArray()
        likedIds.forEach { likedArr.put(it) }

        return JSObject().apply {
            put("provider", "spotify")
            put("accountName", displayName)
            put("playlists", playlistsArr)
            put("tracks", tracksArr)
            put("likedIds", likedArr)
        }
    }

    private fun importSpotifyPlaylistUrl(context: Context, uri: Uri): JSObject {
        val segs = uri.pathSegments ?: emptyList()
        val plIdx = segs.indexOf("playlist")
        val plId = if (plIdx >= 0 && plIdx + 1 < segs.size) segs[plIdx + 1] else ""
        if (plId.isBlank()) {
            throw IllegalArgumentException("El enlace de Spotify debe apuntar a /playlist/<id>")
        }

        // 1) Try authenticated Spotify Web API if user already signed in
        val session = RyotunesAccountVault.getSession(context, "spotify")
        if (session != null) {
            val apiResult = runCatching {
                val (code, raw) = spotifyApiGet(context, "https://api.spotify.com/v1/playlists/$plId", 8500)
                if (code in 200..299 && !raw.isNullOrBlank()) {
                    val obj = JSONObject(raw)
                    val title = obj.optString("name", "Spotify Playlist")
                    val cover = obj.optJSONArray("images")?.optJSONObject(0)?.optString("url", "") ?: ""
                    val items = obj.optJSONObject("tracks")?.optJSONArray("items") ?: JSONArray()
                    val idsArr = JSArray()
                    val tracksArr = JSArray()
                    for (i in 0 until items.length()) {
                        val tr = items.optJSONObject(i)?.optJSONObject("track") ?: continue
                        val mapped = mapSpotifyTrack(tr) ?: continue
                        idsArr.put(mapped.optString("id"))
                        tracksArr.put(mapped)
                    }
                    if (tracksArr.length() > 0) {
                        val playlist = JSObject().apply {
                            put("id", "PL:spotify:$plId")
                            put("title", title)
                            put("subtitle", "${tracksArr.length()} pistas · Spotify")
                            put("provider", "spotify")
                            put("artwork", cover)
                            put("trackIds", idsArr)
                            put("createdAt", System.currentTimeMillis())
                        }
                        return@runCatching JSObject().apply {
                            put("playlist", playlist)
                            put("tracks", tracksArr)
                        }
                    }
                }
                null
            }.getOrNull()
            if (apiResult != null) return apiResult
        }

        // 2) Public zero-auth Spotify Embed fallback (__NEXT_DATA__)
        val html = httpGetText(
            "https://open.spotify.com/embed/playlist/$plId",
            mapOf("User-Agent" to WEB_UA),
            9000
        ) ?: throw IllegalStateException("No se pudo abrir la playlist pública de Spotify")

        val nextDataMatch = Regex("<script id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>", RegexOption.DOT_MATCHES_ALL)
            .find(html)?.groupValues?.getOrNull(1)
            ?: throw IllegalStateException("No se encontraron pistas públicas en el enlace de Spotify")
        val root = JSONObject(nextDataMatch)
        val entity = root.optJSONObject("props")
            ?.optJSONObject("pageProps")
            ?.optJSONObject("state")
            ?.optJSONObject("data")
            ?.optJSONObject("entity")
            ?: throw IllegalStateException("Playlist de Spotify privada o no disponible")

        val title = entity.optString("name", "Spotify Playlist")
        val coverSources = entity.optJSONObject("coverArt")?.optJSONArray("sources")
        val cover = coverSources?.optJSONObject(0)?.optString("url", "") ?: ""
        val trackList = entity.optJSONArray("trackList") ?: JSONArray()

        val idsArr = JSArray()
        val tracksArr = JSArray()
        for (i in 0 until trackList.length()) {
            val item = trackList.optJSONObject(i) ?: continue
            val tTitle = item.optString("title", "")
            val tArtist = item.optString("subtitle", "Spotify")
            val tUri = item.optString("uri", "")
            val rawTid = tUri.substringAfterLast(':').ifBlank { "${plId}_$i" }
            if (tTitle.isBlank()) continue
            val id = "spotify:track:$rawTid"
            idsArr.put(id)
            tracksArr.put(JSObject().apply {
                put("id", id)
                put("provider", "spotify")
                put("remoteId", rawTid)
                put("title", tTitle)
                put("artist", tArtist)
                put("album", title)
                put("duration", item.optLong("duration", 0L) / 1000.0)
                if (cover.isNotBlank()) put("artwork", cover)
                put("format", "SPOTIFY")
            })
        }
        if (tracksArr.length() == 0) {
            throw IllegalStateException("La playlist de Spotify no tiene pistas públicas accesibles")
        }
        val playlist = JSObject().apply {
            put("id", "PL:spotify:$plId")
            put("title", title)
            put("subtitle", "${tracksArr.length()} tracks · Spotify")
            put("provider", "spotify")
            put("artwork", cover)
            put("trackIds", idsArr)
            put("createdAt", System.currentTimeMillis())
        }
        return JSObject().apply {
            put("playlist", playlist)
            put("tracks", tracksArr)
        }
    }

    private fun mapSpotifyTrack(tr: JSONObject): JSObject? {
        val tid = tr.optString("id", "")
        val title = tr.optString("name", "")
        if (tid.isBlank() || title.isBlank()) return null
        val artists = tr.optJSONArray("artists")
        val artistNames = mutableListOf<String>()
        if (artists != null) {
            for (i in 0 until artists.length()) {
                val n = artists.optJSONObject(i)?.optString("name", "") ?: ""
                if (n.isNotBlank()) artistNames.add(n)
            }
        }
        val albumObj = tr.optJSONObject("album")
        val albumName = albumObj?.optString("name", "Spotify") ?: "Spotify"
        val art = albumObj?.optJSONArray("images")?.optJSONObject(0)?.optString("url", "") ?: ""
        return JSObject().apply {
            put("id", "spotify:track:$tid")
            put("provider", "spotify")
            put("remoteId", tid)
            put("title", title)
            put("artist", artistNames.joinToString(", ").ifBlank { "Spotify" })
            put("album", albumName)
            put("duration", tr.optLong("duration_ms", 0L) / 1000.0)
            if (art.isNotBlank()) put("artwork", art)
            put("format", "SPOTIFY")
        }
    }

    // ── SoundCloud (oauth_token + api-v2 resolve) ────────────────────────────

    private fun syncSoundCloud(
        context: Context,
        session: RyotunesAccountVault.AccountSession
    ): JSObject {
        val cid = RyotunesOnlineResolver.getSoundCloudClientId()
        val headers = mapOf(
            "Authorization" to "OAuth ${session.primaryToken}",
            "User-Agent" to WEB_UA
        )
        val cidQ = if (cid.isNotBlank()) "client_id=$cid&" else ""

        var displayName = session.accountName
        runCatching {
            val meRaw = httpGetText("https://api-v2.soundcloud.com/me?${cidQ}", headers, 7000)
            if (!meRaw.isNullOrBlank()) {
                val u = JSONObject(meRaw).optString("username", "")
                if (u.isNotBlank()) {
                    displayName = u
                    RyotunesAccountVault.updateAccountName(context, "soundcloud", u)
                }
            }
        }

        val playlistsArr = JSArray()
        val allTracksMap = LinkedHashMap<String, JSObject>()
        val likedIds = mutableListOf<String>()

        // 1) Likes (/me/track_likes)
        runCatching {
            val raw = httpGetText("https://api-v2.soundcloud.com/me/track_likes?${cidQ}limit=50", headers, 8000)
            if (!raw.isNullOrBlank()) {
                val coll = JSONObject(raw).optJSONArray("collection") ?: JSONArray()
                val idsArr = JSArray()
                var firstArt = ""
                for (i in 0 until coll.length()) {
                    val tr = coll.optJSONObject(i)?.optJSONObject("track") ?: continue
                    val mapped = mapSoundCloudTrack(tr) ?: continue
                    val tid = mapped.optString("id")
                    allTracksMap[tid] = mapped
                    likedIds.add(tid)
                    idsArr.put(tid)
                    if (firstArt.isEmpty()) firstArt = mapped.optString("artwork", "")
                }
                if (idsArr.length() > 0) {
                    playlistsArr.put(JSObject().apply {
                        put("id", "PL:soundcloud:liked")
                        put("title", "SoundCloud · Likes")
                        put("subtitle", "${idsArr.length()} tracks · Synced")
                        put("provider", "soundcloud")
                        put("artwork", firstArt)
                        put("trackIds", idsArr)
                        put("createdAt", System.currentTimeMillis())
                    })
                }
            }
        }

        // 2) Playlists (/me/playlists)
        runCatching {
            val raw = httpGetText("https://api-v2.soundcloud.com/me/playlists?${cidQ}limit=20", headers, 8000)
            if (!raw.isNullOrBlank()) {
                val coll = JSONObject(raw).optJSONArray("collection") ?: JSONArray()
                for (i in 0 until minOf(coll.length(), 10)) {
                    val pl = coll.optJSONObject(i) ?: continue
                    val plId = pl.optLong("id", 0L)
                    if (plId <= 0L) continue
                    val tracks = hydrateSoundCloudTracks(pl.optJSONArray("tracks") ?: JSONArray(), cid, headers)
                    if (tracks.isEmpty()) continue
                    val idsArr = JSArray()
                    tracks.forEach { t ->
                        val tid = t.optString("id")
                        allTracksMap[tid] = t
                        idsArr.put(tid)
                    }
                    val art = pl.optString("artwork_url", "")
                        .ifBlank { tracks.firstOrNull()?.optString("artwork", "") ?: "" }
                        .replace("-large.", "-t500x500.")
                    playlistsArr.put(JSObject().apply {
                        put("id", "PL:soundcloud:$plId")
                        put("title", pl.optString("title", "SoundCloud Set"))
                        put("subtitle", "${idsArr.length()} tracks · SoundCloud")
                        put("provider", "soundcloud")
                        put("artwork", art)
                        put("trackIds", idsArr)
                        put("createdAt", System.currentTimeMillis())
                    })
                }
            }
        }

        val tracksArr = JSArray()
        allTracksMap.values.forEach { tracksArr.put(it) }
        val likedArr = JSArray()
        likedIds.forEach { likedArr.put(it) }

        return JSObject().apply {
            put("provider", "soundcloud")
            put("accountName", displayName)
            put("playlists", playlistsArr)
            put("tracks", tracksArr)
            put("likedIds", likedArr)
        }
    }

    private fun importSoundCloudPlaylistUrl(url: String): JSObject {
        val cid = RyotunesOnlineResolver.getSoundCloudClientId()
        if (cid.isBlank()) throw IllegalStateException("SoundCloud client_id no disponible")
        val enc = URLEncoder.encode(url, "UTF-8")
        val raw = httpGetText("https://api-v2.soundcloud.com/resolve?url=$enc&client_id=$cid", mapOf("User-Agent" to WEB_UA), 8000)
            ?: throw IllegalStateException("No se pudo resolver la playlist de SoundCloud")
        val pl = JSONObject(raw)
        val tracks = hydrateSoundCloudTracks(pl.optJSONArray("tracks") ?: JSONArray(), cid, mapOf("User-Agent" to WEB_UA))
        if (tracks.isEmpty()) throw IllegalStateException("No se encontraron pistas en ese enlace de SoundCloud")
        val idsArr = JSArray()
        val tracksArr = JSArray()
        tracks.forEach { t ->
            idsArr.put(t.optString("id"))
            tracksArr.put(t)
        }
        val plId = pl.optLong("id", System.currentTimeMillis())
        val art = pl.optString("artwork_url", "")
            .ifBlank { tracks.firstOrNull()?.optString("artwork", "") ?: "" }
            .replace("-large.", "-t500x500.")
        val playlist = JSObject().apply {
            put("id", "PL:soundcloud:$plId")
            put("title", pl.optString("title", "SoundCloud Playlist"))
            put("subtitle", "${tracks.size} tracks · SoundCloud")
            put("provider", "soundcloud")
            put("artwork", art)
            put("trackIds", idsArr)
            put("createdAt", System.currentTimeMillis())
        }
        return JSObject().apply {
            put("playlist", playlist)
            put("tracks", tracksArr)
        }
    }

    private fun hydrateSoundCloudTracks(
        rawArr: JSONArray,
        cid: String,
        headers: Map<String, String>
    ): List<JSObject> {
        val out = mutableListOf<JSObject>()
        val missingIds = mutableListOf<Long>()
        for (i in 0 until minOf(rawArr.length(), 60)) {
            val item = rawArr.optJSONObject(i) ?: continue
            val mapped = mapSoundCloudTrack(item)
            if (mapped != null) {
                out.add(mapped)
            } else {
                val id = item.optLong("id", 0L)
                if (id > 0L) missingIds.add(id)
            }
        }
        if (missingIds.isNotEmpty() && cid.isNotBlank()) {
            missingIds.chunked(25).forEach { batch ->
                val idsParam = batch.joinToString(",")
                val raw = httpGetText("https://api-v2.soundcloud.com/tracks?ids=$idsParam&client_id=$cid", headers, 7000)
                if (!raw.isNullOrBlank()) {
                    val arr = runCatching { JSONArray(raw) }.getOrNull() ?: JSONArray()
                    for (j in 0 until arr.length()) {
                        mapSoundCloudTrack(arr.optJSONObject(j) ?: continue)?.let { out.add(it) }
                    }
                }
            }
        }
        return out
    }

    private fun mapSoundCloudTrack(t: JSONObject): JSObject? {
        val scId = t.optLong("id", 0L)
        val title = t.optString("title", "")
        if (scId <= 0L || title.isBlank()) return null
        val user = t.optJSONObject("user")
        val art = t.optString("artwork_url", "")
            .ifBlank { user?.optString("avatar_url", "") ?: "" }
            .replace("-large.", "-t500x500.")
        return JSObject().apply {
            put("id", "sc:$scId")
            put("provider", "soundcloud")
            put("remoteId", scId.toString())
            put("title", title)
            put("artist", user?.optString("username", "SoundCloud") ?: "SoundCloud")
            put("album", t.optString("genre", "SoundCloud").ifBlank { "SoundCloud" })
            put("duration", t.optLong("duration", 0L) / 1000.0)
            if (art.isNotBlank()) put("artwork", art)
            put("format", "SOUNDCLOUD")
        }
    }

    // ── TIDAL (Session / JWT + Public Playlist URL) ──────────────────────────

    private fun syncTidal(
        context: Context,
        session: RyotunesAccountVault.AccountSession
    ): JSObject {
        val headers = mutableMapOf("User-Agent" to WEB_UA)
        if (session.primaryToken.contains(".")) {
            headers["Authorization"] = "Bearer ${session.primaryToken}"
        } else if (session.primaryToken.isNotBlank() && session.primaryToken != "web_session") {
            headers["X-Tidal-SessionId"] = session.primaryToken
        }
        if (session.cookieHeader.isNotBlank()) {
            headers["Cookie"] = session.cookieHeader
        }

        val playlistsArr = JSArray()
        val allTracksMap = LinkedHashMap<String, JSObject>()
        val likedIds = mutableListOf<String>()
        var displayName = session.accountName

        val sessRaw = httpGetText("https://api.tidal.com/v1/sessions", headers, 7000)
        if (!sessRaw.isNullOrBlank()) {
            val sessObj = runCatching { JSONObject(sessRaw) }.getOrNull()
            val userId = sessObj?.optLong("userId", 0L) ?: 0L
            val cc = sessObj?.optString("countryCode", "US")?.ifBlank { "US" } ?: "US"
            if (userId > 0L) {
                runCatching {
                    val userRaw = httpGetText("https://api.tidal.com/v1/users/$userId?countryCode=$cc", headers, 6000)
                    val uname = userRaw?.let { JSONObject(it).optString("username", "") } ?: ""
                    if (uname.isNotBlank()) {
                        displayName = uname
                        RyotunesAccountVault.updateAccountName(context, "tidal", uname)
                    }
                }
                // Favorites
                runCatching {
                    val favRaw = httpGetText("https://api.tidal.com/v1/users/$userId/favorites/tracks?countryCode=$cc&limit=50", headers, 8000)
                    val items = favRaw?.let { JSONObject(it).optJSONArray("items") } ?: JSONArray()
                    val idsArr = JSArray()
                    var firstArt = ""
                    for (i in 0 until items.length()) {
                        val tr = items.optJSONObject(i)?.optJSONObject("item") ?: items.optJSONObject(i) ?: continue
                        val mapped = mapTidalTrack(tr) ?: continue
                        val tid = mapped.optString("id")
                        allTracksMap[tid] = mapped
                        likedIds.add(tid)
                        idsArr.put(tid)
                        if (firstArt.isEmpty()) firstArt = mapped.optString("artwork", "")
                    }
                    if (idsArr.length() > 0) {
                        playlistsArr.put(JSObject().apply {
                            put("id", "PL:tidal:liked")
                            put("title", "TIDAL · Favorites")
                            put("subtitle", "${idsArr.length()} tracks · Synced")
                            put("provider", "tidal")
                            put("artwork", firstArt)
                            put("trackIds", idsArr)
                            put("createdAt", System.currentTimeMillis())
                        })
                    }
                }
                // User playlists
                runCatching {
                    val plRaw = httpGetText("https://api.tidal.com/v1/users/$userId/playlists?countryCode=$cc&limit=15", headers, 8000)
                    val plItems = plRaw?.let { JSONObject(it).optJSONArray("items") } ?: JSONArray()
                    for (i in 0 until minOf(plItems.length(), 8)) {
                        val pl = plItems.optJSONObject(i) ?: continue
                        val uuid = pl.optString("uuid", "")
                        if (uuid.isBlank()) continue
                        val itemsRaw = httpGetText("https://api.tidal.com/v1/playlists/$uuid/items?countryCode=$cc&limit=50", headers, 8000)
                            ?: continue
                        val items = JSONObject(itemsRaw).optJSONArray("items") ?: JSONArray()
                        val idsArr = JSArray()
                        for (j in 0 until items.length()) {
                            val tr = items.optJSONObject(j)?.optJSONObject("item") ?: continue
                            val mapped = mapTidalTrack(tr) ?: continue
                            val tid = mapped.optString("id")
                            allTracksMap[tid] = mapped
                            idsArr.put(tid)
                        }
                        if (idsArr.length() > 0) {
                            val imgUuid = pl.optString("squareImage", "").ifBlank { pl.optString("image", "") }
                            val art = if (imgUuid.isNotBlank()) tidalImageUrl(imgUuid) else ""
                            playlistsArr.put(JSObject().apply {
                                put("id", "PL:tidal:$uuid")
                                put("title", pl.optString("title", "TIDAL Playlist"))
                                put("subtitle", "${idsArr.length()} tracks · TIDAL")
                                put("provider", "tidal")
                                put("artwork", art)
                                put("trackIds", idsArr)
                                put("createdAt", System.currentTimeMillis())
                            })
                        }
                    }
                }
            }
        }

        val tracksArr = JSArray()
        allTracksMap.values.forEach { tracksArr.put(it) }
        val likedArr = JSArray()
        likedIds.forEach { likedArr.put(it) }

        return JSObject().apply {
            put("provider", "tidal")
            put("accountName", displayName)
            put("playlists", playlistsArr)
            put("tracks", tracksArr)
            put("likedIds", likedArr)
        }
    }

    private fun importTidalPlaylistUrl(context: Context, uri: Uri): JSObject {
        val segs = uri.pathSegments ?: emptyList()
        val plIdx = segs.indexOf("playlist")
        val uuid = if (plIdx >= 0 && plIdx + 1 < segs.size) segs[plIdx + 1] else ""
        if (uuid.isBlank()) throw IllegalArgumentException("El enlace de TIDAL debe apuntar a /playlist/<uuid>")

        val session = RyotunesAccountVault.getSession(context, "tidal")
        val headers = mutableMapOf("User-Agent" to WEB_UA)
        if (session != null && session.primaryToken.contains(".")) {
            headers["Authorization"] = "Bearer ${session.primaryToken}"
        }

        // Try TIDAL API if signed in
        if (headers.containsKey("Authorization")) {
            val metaRaw = httpGetText("https://api.tidal.com/v1/playlists/$uuid?countryCode=US", headers, 8000)
            val itemsRaw = httpGetText("https://api.tidal.com/v1/playlists/$uuid/items?countryCode=US&limit=50", headers, 8000)
            if (!itemsRaw.isNullOrBlank()) {
                val meta = metaRaw?.let { runCatching { JSONObject(it) }.getOrNull() }
                val items = JSONObject(itemsRaw).optJSONArray("items") ?: JSONArray()
                val idsArr = JSArray()
                val tracksArr = JSArray()
                for (i in 0 until items.length()) {
                    val tr = items.optJSONObject(i)?.optJSONObject("item") ?: continue
                    val mapped = mapTidalTrack(tr) ?: continue
                    idsArr.put(mapped.optString("id"))
                    tracksArr.put(mapped)
                }
                if (tracksArr.length() > 0) {
                    val imgUuid = meta?.optString("squareImage", "").orEmpty()
                    val playlist = JSObject().apply {
                        put("id", "PL:tidal:$uuid")
                        put("title", meta?.optString("title", "TIDAL Playlist") ?: "TIDAL Playlist")
                        put("subtitle", "${tracksArr.length()} tracks · TIDAL")
                        put("provider", "tidal")
                        put("artwork", if (imgUuid.isNotBlank()) tidalImageUrl(imgUuid) else "")
                        put("trackIds", idsArr)
                        put("createdAt", System.currentTimeMillis())
                    }
                    return JSObject().apply {
                        put("playlist", playlist)
                        put("tracks", tracksArr)
                    }
                }
            }
        }

        // Public TIDAL page fallback (JSON-LD / track list parsing)
        val html = httpGetText("https://tidal.com/browse/playlist/$uuid", mapOf("User-Agent" to WEB_UA), 9000)
            ?: throw IllegalStateException("Conecta tu cuenta de TIDAL o verifica que la playlist sea pública")
        val title = Regex("<meta[^>]+property=\"og:title\"[^>]+content=\"([^\"]+)\"").find(html)?.groupValues?.getOrNull(1)
            ?: "TIDAL Playlist"
        val cover = Regex("<meta[^>]+property=\"og:image\"[^>]+content=\"([^\"]+)\"").find(html)?.groupValues?.getOrNull(1)
            ?: ""

        val idsArr = JSArray()
        val tracksArr = JSArray()
        val ldMatches = Regex("<script[^>]+type=\"application/ld\\+json\"[^>]*>(.*?)</script>", RegexOption.DOT_MATCHES_ALL)
            .findAll(html)
        for (m in ldMatches) {
            val obj = runCatching { JSONObject(m.groupValues[1]) }.getOrNull() ?: continue
            val trackArr = obj.optJSONArray("track") ?: continue
            for (i in 0 until trackArr.length()) {
                val tr = trackArr.optJSONObject(i) ?: continue
                val tTitle = tr.optString("name", "")
                if (tTitle.isBlank()) continue
                val artistObj = tr.optJSONObject("byArtist")
                val tArtist = artistObj?.optString("name", "TIDAL") ?: "TIDAL"
                val id = "tidal:track:${uuid}_$i"
                idsArr.put(id)
                tracksArr.put(JSObject().apply {
                    put("id", id)
                    put("provider", "tidal")
                    put("remoteId", "${uuid}_$i")
                    put("title", tTitle)
                    put("artist", tArtist)
                    put("album", title)
                    put("duration", 0.0)
                    if (cover.isNotBlank()) put("artwork", cover)
                    put("format", "TIDAL")
                })
            }
        }
        if (tracksArr.length() == 0) {
            throw IllegalStateException("Inicia sesión en TIDAL para importar esta playlist")
        }
        val playlist = JSObject().apply {
            put("id", "PL:tidal:$uuid")
            put("title", title)
            put("subtitle", "${tracksArr.length()} tracks · TIDAL")
            put("provider", "tidal")
            put("artwork", cover)
            put("trackIds", idsArr)
            put("createdAt", System.currentTimeMillis())
        }
        return JSObject().apply {
            put("playlist", playlist)
            put("tracks", tracksArr)
        }
    }

    private fun mapTidalTrack(tr: JSONObject): JSObject? {
        val tid = tr.optLong("id", 0L)
        val title = tr.optString("title", "")
        if (tid <= 0L || title.isBlank()) return null
        val artist = tr.optJSONObject("artist")?.optString("name", "")
            ?.ifBlank { tr.optJSONArray("artists")?.optJSONObject(0)?.optString("name", "") ?: "" }
            ?.ifBlank { "TIDAL" } ?: "TIDAL"
        val albumObj = tr.optJSONObject("album")
        val albumName = albumObj?.optString("title", "TIDAL") ?: "TIDAL"
        val coverUuid = albumObj?.optString("cover", "") ?: ""
        return JSObject().apply {
            put("id", "tidal:track:$tid")
            put("provider", "tidal")
            put("remoteId", tid.toString())
            put("title", title)
            put("artist", artist)
            put("album", albumName)
            put("duration", tr.optDouble("duration", 0.0))
            if (coverUuid.isNotBlank()) put("artwork", tidalImageUrl(coverUuid))
            put("format", "TIDAL")
        }
    }

    private fun tidalImageUrl(uuid: String): String {
        val path = uuid.replace('-', '/')
        return "https://resources.tidal.com/images/$path/640x640.jpg"
    }

    // ── Home & Explore Live Recommendations Engine ───────────────────────────

    fun fetchHomeRecommendations(context: Context): JSObject {
        val sections = JSArray()

        // 1) Spotify Personalized Feeds (when connected)
        val spotifySession = RyotunesAccountVault.getSession(context, "spotify")
        if (spotifySession != null) {
            // 1a) Recently Played
            runCatching {
                val (code, raw) = spotifyApiGet(
                    context,
                    "https://api.spotify.com/v1/me/player/recently-played?limit=20",
                    8500
                )
                if (code in 200..299 && !raw.isNullOrBlank()) {
                    val items = JSONObject(raw).optJSONArray("items") ?: JSONArray()
                    val seen = HashSet<String>()
                    val arr = JSArray()
                    for (i in 0 until items.length()) {
                        val tr = items.optJSONObject(i)?.optJSONObject("track") ?: continue
                        val mapped = mapSpotifyTrack(tr) ?: continue
                        val id = mapped.optString("id", "")
                        if (id.isNotBlank() && seen.add(id)) arr.put(mapped)
                    }
                    if (arr.length() > 0) {
                        sections.put(JSObject().apply {
                            put("id", "spotify_recent")
                            put("title", "ESCUCHADO RECIENTEMENTE")
                            put("subtitle", "Historial en vivo de tu cuenta Spotify")
                            put("provider", "spotify")
                            put("kind", "tracks")
                            put("items", arr)
                        })
                    }
                }
            }

            // 1b) Top Tracks (Short Term)
            runCatching {
                val (code, raw) = spotifyApiGet(
                    context,
                    "https://api.spotify.com/v1/me/top/tracks?limit=20&time_range=short_term",
                    8500
                )
                if (code in 200..299 && !raw.isNullOrBlank()) {
                    val items = JSONObject(raw).optJSONArray("items") ?: JSONArray()
                    val arr = JSArray()
                    for (i in 0 until items.length()) {
                        val tr = items.optJSONObject(i) ?: continue
                        mapSpotifyTrack(tr)?.let { arr.put(it) }
                    }
                    if (arr.length() > 0) {
                        sections.put(JSObject().apply {
                            put("id", "spotify_top")
                            put("title", "TUS MÁS ESCUCHADAS")
                            put("subtitle", "Top personal reciente en Spotify")
                            put("provider", "spotify")
                            put("kind", "tracks")
                            put("items", arr)
                        })
                    }
                }
            }

            // 1c) User Playlists
            runCatching {
                val (code, raw) = spotifyApiGet(
                    context,
                    "https://api.spotify.com/v1/me/playlists?limit=20",
                    8500
                )
                if (code in 200..299 && !raw.isNullOrBlank()) {
                    val items = JSONObject(raw).optJSONArray("items") ?: JSONArray()
                    val arr = JSArray()
                    for (i in 0 until items.length()) {
                        val pl = items.optJSONObject(i) ?: continue
                        val plId = pl.optString("id", "")
                        val name = pl.optString("name", "")
                        if (plId.isBlank() || name.isBlank()) continue
                        val art = pl.optJSONArray("images")?.optJSONObject(0)?.optString("url", "") ?: ""
                        val total = pl.optJSONObject("tracks")?.optInt("total", 0) ?: 0
                        arr.put(JSObject().apply {
                            put("id", "PL:spotify:$plId")
                            put("title", name)
                            put("subtitle", if (total > 0) "$total pistas · Spotify" else "Playlist · Spotify")
                            put("provider", "spotify")
                            put("artwork", art)
                            put("trackIds", JSArray())
                            put("createdAt", System.currentTimeMillis() - i)
                        })
                    }
                    if (arr.length() > 0) {
                        sections.put(JSObject().apply {
                            put("id", "spotify_playlists")
                            put("title", "TUS PLAYLISTS DE SPOTIFY")
                            put("subtitle", "Toca para abrir o descargar offline")
                            put("provider", "spotify")
                            put("kind", "playlists")
                            put("items", arr)
                        })
                    }
                }
            }
        }

        // 2) YouTube Music Home & Explore (Authenticated if connected, anonymous otherwise)
        val ytmSession = RyotunesAccountVault.getSession(context, "ytmusic")
        val ytmHeaders = if (ytmSession != null) buildYtmHeaders(ytmSession) else emptyMap()

        val quickPickSeen = HashSet<String>()
        runCatching {
            val homeJson = ytmBrowse("FEmusic_home", ytmHeaders)
            val homeTracks = extractYtmTracksRecursive(homeJson, maxItems = 20)
            if (homeTracks.isNotEmpty()) {
                val arr = JSArray()
                homeTracks.forEach { t ->
                    val id = t.optString("id", "")
                    if (id.isNotBlank() && quickPickSeen.add(id)) arr.put(t)
                }
                if (arr.length() > 0) {
                    sections.put(JSObject().apply {
                        put("id", "ytm_quick_picks")
                        put("title", "QUICK PICKS // PARA TI")
                        put(
                            "subtitle",
                            if (ytmSession != null) "Recomendaciones personalizadas de YouTube Music"
                            else "Selección rápida de YouTube Music"
                        )
                        put("provider", "youtube")
                        put("kind", "tracks")
                        put("items", arr)
                    })
                }
            }
        }

        runCatching {
            val exploreTracks = mutableListOf<JSObject>()
            val seenChart = HashSet<String>()
            fun collectFrom(browseId: String) {
                val json = runCatching { ytmBrowse(browseId, ytmHeaders) }.getOrNull() ?: return
                extractYtmTracksRecursive(json, maxItems = 24).forEach { t ->
                    val id = t.optString("id", "")
                    if (id.isNotBlank() && !quickPickSeen.contains(id) && seenChart.add(id)) {
                        exploreTracks.add(t)
                    }
                }
            }
            collectFrom("FEmusic_explore")
            if (exploreTracks.size < 8) collectFrom("FEmusic_charts")
            if (exploreTracks.size < 8) collectFrom("VLPL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i")

            if (exploreTracks.isNotEmpty()) {
                val arr = JSArray()
                exploreTracks.take(18).forEach { arr.put(it) }
                sections.put(JSObject().apply {
                    put("id", "ytm_charts")
                    put("title", "TENDENCIAS // YOUTUBE MUSIC")
                    put("subtitle", "Top Charts y lanzamientos del momento")
                    put("provider", "youtube")
                    put("kind", "tracks")
                    put("items", arr)
                })
            }
        }

        // 3) SoundCloud Top Charts (+ User Likes when connected)
        runCatching {
            val cid = RyotunesOnlineResolver.getSoundCloudClientId()
            if (cid.isNotBlank()) {
                val chartUrl =
                    "https://api-v2.soundcloud.com/charts?kind=top&genre=soundcloud:genres:all-music&limit=15&client_id=$cid"
                val raw = httpGetText(chartUrl, mapOf("User-Agent" to WEB_UA), 8500)
                if (!raw.isNullOrBlank()) {
                    val coll = JSONObject(raw).optJSONArray("collection") ?: JSONArray()
                    val arr = JSArray()
                    for (i in 0 until coll.length()) {
                        val tr = coll.optJSONObject(i)?.optJSONObject("track") ?: continue
                        mapSoundCloudTrack(tr)?.let { arr.put(it) }
                    }
                    if (arr.length() > 0) {
                        sections.put(JSObject().apply {
                            put("id", "sc_charts")
                            put("title", "TENDENCIAS // SOUNDCLOUD")
                            put("subtitle", "Top 15 global en SoundCloud")
                            put("provider", "soundcloud")
                            put("kind", "tracks")
                            put("items", arr)
                        })
                    }
                }

                val scSession = RyotunesAccountVault.getSession(context, "soundcloud")
                if (scSession != null) {
                    val likesRaw = httpGetText(
                        "https://api-v2.soundcloud.com/me/track_likes?client_id=$cid&limit=15",
                        mapOf("Authorization" to "OAuth ${scSession.primaryToken}", "User-Agent" to WEB_UA),
                        8000
                    )
                    if (!likesRaw.isNullOrBlank()) {
                        val coll = JSONObject(likesRaw).optJSONArray("collection") ?: JSONArray()
                        val arr = JSArray()
                        for (i in 0 until coll.length()) {
                            val tr = coll.optJSONObject(i)?.optJSONObject("track") ?: continue
                            mapSoundCloudTrack(tr)?.let { arr.put(it) }
                        }
                        if (arr.length() > 0) {
                            sections.put(JSObject().apply {
                                put("id", "sc_likes")
                                put("title", "TUS LIKES // SOUNDCLOUD")
                                put("subtitle", "Favoritos recientes de tu cuenta")
                                put("provider", "soundcloud")
                                put("kind", "tracks")
                                put("items", arr)
                            })
                        }
                    }
                }
            }
        }

        return JSObject().apply {
            put("fetchedAt", System.currentTimeMillis())
            put("sections", sections)
        }
    }

    // ── Recursive InnerTube WEB_REMIX Parsers ────────────────────────────────

    private fun extractYtmTracksRecursive(node: Any?, maxItems: Int = 80): List<JSObject> {
        val out = mutableListOf<JSObject>()
        val seen = HashSet<String>()
        fun walk(cur: Any?) {
            if (out.size >= maxItems) return
            when (cur) {
                is JSONObject -> {
                    val renderer = cur.optJSONObject("musicResponsiveListItemRenderer")
                    if (renderer != null) {
                        parseYtmTrackRenderer(renderer)?.let { tr ->
                            val id = tr.optString("id")
                            if (id.isNotBlank() && seen.add(id)) out.add(tr)
                        }
                    }
                    val card = cur.optJSONObject("musicTwoRowItemRenderer")
                    if (card != null) {
                        parseYtmTwoRowTrackRenderer(card)?.let { tr ->
                            val id = tr.optString("id")
                            if (id.isNotBlank() && seen.add(id)) out.add(tr)
                        }
                    }
                    val keys = cur.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        if (out.size >= maxItems) return
                        walk(cur.opt(k))
                    }
                }
                is JSONArray -> {
                    for (i in 0 until cur.length()) {
                        if (out.size >= maxItems) return
                        walk(cur.opt(i))
                    }
                }
            }
        }
        walk(node)
        return out
    }

    private fun parseYtmTwoRowTrackRenderer(card: JSONObject): JSObject? {
        val vid = card.optJSONObject("navigationEndpoint")
            ?.optJSONObject("watchEndpoint")
            ?.optString("videoId", "")
            ?.ifBlank {
                card.optJSONObject("thumbnailOverlay")
                    ?.optJSONObject("musicItemThumbnailOverlayRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("musicPlayButtonRenderer")
                    ?.optJSONObject("playNavigationEndpoint")
                    ?.optJSONObject("watchEndpoint")
                    ?.optString("videoId", "") ?: ""
            } ?: ""
        if (vid.isBlank()) return null

        val title = extractRunsDirect(card.optJSONObject("title"))
        if (title.isBlank()) return null

        val subRuns = card.optJSONObject("subtitle")?.optJSONArray("runs")
        val subParts = mutableListOf<String>()
        if (subRuns != null) {
            for (i in 0 until subRuns.length()) {
                val txt = subRuns.optJSONObject(i)?.optString("text", "")?.trim().orEmpty()
                if (txt.isNotEmpty() && txt != "•" && txt != "·" && txt != "," && txt != "&") {
                    subParts.add(txt)
                }
            }
        }
        val artist = subParts.firstOrNull { !it.equals("Song", true) && !it.equals("Canción", true) }
            ?: "YouTube Music"
        val album = subParts.drop(1).firstOrNull { it != artist } ?: "YouTube Music"

        val thumbs = card.optJSONObject("thumbnailRenderer")
            ?.optJSONObject("musicThumbnailRenderer")
            ?.optJSONObject("thumbnail")
            ?.optJSONArray("thumbnails")
        var thumb = if (thumbs != null && thumbs.length() > 0) {
            thumbs.optJSONObject(thumbs.length() - 1)?.optString("url", "") ?: ""
        } else ""
        if (thumb.isBlank()) thumb = "https://i.ytimg.com/vi/$vid/hqdefault.jpg"
        thumb = thumb.replace(Regex("=w\\d+-h\\d+[^&]*"), "=w512-h512-l90-rj")

        return JSObject().apply {
            put("id", "yt:$vid")
            put("provider", "youtube")
            put("remoteId", vid)
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("duration", 0.0)
            put("artwork", thumb)
            put("format", "YTM AAC")
        }
    }

    private fun parseYtmTrackRenderer(renderer: JSONObject): JSObject? {
        val vid = renderer.optJSONObject("playlistItemData")?.optString("videoId", "")
            ?.ifBlank {
                renderer.optJSONObject("overlay")
                    ?.optJSONObject("musicItemThumbnailOverlayRenderer")
                    ?.optJSONObject("content")
                    ?.optJSONObject("musicPlayButtonRenderer")
                    ?.optJSONObject("playNavigationEndpoint")
                    ?.optJSONObject("watchEndpoint")
                    ?.optString("videoId", "") ?: ""
            } ?: ""
        if (vid.isBlank()) return null

        val flexCols = renderer.optJSONArray("flexColumns") ?: return null
        val title = extractRuns(flexCols.optJSONObject(0))
        if (title.isBlank()) return null

        val metaParts = extractRunsList(flexCols.optJSONObject(1))
            .filter { it != "•" && it != "·" && it != "," && it != "&" }
        val artist = metaParts.firstOrNull() ?: "YouTube Music"
        val album = if (metaParts.size >= 2) metaParts[1] else "YouTube Music"

        val fixedCols = renderer.optJSONArray("fixedColumns")
        val durText = if (fixedCols != null && fixedCols.length() > 0) {
            extractRuns(fixedCols.optJSONObject(0))
        } else {
            metaParts.lastOrNull() ?: ""
        }
        val dur = parseDuration(durText)

        val thumbs = renderer.optJSONObject("thumbnail")
            ?.optJSONObject("musicThumbnailRenderer")
            ?.optJSONObject("thumbnail")
            ?.optJSONArray("thumbnails")
        var thumb = if (thumbs != null && thumbs.length() > 0) {
            thumbs.optJSONObject(thumbs.length() - 1)?.optString("url", "") ?: ""
        } else ""
        if (thumb.isBlank()) thumb = "https://i.ytimg.com/vi/$vid/hqdefault.jpg"
        thumb = thumb.replace(Regex("=w\\d+-h\\d+[^&]*"), "=w512-h512-l90-rj")

        return JSObject().apply {
            put("id", "yt:$vid")
            put("provider", "youtube")
            put("remoteId", vid)
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("duration", dur)
            put("artwork", thumb)
            put("format", "YTM AAC")
        }
    }

    private fun extractYtmPlaylistStubsRecursive(node: Any?): List<Triple<String, String, String>> {
        val out = mutableListOf<Triple<String, String, String>>()
        val seen = HashSet<String>()
        fun walk(cur: Any?) {
            when (cur) {
                is JSONObject -> {
                    val card = cur.optJSONObject("musicTwoRowItemRenderer")
                    if (card != null) {
                        val browseId = card.optJSONObject("navigationEndpoint")
                            ?.optJSONObject("browseEndpoint")
                            ?.optString("browseId", "") ?: ""
                        if ((browseId.startsWith("VL") || browseId.startsWith("PL")) &&
                            browseId != "VLLM" && seen.add(browseId)
                        ) {
                            val title = extractRunsDirect(card.optJSONObject("title"))
                            val thumbs = card.optJSONObject("thumbnailRenderer")
                                ?.optJSONObject("musicThumbnailRenderer")
                                ?.optJSONObject("thumbnail")
                                ?.optJSONArray("thumbnails")
                            val cover = if (thumbs != null && thumbs.length() > 0) {
                                thumbs.optJSONObject(thumbs.length() - 1)?.optString("url", "") ?: ""
                            } else ""
                            if (title.isNotBlank()) out.add(Triple(browseId, title, cover))
                        }
                    }
                    val keys = cur.keys()
                    while (keys.hasNext()) {
                        walk(cur.opt(keys.next()))
                    }
                }
                is JSONArray -> {
                    for (i in 0 until cur.length()) walk(cur.opt(i))
                }
            }
        }
        walk(node)
        return out
    }

    private fun extractYtmHeaderTitle(root: JSONObject): String {
        val header = root.optJSONObject("header")
        val h1 = header?.optJSONObject("musicDetailHeaderRenderer")?.optJSONObject("title")
        val t1 = extractRunsDirect(h1)
        if (t1.isNotBlank()) return t1
        val h2 = header?.optJSONObject("musicEditablePlaylistDetailHeaderRenderer")
            ?.optJSONObject("header")
            ?.optJSONObject("musicDetailHeaderRenderer")
            ?.optJSONObject("title")
        val t2 = extractRunsDirect(h2)
        if (t2.isNotBlank()) return t2
        val micro = root.optJSONObject("microformat")
            ?.optJSONObject("microformatDataRenderer")
            ?.optString("title", "") ?: ""
        return micro.removeSuffix(" - YouTube Music").trim()
    }

    private fun extractRuns(flexObj: JSONObject?): String {
        return extractRunsList(flexObj).joinToString("").trim()
    }

    private fun extractRunsList(flexObj: JSONObject?): List<String> {
        val renderer = flexObj?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")
            ?: flexObj?.optJSONObject("musicResponsiveListItemFixedColumnRenderer")
        val runs = renderer?.optJSONObject("text")?.optJSONArray("runs") ?: return emptyList()
        val out = mutableListOf<String>()
        for (i in 0 until runs.length()) {
            val txt = runs.optJSONObject(i)?.optString("text", "")?.trim() ?: ""
            if (txt.isNotEmpty()) out.add(txt)
        }
        return out
    }

    private fun extractRunsDirect(obj: JSONObject?): String {
        val runs = obj?.optJSONArray("runs") ?: return ""
        val sb = StringBuilder()
        for (i in 0 until runs.length()) {
            sb.append(runs.optJSONObject(i)?.optString("text", "") ?: "")
        }
        return sb.toString().trim()
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

    private fun httpGetWithStatus(
        urlStr: String,
        headers: Map<String, String>,
        timeoutMs: Int
    ): Pair<Int, String?> {
        return runCatching {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = true
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            try {
                val code = conn.responseCode
                val body = if (code in 200..299) {
                    conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                } else null
                code to body
            } finally {
                conn.disconnect()
            }
        }.getOrElse { 0 to null }
    }

    private fun httpGetText(urlStr: String, headers: Map<String, String>, timeoutMs: Int): String? {
        return httpGetWithStatus(urlStr, headers, timeoutMs).second
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
            connectTimeout = 9000
            readTimeout = 10000
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
}
