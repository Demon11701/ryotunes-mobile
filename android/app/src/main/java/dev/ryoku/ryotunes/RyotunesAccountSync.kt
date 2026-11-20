package dev.ryoku.ryotunes

import android.content.Context
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

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

    // ── YouTube Music (SAPISIDHASH + InnerTube WEB_REMIX) ────────────────────

    private fun buildYtmHeaders(session: RyotunesAccountVault.AccountSession): Map<String, String> {
        val ts = System.currentTimeMillis() / 1000L
        val origin = "https://music.youtube.com"
        val digest = MessageDigest.getInstance("SHA-1")
            .digest("$ts ${session.primaryToken} $origin".toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }
        return mapOf(
            "Authorization" to "SAPISIDHASH ${ts}_$hex",
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
                    put("hl", "en")
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
                    put("title", "YouTube Music · Liked")
                    put("subtitle", "${likedTracks.size} tracks · Synced")
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
            val stubs = extractYtmPlaylistStubsRecursive(plListJson).take(10)
            for (stub in stubs) {
                val browseId = stub.first
                val title = stub.second
                val cover = stub.third
                val normalizedBrowse = if (browseId.startsWith("VL")) browseId else "VL$browseId"
                val detail = runCatching { ytmBrowse(normalizedBrowse, headers) }.getOrNull() ?: continue
                val items = extractYtmTracksRecursive(detail)
                if (items.isEmpty()) continue
                val idsArr = JSArray()
                items.forEach { t ->
                    val tid = t.optString("id", "")
                    if (tid.isNotEmpty()) {
                        allTracksMap[tid] = t
                        idsArr.put(tid)
                    }
                }
                playlistsArr.put(JSObject().apply {
                    put("id", "PL:ytmusic:${browseId.removePrefix("VL")}")
                    put("title", title.ifBlank { "YouTube Playlist" })
                    put("subtitle", "${items.size} tracks · YouTube Music")
                    put("provider", "youtube")
                    put("artwork", cover.ifBlank { items.firstOrNull()?.optString("artwork", "") ?: "" })
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

    // ── Spotify (sp_dc -> web_player token + public embed fallback) ──────────

    private fun fetchSpotifyAccessToken(spDc: String): String {
        val raw = httpGetText(
            "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
            mapOf(
                "Cookie" to "sp_dc=$spDc",
                "User-Agent" to WEB_UA,
                "Accept" to "application/json"
            ),
            8000
        ) ?: throw IllegalStateException("No se pudo autenticar la sesión de Spotify")
        val json = JSONObject(raw)
        val token = json.optString("accessToken", "")
        if (token.isBlank()) {
            throw IllegalStateException("Sesión de Spotify expirada; vuelve a iniciar sesión")
        }
        return token
    }

    private fun syncSpotify(
        context: Context,
        session: RyotunesAccountVault.AccountSession
    ): JSObject {
        val token = fetchSpotifyAccessToken(session.primaryToken)
        val authHeaders = mapOf(
            "Authorization" to "Bearer $token",
            "User-Agent" to WEB_UA
        )

        var displayName = session.accountName
        runCatching {
            val meRaw = httpGetText("https://api.spotify.com/v1/me", authHeaders, 7000)
            if (!meRaw.isNullOrBlank()) {
                val me = JSONObject(meRaw)
                val name = me.optString("display_name", "").ifBlank { me.optString("id", "") }
                if (name.isNotBlank()) {
                    displayName = name
                    RyotunesAccountVault.updateAccountName(context, "spotify", name)
                }
            }
        }

        val playlistsArr = JSArray()
        val allTracksMap = LinkedHashMap<String, JSObject>()
        val likedIds = mutableListOf<String>()

        // 1) Liked Songs (/v1/me/tracks)
        runCatching {
            val savedRaw = httpGetText("https://api.spotify.com/v1/me/tracks?limit=50", authHeaders, 8000)
            if (!savedRaw.isNullOrBlank()) {
                val items = JSONObject(savedRaw).optJSONArray("items") ?: JSONArray()
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
                        put("title", "Spotify · Liked Songs")
                        put("subtitle", "${idsArr.length()} tracks · Synced")
                        put("provider", "spotify")
                        put("artwork", firstArt)
                        put("trackIds", idsArr)
                        put("createdAt", System.currentTimeMillis())
                    })
                }
            }
        }

        // 2) User Playlists (/v1/me/playlists)
        runCatching {
            val plRaw = httpGetText("https://api.spotify.com/v1/me/playlists?limit=20", authHeaders, 8000)
            if (!plRaw.isNullOrBlank()) {
                val plItems = JSONObject(plRaw).optJSONArray("items") ?: JSONArray()
                val limit = minOf(plItems.length(), 10)
                for (i in 0 until limit) {
                    val pl = plItems.optJSONObject(i) ?: continue
                    val plId = pl.optString("id", "")
                    val plTitle = pl.optString("name", "Spotify Playlist")
                    if (plId.isBlank()) continue
                    val plArt = pl.optJSONArray("images")?.optJSONObject(0)?.optString("url", "") ?: ""
                    val trRaw = httpGetText("https://api.spotify.com/v1/playlists/$plId/tracks?limit=50", authHeaders, 8000)
                        ?: continue
                    val trItems = JSONObject(trRaw).optJSONArray("items") ?: JSONArray()
                    val idsArr = JSArray()
                    for (j in 0 until trItems.length()) {
                        val trackObj = trItems.optJSONObject(j)?.optJSONObject("track") ?: continue
                        val mapped = mapSpotifyTrack(trackObj) ?: continue
                        val tid = mapped.optString("id", "")
                        if (tid.isNotEmpty()) {
                            allTracksMap[tid] = mapped
                            idsArr.put(tid)
                        }
                    }
                    if (idsArr.length() > 0) {
                        playlistsArr.put(JSObject().apply {
                            put("id", "PL:spotify:$plId")
                            put("title", plTitle)
                            put("subtitle", "${idsArr.length()} tracks · Spotify")
                            put("provider", "spotify")
                            put("artwork", plArt)
                            put("trackIds", idsArr)
                            put("createdAt", System.currentTimeMillis())
                        })
                    }
                }
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
                val token = fetchSpotifyAccessToken(session.primaryToken)
                val headers = mapOf("Authorization" to "Bearer $token", "User-Agent" to WEB_UA)
                val raw = httpGetText("https://api.spotify.com/v1/playlists/$plId", headers, 8000)
                if (!raw.isNullOrBlank()) {
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
                            put("subtitle", "${tracksArr.length()} tracks · Spotify")
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

    // ── Recursive InnerTube WEB_REMIX Parsers ────────────────────────────────

    private fun extractYtmTracksRecursive(node: Any?): List<JSObject> {
        val out = mutableListOf<JSObject>()
        val seen = HashSet<String>()
        fun walk(cur: Any?) {
            when (cur) {
                is JSONObject -> {
                    val renderer = cur.optJSONObject("musicResponsiveListItemRenderer")
                    if (renderer != null) {
                        parseYtmTrackRenderer(renderer)?.let { tr ->
                            val id = tr.optString("id")
                            if (id.isNotBlank() && seen.add(id)) out.add(tr)
                        }
                    }
                    val keys = cur.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        if (out.size >= 80) return
                        walk(cur.opt(k))
                    }
                }
                is JSONArray -> {
                    for (i in 0 until cur.length()) {
                        if (out.size >= 80) return
                        walk(cur.opt(i))
                    }
                }
            }
        }
        walk(node)
        return out
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

    private fun httpGetText(urlStr: String, headers: Map<String, String>, timeoutMs: Int): String? {
        return runCatching {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = true
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
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
