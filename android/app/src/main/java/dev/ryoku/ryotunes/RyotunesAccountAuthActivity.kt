package dev.ryoku.ryotunes

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.res.ResourcesCompat
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Native WebView login screen for YouTube Music, Spotify, SoundCloud, and TIDAL.
 * For Spotify, waits until open.spotify.com loads and captures the real Bearer accessToken
 * and client-token directly from WebView API traffic and session hooks (bypassing 2025 TOTP limits).
 */
class RyotunesAccountAuthActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROVIDER = "provider"
        const val RESULT_CONNECTED = "connected"
        const val RESULT_PROVIDER = "provider"
        const val RESULT_ACCOUNT_NAME = "accountName"

        internal const val CLEAN_CHROME_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"

        internal val SPOTIFY_TOKEN_HOOK_JS: String = """
            (function() {
              try {
                function report(auth, clientTok) {
                  if (!window.RyotunesTokenBridge) return;
                  var tok = '';
                  if (typeof auth === 'string') {
                    var m = auth.match(/Bearer\s+([^\s]+)/i);
                    tok = m ? m[1] : (auth.length > 30 ? auth : '');
                  }
                  var ct = (typeof clientTok === 'string') ? clientTok : '';
                  if (tok || ct) {
                    try { window.RyotunesTokenBridge.onToken(tok, ct); } catch (e) {}
                  }
                }
                function readSessionScript() {
                  var ids = ['session', 'config', 'initialState'];
                  for (var i = 0; i < ids.length; i++) {
                    var el = document.getElementById(ids[i]);
                    if (!el || !el.textContent) continue;
                    try {
                      var obj = JSON.parse(el.textContent);
                      if (obj && typeof obj.accessToken === 'string' && obj.accessToken.length > 20 && obj.isAnonymous !== true) {
                        report(obj.accessToken, '');
                      }
                    } catch (e) {
                      var m = el.textContent.match(/"accessToken"\s*:\s*"([^"]{24,})"/);
                      if (m && m[1] && el.textContent.indexOf('"isAnonymous":true') < 0) {
                        report(m[1], '');
                      }
                    }
                  }
                }
                readSessionScript();
                if (!window.__ryoSpotifyHooked) {
                  window.__ryoSpotifyHooked = true;
                  var origFetch = window.fetch;
                  if (typeof origFetch === 'function') {
                    window.fetch = function(input, init) {
                      try {
                        var url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
                        var hdrs = (init && init.headers) || (input && input.headers) || null;
                        if (hdrs && url && (url.indexOf('spotify.com') >= 0 || url.indexOf('spotifycdn') < 0)) {
                          var auth = '', ct = '';
                          if (typeof hdrs.get === 'function') {
                            auth = hdrs.get('authorization') || hdrs.get('Authorization') || '';
                            ct = hdrs.get('client-token') || hdrs.get('Client-Token') || '';
                          } else if (Array.isArray(hdrs)) {
                            for (var j = 0; j < hdrs.length; j++) {
                              var k = String(hdrs[j][0] || '').toLowerCase();
                              if (k === 'authorization') auth = String(hdrs[j][1] || '');
                              if (k === 'client-token') ct = String(hdrs[j][1] || '');
                            }
                          } else if (typeof hdrs === 'object') {
                            var keys = Object.keys(hdrs);
                            for (var n = 0; n < keys.length; n++) {
                              var kl = keys[n].toLowerCase();
                              if (kl === 'authorization') auth = String(hdrs[keys[n]] || '');
                              if (kl === 'client-token') ct = String(hdrs[keys[n]] || '');
                            }
                          }
                          if (auth || ct) report(auth, ct);
                        }
                      } catch (e) {}
                      return origFetch.apply(this, arguments);
                    };
                  }
                  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
                  if (typeof origSetHeader === 'function') {
                    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                      try {
                        var nl = String(name || '').toLowerCase();
                        if (nl === 'authorization') report(String(value || ''), '');
                        if (nl === 'client-token') report('', String(value || ''));
                      } catch (e) {}
                      return origSetHeader.apply(this, arguments);
                    };
                  }
                }
              } catch (e) {}
            })();
        """.trimIndent()
    }

    private lateinit var provider: String
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var titleTv: TextView
    private val mainHandler = Handler(Looper.getMainLooper())
    private val capturedAccessToken = AtomicReference("")
    private val capturedClientToken = AtomicReference("")
    private val finishScheduled = AtomicBoolean(false)
    private var completed = false

    private inner class TokenCaptureBridge {
        @JavascriptInterface
        fun onToken(accessToken: String?, clientToken: String?) {
            val tok = accessToken?.trim().orEmpty()
            val ct = clientToken?.trim().orEmpty()
            var updated = false
            if (tok.length > 20) {
                capturedAccessToken.set(tok)
                updated = true
            }
            if (ct.length > 10) {
                capturedClientToken.set(ct)
                updated = true
            }
            if (updated && capturedAccessToken.get().isNotBlank()) {
                scheduleSpotifyCheck()
            }
        }
    }

    private fun scheduleSpotifyCheck() {
        if (completed || provider != "spotify") return
        if (finishScheduled.compareAndSet(false, true)) {
            mainHandler.postDelayed({
                finishScheduled.set(false)
                if (!completed) {
                    checkSessionAndFinish(manualTap = false)
                }
            }, 400L)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        provider = RyotunesAccountVault.normalizeProvider(intent.getStringExtra(EXTRA_PROVIDER) ?: "ytmusic")
        val ndot = try {
            ResourcesCompat.getFont(this, R.font.ndot57) ?: Typeface.MONOSPACE
        } catch (_: Throwable) {
            Typeface.MONOSPACE
        }
        val dp = resources.displayMetrics.density
        fun dpPx(v: Int) = (v * dp).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0910"))
            fitsSystemWindows = true
        }

        // Bento Top Bar
        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#14101F"))
            setPadding(dpPx(14), dpPx(10), dpPx(12), dpPx(10))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val providerTitle = when (provider) {
            "ytmusic" -> "YT MUSIC"
            "spotify" -> "SPOTIFY"
            "soundcloud" -> "SOUNDCLOUD"
            "tidal" -> "TIDAL"
            else -> provider.uppercase()
        }

        titleTv = TextView(this).apply {
            text = "● CONECTAR // $providerTitle"
            setTextColor(Color.parseColor("#F3EEFF"))
            textSize = 13f
            typeface = ndot
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        topBar.addView(titleTv)

        val doneBg = GradientDrawable().apply {
            setColor(Color.parseColor("#A855F7"))
            cornerRadius = dpPx(14).toFloat()
        }
        val doneBtn = Button(this).apply {
            text = "LISTO"
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = ndot
            background = doneBg
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setPadding(dpPx(14), dpPx(6), dpPx(14), dpPx(6))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dpPx(8) }
            setOnClickListener { checkSessionAndFinish(manualTap = true) }
        }
        topBar.addView(doneBtn)

        val closeBg = GradientDrawable().apply {
            setColor(Color.parseColor("#1F1830"))
            setStroke(dpPx(1), Color.parseColor("#382C52"))
            cornerRadius = dpPx(14).toFloat()
        }
        val closeBtn = Button(this).apply {
            text = "CERRAR"
            setTextColor(Color.parseColor("#C084FC"))
            textSize = 11f
            typeface = ndot
            background = closeBg
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setPadding(dpPx(12), dpPx(6), dpPx(12), dpPx(6))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                setResult(Activity.RESULT_CANCELED)
                finish()
            }
        }
        topBar.addView(closeBtn)

        root.addView(topBar)

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 15
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpPx(3))
        }
        root.addView(progressBar)

        webView = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            setBackgroundColor(Color.parseColor("#0B0910"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                @Suppress("DEPRECATION")
                databaseEnabled = true
                useWideViewPort = true
                loadWithOverviewMode = true
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                userAgentString = CLEAN_CHROME_UA
            }
            addJavascriptInterface(TokenCaptureBridge(), "RyotunesTokenBridge")
        }

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(webView, true)

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val scheme = request?.url?.scheme?.lowercase() ?: return false
                // Keep http/https inside WebView instead of bouncing out to native Spotify/YT apps
                return scheme != "http" && scheme != "https"
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                if (!completed && request != null) {
                    val host = request.url?.host?.lowercase().orEmpty()
                    val hdrs = request.requestHeaders
                    if (hdrs != null && hdrs.isNotEmpty()) {
                        if (provider == "spotify" &&
                            (host.contains("api.spotify.com") ||
                                host.contains("api-partner.spotify.com") ||
                                host.contains("spclient.wg.spotify.com"))
                        ) {
                            for ((k, v) in hdrs) {
                                val kl = k.lowercase()
                                if (kl == "authorization" && v.startsWith("Bearer ", ignoreCase = true)) {
                                    val tok = v.substring(7).trim()
                                    if (tok.length > 20) capturedAccessToken.set(tok)
                                } else if (kl == "client-token" && v.length > 10) {
                                    capturedClientToken.set(v.trim())
                                }
                            }
                            if (capturedAccessToken.get().isNotBlank()) {
                                scheduleSpotifyCheck()
                            }
                        } else if (provider == "tidal" &&
                            (host.contains("api.tidal.com") || host.contains("listen.tidal.com"))
                        ) {
                            for ((k, v) in hdrs) {
                                if (k.equals("authorization", ignoreCase = true) &&
                                    v.startsWith("Bearer ", ignoreCase = true)
                                ) {
                                    val tok = v.substring(7).trim()
                                    if (tok.length > 20) {
                                        capturedAccessToken.set(tok)
                                        mainHandler.post { checkSessionAndFinish(manualTap = false) }
                                    }
                                }
                            }
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (!completed && provider == "spotify" && url != null &&
                    url.contains("open.spotify.com", ignoreCase = true)
                ) {
                    titleTv.text = "● CAPTURANDO SESIÓN // SPOTIFY…"
                    view?.evaluateJavascript(SPOTIFY_TOKEN_HOOK_JS, null)
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!completed && url != null) {
                    if (provider == "spotify" && url.contains("open.spotify.com", ignoreCase = true)) {
                        titleTv.text = "● CAPTURANDO SESIÓN // SPOTIFY…"
                        view?.evaluateJavascript(SPOTIFY_TOKEN_HOOK_JS, null)
                        // Re-check once SPA hydrates API calls
                        mainHandler.postDelayed({
                            if (!completed) {
                                view?.evaluateJavascript(SPOTIFY_TOKEN_HOOK_JS, null)
                                checkSessionAndFinish(manualTap = false, currentUrl = webView.url ?: url)
                            }
                        }, 1500L)
                    }
                    checkSessionAndFinish(manualTap = false, currentUrl = url)
                }
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                if (!completed && url != null) {
                    if (provider == "spotify" && url.contains("open.spotify.com", ignoreCase = true)) {
                        view?.evaluateJavascript(SPOTIFY_TOKEN_HOOK_JS, null)
                    }
                    checkSessionAndFinish(manualTap = false, currentUrl = url)
                }
            }
        }

        root.addView(webView)
        setContentView(root)

        val loginUrl = when (provider) {
            "ytmusic" -> "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F"
            "spotify" -> "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F"
            "soundcloud" -> "https://soundcloud.com/signin"
            "tidal" -> "https://listen.tidal.com/"
            else -> "https://music.youtube.com/"
        }
        webView.loadUrl(loginUrl)
    }

    private fun readSpotifyCookies(cm: CookieManager): Pair<String, String> {
        val c1 = cm.getCookie("https://open.spotify.com").orEmpty()
        val c2 = cm.getCookie("https://spotify.com").orEmpty()
        val mergedMap = LinkedHashMap<String, String>()
        mergedMap.putAll(RyotunesAccountVault.parseCookieMap(c2))
        mergedMap.putAll(RyotunesAccountVault.parseCookieMap(c1))
        val spDc = mergedMap["sp_dc"].orEmpty()
        val header = mergedMap.entries.joinToString("; ") { "${it.key}=${it.value}" }
        return header to spDc
    }

    private fun checkSessionAndFinish(manualTap: Boolean, currentUrl: String = webView.url ?: "") {
        if (completed) return
        val cm = CookieManager.getInstance()
        cm.flush()

        when (provider) {
            "ytmusic" -> {
                val c1 = cm.getCookie("https://music.youtube.com").orEmpty()
                val c2 = cm.getCookie("https://youtube.com").orEmpty()
                val map = LinkedHashMap<String, String>().apply {
                    putAll(RyotunesAccountVault.parseCookieMap(c2))
                    putAll(RyotunesAccountVault.parseCookieMap(c1))
                }
                val cookies = map.entries.joinToString("; ") { "${it.key}=${it.value}" }
                val sapisid = map["SAPISID"] ?: map["__Secure-3PAPISID"] ?: ""
                val onMusicDomain = currentUrl.contains("music.youtube.com", ignoreCase = true)
                if (sapisid.isNotBlank() && (onMusicDomain || manualTap)) {
                    completeWithSession(cookies, sapisid, "YouTube Music")
                } else if (manualTap) {
                    Toast.makeText(this, "Inicia sesión en YouTube Music antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
                }
            }
            "spotify" -> {
                val (cookies, spDc) = readSpotifyCookies(cm)
                val onAccounts = currentUrl.contains("accounts.spotify.com", ignoreCase = true)
                val onOpenSpotify = currentUrl.contains("open.spotify.com", ignoreCase = true)
                val accessTok = capturedAccessToken.get()
                val clientTok = capturedClientToken.get()

                // Never auto-close while still on accounts.spotify.com — wait for open.spotify.com + real Bearer token
                if (spDc.isNotBlank() && accessTok.isNotBlank() && !onAccounts && (onOpenSpotify || manualTap)) {
                    completeWithSession(cookies, spDc, "Spotify", accessTok, clientTok)
                    return
                }

                if (manualTap) {
                    if (spDc.isNotBlank() && !onOpenSpotify) {
                        Toast.makeText(this, "Cargando Spotify Web para capturar tu sesión…", Toast.LENGTH_SHORT).show()
                        webView.loadUrl("https://open.spotify.com/")
                    } else if (spDc.isNotBlank() && onOpenSpotify) {
                        webView.evaluateJavascript(SPOTIFY_TOKEN_HOOK_JS, null)
                        mainHandler.postDelayed({
                            if (completed) return@postDelayed
                            val (latestCookies, latestSpDc) = readSpotifyCookies(CookieManager.getInstance())
                            val tokNow = capturedAccessToken.get()
                            val ctNow = capturedClientToken.get()
                            completeWithSession(latestCookies, latestSpDc.ifBlank { spDc }, "Spotify", tokNow, ctNow)
                        }, 650L)
                    } else {
                        Toast.makeText(this, "Completa el acceso a Spotify antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            "soundcloud" -> {
                val cookies = cm.getCookie("https://soundcloud.com") ?: ""
                val map = RyotunesAccountVault.parseCookieMap(cookies)
                val oauth = map["oauth_token"] ?: ""
                if (oauth.isNotBlank()) {
                    completeWithSession(cookies, oauth, "SoundCloud")
                } else if (manualTap) {
                    Toast.makeText(this, "Inicia sesión en SoundCloud antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
                }
            }
            "tidal" -> {
                val cookies = cm.getCookie("https://listen.tidal.com") ?: ""
                val map = RyotunesAccountVault.parseCookieMap(cookies)
                val capturedBearer = capturedAccessToken.get()
                if (capturedBearer.isNotBlank()) {
                    completeWithSession(cookies, capturedBearer, "TIDAL", capturedBearer, "")
                    return
                }
                val sessionId = map["sessionId"] ?: map["TIDAL_SESSION_ID"] ?: ""
                if (sessionId.isNotBlank()) {
                    completeWithSession(cookies, sessionId, "TIDAL")
                    return
                }
                val js = """
                    (function() {
                      try {
                        for (var i = 0; i < localStorage.length; i++) {
                          var k = localStorage.key(i);
                          var v = localStorage.getItem(k) || '';
                          if (v.indexOf('access_token') >= 0 || v.indexOf('sessionId') >= 0 || k.indexOf('oauth') >= 0) {
                            return v.substring(0, 2000);
                          }
                        }
                      } catch(e) {}
                      return '';
                    })();
                """.trimIndent()
                webView.evaluateJavascript(js) { raw ->
                    val cleaned = raw?.trim()?.removeSurrounding("\"")?.replace("\\\"", "\"") ?: ""
                    val tokenMatch = Regex("\"access_token\"\\s*:\\s*\"([^\"]+)\"").find(cleaned)?.groupValues?.getOrNull(1)
                        ?: Regex("\"sessionId\"\\s*:\\s*\"([^\"]+)\"").find(cleaned)?.groupValues?.getOrNull(1)
                        ?: ""
                    if (tokenMatch.isNotBlank()) {
                        completeWithSession(cookies, tokenMatch, "TIDAL", tokenMatch, "")
                    } else if (manualTap) {
                        if (cookies.isNotBlank() && currentUrl.contains("listen.tidal.com", ignoreCase = true)) {
                            completeWithSession(cookies, "web_session", "TIDAL")
                        } else {
                            Toast.makeText(this, "Inicia sesión en TIDAL antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        }
    }

    private fun completeWithSession(
        cookies: String,
        token: String,
        label: String,
        accessToken: String = "",
        clientToken: String = ""
    ) {
        if (completed) return
        completed = true
        RyotunesAccountVault.saveSession(this, provider, cookies, token, label, accessToken, clientToken)
        val data = Intent().apply {
            putExtra(RESULT_CONNECTED, true)
            putExtra(RESULT_PROVIDER, provider)
            putExtra(RESULT_ACCOUNT_NAME, label)
        }
        setResult(Activity.RESULT_OK, data)
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            setResult(Activity.RESULT_CANCELED)
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}
