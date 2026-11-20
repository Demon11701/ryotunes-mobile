package dev.ryoku.ryotunes

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
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

/**
 * Native WebView login screen for YouTube Music, Spotify, SoundCloud, and TIDAL.
 * Detects valid provider session cookies/tokens automatically without requiring
 * manual cookie pasting or developer API keys.
 */
class RyotunesAccountAuthActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROVIDER = "provider"
        const val RESULT_CONNECTED = "connected"
        const val RESULT_PROVIDER = "provider"
        const val RESULT_ACCOUNT_NAME = "accountName"

        private const val CLEAN_CHROME_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
    }

    private lateinit var provider: String
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var completed = false

    @SuppressLint("SetJavaScriptEnabled")
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

        val titleTv = TextView(this).apply {
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
                databaseEnabled = true
                useWideViewPort = true
                loadWithOverviewMode = true
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                userAgentString = CLEAN_CHROME_UA
            }
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
                // Keep http/https navigation inside our WebView rather than bouncing to native apps
                return scheme != "http" && scheme != "https"
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!completed && url != null) {
                    checkSessionAndFinish(manualTap = false, currentUrl = url)
                }
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                if (!completed && url != null) {
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

    private fun checkSessionAndFinish(manualTap: Boolean, currentUrl: String = webView.url ?: "") {
        if (completed) return
        val cm = CookieManager.getInstance()
        cm.flush()

        when (provider) {
            "ytmusic" -> {
                val cookies = cm.getCookie("https://music.youtube.com") ?: ""
                val map = RyotunesAccountVault.parseCookieMap(cookies)
                val sapisid = map["SAPISID"] ?: map["__Secure-3PAPISID"] ?: ""
                val onMusicDomain = currentUrl.contains("music.youtube.com", ignoreCase = true)
                if (sapisid.isNotBlank() && (onMusicDomain || manualTap)) {
                    completeWithSession(cookies, sapisid, "YouTube Music")
                } else if (manualTap) {
                    Toast.makeText(this, "Inicia sesión en YouTube Music antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
                }
            }
            "spotify" -> {
                val cookies = cm.getCookie("https://open.spotify.com") ?: ""
                val map = RyotunesAccountVault.parseCookieMap(cookies)
                val spDc = map["sp_dc"] ?: ""
                val onSpotifyWeb = currentUrl.contains("open.spotify.com", ignoreCase = true)
                if (spDc.isNotBlank() && (onSpotifyWeb || manualTap)) {
                    completeWithSession(cookies, spDc, "Spotify")
                } else if (manualTap) {
                    Toast.makeText(this, "Completa el acceso a Spotify antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
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
                val sessionId = map["sessionId"] ?: map["TIDAL_SESSION_ID"] ?: ""
                if (sessionId.isNotBlank()) {
                    completeWithSession(cookies, sessionId, "TIDAL")
                    return
                }
                // TIDAL web player often keeps OAuth tokens in localStorage
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
                        completeWithSession(cookies, tokenMatch, "TIDAL")
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

    private fun completeWithSession(cookies: String, token: String, label: String) {
        if (completed) return
        completed = true
        RyotunesAccountVault.saveSession(this, provider, cookies, token, label)
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
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}
