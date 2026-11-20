package dev.ryoku.ryotunes

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
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
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Native WebView login screen for YouTube Music, Spotify, SoundCloud, and TIDAL.
 * - Strips X-Requested-With header via AndroidX WebKit to avoid Google OAuth WebView blocks.
 * - Uses device-coherent dynamic Chrome Mobile UA on login domains (Google / accounts.spotify.com)
 *   and switches dynamically to matching-version Linux Desktop Chrome UA on open.spotify.com.
 * - Injects DocumentStartJavaScript BEFORE Spotify boots to inhibit Service Workers and hook
 *   fetch (Request / Headers / Array / Object), token responses, Pathfinder libraryV3, and XHR.
 * - Grants Widevine DRM (RESOURCE_PROTECTED_MEDIA_ID) and provides resilient DOM library rescue.
 */
class RyotunesAccountAuthActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROVIDER = "provider"
        const val RESULT_CONNECTED = "connected"
        const val RESULT_PROVIDER = "provider"
        const val RESULT_ACCOUNT_NAME = "accountName"

        private const val FALLBACK_MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

        internal fun buildCleanMobileUa(context: Context): String {
            val defaultUa = runCatching { WebSettings.getDefaultUserAgent(context) }
                .getOrDefault(FALLBACK_MOBILE_UA)
            return defaultUa
                .replace(Regex(";\\s*wv\\b", RegexOption.IGNORE_CASE), "")
                .replace(Regex("\\bVersion/\\d+(?:\\.\\d+)*\\s*"), "")
                .replace(Regex("\\s{2,}"), " ")
                .trim()
        }

        internal fun buildCleanDesktopUa(context: Context): String {
            val defaultUa = runCatching { WebSettings.getDefaultUserAgent(context) }
                .getOrDefault(FALLBACK_MOBILE_UA)
            val realChromeVersion = Regex("Chrome/(\\d+(?:\\.\\d+)*)")
                .find(defaultUa)
                ?.groupValues
                ?.getOrNull(1)
                ?.ifBlank { "131.0.0.0" }
                ?: "131.0.0.0"
            return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$realChromeVersion Safari/537.36"
        }

        internal const val MAX_BRIDGE_JSON_BYTES = 2 * 1024 * 1024

        private val ALLOWED_AUTH_DOMAIN_SUFFIXES = listOf(
            "spotify.com",
            "youtube.com",
            "google.com",
            "gstatic.com",
            "googleapis.com",
            "soundcloud.com",
            "tidal.com",
            "appleid.apple.com",
            "facebook.com"
        )

        internal fun isAllowedAuthUrl(rawUrl: String?): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return false
            if (!uri.scheme.equals("https", ignoreCase = true)) return false
            val host = uri.host?.lowercase()?.trim().orEmpty()
            if (host.isBlank()) return false
            return ALLOWED_AUTH_DOMAIN_SUFFIXES.any { suffix ->
                host == suffix || host.endsWith(".$suffix")
            }
        }

        internal fun isExpectedProviderOrigin(rawUrl: String?, provider: String): Boolean {
            if (rawUrl.isNullOrBlank()) return false
            val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return false
            if (!uri.scheme.equals("https", ignoreCase = true)) return false
            val host = uri.host?.lowercase()?.trim().orEmpty()
            return when (RyotunesAccountVault.normalizeProvider(provider)) {
                "spotify" -> host == "open.spotify.com"
                "ytmusic" -> host == "music.youtube.com" || host == "youtube.com" || host.endsWith(".youtube.com")
                "soundcloud" -> host == "soundcloud.com" || host.endsWith(".soundcloud.com")
                "tidal" -> host == "listen.tidal.com" || host == "tidal.com" || host.endsWith(".tidal.com")
                else -> false
            }
        }

        internal fun suppressRequestedWithHeader(settings: WebSettings) {
            runCatching {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                    WebSettingsCompat.setRequestedWithHeaderOriginAllowList(settings, emptySet())
                }
            }
        }

        internal fun installSpotifyDocumentStartHook(webView: WebView) {
            runCatching {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    WebViewCompat.addDocumentStartJavaScript(
                        webView,
                        SPOTIFY_DOCUMENT_START_HOOK_JS,
                        setOf("https://open.spotify.com")
                    )
                }
            }
        }

        internal val SPOTIFY_DOCUMENT_START_HOOK_JS: String = """
            (function() {
              try {
                if (window.__ryoDocStartInstalled) return;
                window.__ryoDocStartInstalled = true;

                // 1) Inhibit Service Workers on open.spotify.com so requests never bypass fetch/WebView hooks
                try {
                  if (navigator && navigator.serviceWorker) {
                    if (typeof navigator.serviceWorker.getRegistrations === 'function') {
                      navigator.serviceWorker.getRegistrations().then(function(regs) {
                        for (var i = 0; i < regs.length; i++) {
                          try { regs[i].unregister(); } catch (e) {}
                        }
                      }).catch(function() {});
                    }
                    try {
                      navigator.serviceWorker.register = function() {
                        return Promise.reject(new Error('SW disabled by Ryotunes'));
                      };
                    } catch (e) {
                      try {
                        Object.defineProperty(navigator, 'serviceWorker', {
                          get: function() { return undefined; },
                          configurable: true
                        });
                      } catch (e2) {}
                    }
                  }
                } catch (e) {}

                function sendHeaders(bearer, clientToken) {
                  if (!window.RyotunesAuthBridge) return;
                  var b = '';
                  if (typeof bearer === 'string') {
                    var m = bearer.match(/Bearer\s+([^\s]+)/i);
                    b = m ? m[1] : (bearer.length > 24 ? bearer.trim() : '');
                  }
                  var ct = (typeof clientToken === 'string') ? clientToken.trim() : '';
                  if (b || ct) {
                    try { window.RyotunesAuthBridge.onCapturedHeaders(b, ct); } catch (e) {}
                  }
                }

                function sendTokenJson(tok, isAnon) {
                  if (!window.RyotunesAuthBridge) return;
                  if (typeof tok === 'string' && tok.length > 24) {
                    try { window.RyotunesAuthBridge.onCapturedTokenJson(tok.trim(), Boolean(isAnon)); } catch (e) {}
                  }
                }

                function readHeaderContainer(hdrs, out) {
                  if (!hdrs) return;
                  try {
                    if (typeof hdrs.forEach === 'function') {
                      hdrs.forEach(function(val, key) {
                        var kl = String(key || '').toLowerCase();
                        if (kl === 'authorization' && val) out.auth = String(val);
                        if (kl === 'client-token' && val) out.ct = String(val);
                      });
                    } else if (Array.isArray(hdrs)) {
                      for (var i = 0; i < hdrs.length; i++) {
                        var pair = hdrs[i];
                        if (!pair || pair.length < 2) continue;
                        var kl = String(pair[0] || '').toLowerCase();
                        if (kl === 'authorization' && pair[1]) out.auth = String(pair[1]);
                        if (kl === 'client-token' && pair[1]) out.ct = String(pair[1]);
                      }
                    } else if (typeof hdrs === 'object') {
                      var keys = Object.keys(hdrs);
                      for (var j = 0; j < keys.length; j++) {
                        var k = keys[j];
                        var kl = String(k || '').toLowerCase();
                        var v = hdrs[k];
                        if (kl === 'authorization' && v) out.auth = String(v);
                        if (kl === 'client-token' && v) out.ct = String(v);
                      }
                    }
                  } catch (e) {}
                }

                function extractPathfinderLibrary(data) {
                  try {
                    var lib = data && data.data && data.data.me && data.data.me.libraryV3;
                    if (!lib || !Array.isArray(lib.items)) return;
                    var pls = [];
                    var seen = {};
                    for (var i = 0; i < lib.items.length; i++) {
                      var entry = lib.items[i] && lib.items[i].item;
                      var d = entry && entry.data;
                      if (!d) continue;
                      var uri = String(d.uri || entry._uri || '');
                      var m = uri.match(/spotify:playlist:([A-Za-z0-9]+)/);
                      if (!m || seen[m[1]]) continue;
                      seen[m[1]] = true;
                      var name = String(d.name || '').trim();
                      var img = '';
                      try {
                        var srcs = d.images && d.images.items && d.images.items[0] && d.images.items[0].sources;
                        if (Array.isArray(srcs) && srcs.length > 0) img = String(srcs[0].url || '');
                      } catch (e) {}
                      if (name) pls.push({ id: m[1], name: name, image: img });
                    }
                    if (pls.length > 0 && window.RyotunesAuthBridge) {
                      window.RyotunesAuthBridge.onScrapedLibrary(JSON.stringify({
                        source: 'pathfinder',
                        profileName: '',
                        hasLiked: true,
                        playlists: pls
                      }));
                    }
                  } catch (e) {}
                }

                // 2) Hook window.fetch BEFORE Spotify's bundle grabs a reference
                var origFetch = window.fetch;
                if (typeof origFetch === 'function') {
                  window.fetch = function(input, init) {
                    var url = '';
                    try {
                      url = (typeof input === 'string') ? input : (input && input.url ? String(input.url) : '');
                      var out = { auth: '', ct: '' };
                      if (typeof Request !== 'undefined' && input instanceof Request) {
                        readHeaderContainer(input.headers, out);
                      } else if (input && input.headers) {
                        readHeaderContainer(input.headers, out);
                      }
                      if (init && init.headers) {
                        readHeaderContainer(init.headers, out);
                      }
                      if (out.auth || out.ct) {
                        sendHeaders(out.auth, out.ct);
                      }
                    } catch (e) {}

                    var promise = origFetch.apply(this, arguments);
                    try {
                      var lowerUrl = url.toLowerCase();
                      var isTokenUrl = lowerUrl.indexOf('get_access_token') >= 0 ||
                        lowerUrl.indexOf('clienttoken') >= 0 ||
                        lowerUrl.indexOf('/token') >= 0;
                      var isPathfinder = lowerUrl.indexOf('api-partner.spotify.com') >= 0 &&
                        lowerUrl.indexOf('pathfinder') >= 0;
                      if (promise && typeof promise.then === 'function' && (isTokenUrl || isPathfinder)) {
                        promise.then(function(res) {
                          try {
                            if (!res || !res.ok) return;
                            res.clone().json().then(function(json) {
                              if (!json || typeof json !== 'object') return;
                              if (typeof json.accessToken === 'string' && json.accessToken.length > 24) {
                                sendTokenJson(json.accessToken, json.isAnonymous === true);
                              }
                              if (typeof json.access_token === 'string' && json.access_token.length > 24) {
                                sendTokenJson(json.access_token, false);
                              }
                              if (json.granted_token && typeof json.granted_token.token === 'string') {
                                sendHeaders('', json.granted_token.token);
                              }
                              if (isPathfinder) {
                                extractPathfinderLibrary(json);
                              }
                            }).catch(function() {});
                          } catch (e) {}
                        }).catch(function() {});
                      }
                    } catch (e) {}
                    return promise;
                  };
                }

                // 3) Hook XMLHttpRequest.prototype.setRequestHeader
                var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
                if (typeof origSetHeader === 'function') {
                  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                    try {
                      var nl = String(name || '').toLowerCase();
                      if (nl === 'authorization') sendHeaders(String(value || ''), '');
                      if (nl === 'client-token') sendHeaders('', String(value || ''));
                    } catch (e) {}
                    return origSetHeader.apply(this, arguments);
                  };
                }

                // 4) Inspect <script id="session"> / __NEXT_DATA__ when DOM becomes interactive
                function scanInlineSession() {
                  try {
                    var ids = ['session', 'config', 'initialState', '__NEXT_DATA__'];
                    for (var i = 0; i < ids.length; i++) {
                      var el = document.getElementById(ids[i]);
                      if (!el || !el.textContent) continue;
                      var raw = el.textContent;
                      try {
                        var obj = JSON.parse(raw);
                        if (obj && typeof obj.accessToken === 'string' && obj.accessToken.length > 24) {
                          sendTokenJson(obj.accessToken, obj.isAnonymous === true);
                        }
                      } catch (e) {
                        var m = raw.match(/"accessToken"\s*:\s*"([^"]{24,})"/);
                        var anon = raw.indexOf('"isAnonymous":true') >= 0 || raw.indexOf('"isAnonymous": true') >= 0;
                        if (m && m[1]) sendTokenJson(m[1], anon);
                      }
                    }
                  } catch (e) {}
                }
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', scanInlineSession);
                } else {
                  scanInlineSession();
                }
              } catch (e) {}
            })();
        """.trimIndent()

        internal val SPOTIFY_DOM_RESCUE_JS: String = """
            (function() {
              try {
                // 1) Scan <script id="session"> and window.__NEXT_DATA__
                var ids = ['session', 'config', 'initialState', '__NEXT_DATA__'];
                for (var i = 0; i < ids.length; i++) {
                  var el = document.getElementById(ids[i]);
                  if (!el || !el.textContent) continue;
                  var raw = el.textContent;
                  try {
                    var obj = JSON.parse(raw);
                    if (obj && typeof obj.accessToken === 'string' && obj.accessToken.length > 24) {
                      if (window.RyotunesAuthBridge) {
                        window.RyotunesAuthBridge.onCapturedTokenJson(obj.accessToken, obj.isAnonymous === true);
                      }
                    }
                  } catch (e) {
                    var m = raw.match(/"accessToken"\s*:\s*"([^"]{24,})"/);
                    var anon = raw.indexOf('"isAnonymous":true') >= 0 || raw.indexOf('"isAnonymous": true') >= 0;
                    if (m && m[1] && window.RyotunesAuthBridge) {
                      window.RyotunesAuthBridge.onCapturedTokenJson(m[1], anon);
                    }
                  }
                }
                try {
                  var nd = window.__NEXT_DATA__;
                  if (nd) {
                    var s = JSON.stringify(nd);
                    var nm = s.match(/"accessToken"\s*:\s*"([^"]{24,})"/);
                    var nanon = s.indexOf('"isAnonymous":true') >= 0;
                    if (nm && nm[1] && window.RyotunesAuthBridge) {
                      window.RyotunesAuthBridge.onCapturedTokenJson(nm[1], nanon);
                    }
                  }
                } catch (e) {}

                // 2) Scrape authenticated profile name & visible playlists in Your Library / DOM
                var profileName = '';
                try {
                  var userBtn = document.querySelector('button[data-testid="user-widget-link"], [data-testid="user-widget-name"]');
                  if (userBtn) {
                    profileName = String(
                      userBtn.getAttribute('aria-label') ||
                      userBtn.getAttribute('title') ||
                      userBtn.innerText || ''
                    ).trim();
                  }
                } catch (e) {}

                var hasLiked = false;
                var pls = [];
                var seen = {};
                try {
                  if (document.querySelector('a[href="/collection/tracks"], [aria-label*="Tus me gusta"], [aria-label*="Liked Songs"]')) {
                    hasLiked = true;
                  }
                  var anchors = document.querySelectorAll('a[href*="/playlist/"]');
                  for (var aIdx = 0; aIdx < anchors.length; aIdx++) {
                    var a = anchors[aIdx];
                    var href = a.getAttribute('href') || '';
                    var pm = href.match(/\/playlist\/([A-Za-z0-9]+)/);
                    if (!pm || seen[pm[1]]) continue;
                    seen[pm[1]] = true;
                    var rawName = a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '';
                    var name = String(rawName).split('\n')[0].trim();
                    if (!name) {
                      var parentRow = a.closest('[role="listitem"], [role="button"], li, div');
                      if (parentRow) name = String(parentRow.innerText || '').split('\n')[0].trim();
                    }
                    var imgEl = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img'));
                    var img = imgEl ? (imgEl.getAttribute('src') || '') : '';
                    if (name && name.length < 120) {
                      pls.push({ id: pm[1], name: name, image: img });
                    }
                  }
                  // Also check role="listitem" rows in Spotify's virtualized Your Library sidebar
                  var rows = document.querySelectorAll('[data-testid="rootlist-item"], [aria-labelledby*="listrow-title-spotify:playlist:"]');
                  for (var rIdx = 0; rIdx < rows.length; rIdx++) {
                    var r = rows[rIdx];
                    var labelled = String(r.getAttribute('aria-labelledby') || '') + ' ' + String(r.innerHTML || '');
                    var rm = labelled.match(/spotify:playlist:([A-Za-z0-9]+)/);
                    if (!rm || seen[rm[1]]) continue;
                    seen[rm[1]] = true;
                    var rName = String(r.innerText || '').split('\n')[0].trim();
                    var rImgEl = r.querySelector('img');
                    var rImg = rImgEl ? (rImgEl.getAttribute('src') || '') : '';
                    if (rName && rName.length < 120) {
                      pls.push({ id: rm[1], name: rName, image: rImg });
                    }
                  }
                } catch (e) {}

                var bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
                var drmBlocked = bodyText.indexOf('reproducción deshabilitada') >= 0 ||
                  bodyText.indexOf('reproduccion deshabilitada') >= 0 ||
                  bodyText.indexOf('playback disabled') >= 0;
                var authenticatedUi = !drmBlocked && (
                  Boolean(profileName) || hasLiked || pls.length > 0 ||
                  Boolean(document.querySelector('[data-testid="user-widget-link"], [data-testid="your-library-search-input"]'))
                );

                if (window.RyotunesAuthBridge && (pls.length > 0 || profileName || hasLiked)) {
                  window.RyotunesAuthBridge.onScrapedLibrary(JSON.stringify({
                    source: 'dom',
                    profileName: profileName,
                    hasLiked: hasLiked,
                    authenticatedUi: authenticatedUi,
                    playlists: pls
                  }));
                }

                // 3) Trigger a lightweight session fetch to nudge token hooks if none captured yet
                try {
                  fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
                    credentials: 'include'
                  }).catch(function() {});
                } catch (e) {}

                return JSON.stringify({
                  drmBlocked: drmBlocked,
                  authenticatedUi: authenticatedUi,
                  profileName: profileName,
                  playlistCount: pls.length
                });
              } catch (e) {
                return JSON.stringify({ drmBlocked: false, authenticatedUi: false, profileName: '', playlistCount: 0 });
              }
            })();
        """.trimIndent()
    }

    private lateinit var provider: String
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var titleTv: TextView
    private lateinit var cleanMobileUa: String
    private lateinit var cleanDesktopUa: String
    private var desktopUaApplied = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val verifyExecutor = Executors.newSingleThreadExecutor()
    private val capturedAccessToken = AtomicReference("")
    private val capturedClientToken = AtomicReference("")
    private val scrapedProfileName = AtomicReference("")
    private val scrapedLibraryJson = AtomicReference("")
    private val currentWebUrl = AtomicReference("")
    private val finishScheduled = AtomicBoolean(false)
    private val verifyingSpotify = AtomicBoolean(false)
    private var completed = false

    private inner class AuthBridge {
        @JavascriptInterface
        fun onCapturedHeaders(bearer: String?, clientToken: String?) {
            if (completed) return
            if (!isExpectedProviderOrigin(currentWebUrl.get(), provider)) return
            val tok = bearer?.trim().orEmpty()
            val ct = clientToken?.trim().orEmpty()
            if (tok.length > 8192 || ct.length > 8192) return

            if (provider == "spotify") {
                val (_, spDc) = readSpotifyCookies(CookieManager.getInstance())
                if (spDc.isBlank()) return
            }

            var updated = false
            if (tok.length > 24) {
                capturedAccessToken.set(tok)
                updated = true
            }
            if (ct.length > 10) {
                capturedClientToken.set(ct)
                updated = true
            }
            if (updated && provider == "spotify") {
                RyotunesAccountVault.updateTokens(
                    this@RyotunesAccountAuthActivity,
                    "spotify",
                    capturedAccessToken.get(),
                    capturedClientToken.get()
                )
                if (capturedAccessToken.get().isNotBlank()) {
                    scheduleSpotifyCheck()
                }
            }
        }

        @JavascriptInterface
        fun onCapturedTokenJson(token: String?, isAnonymous: Boolean) {
            if (completed || isAnonymous) return
            if (!isExpectedProviderOrigin(currentWebUrl.get(), provider)) return
            val tok = token?.trim().orEmpty()
            if (tok.length <= 24 || tok.length > 8192) return
            if (provider == "spotify") {
                val (_, spDc) = readSpotifyCookies(CookieManager.getInstance())
                if (spDc.isBlank()) return
                capturedAccessToken.set(tok)
                RyotunesAccountVault.updateTokens(
                    this@RyotunesAccountAuthActivity,
                    "spotify",
                    tok,
                    capturedClientToken.get()
                )
                scheduleSpotifyCheck()
            }
        }

        @JavascriptInterface
        fun onScrapedLibrary(json: String?) {
            if (completed) return
            if (!isExpectedProviderOrigin(currentWebUrl.get(), provider)) return
            val raw = json?.trim().orEmpty()
            if (raw.isBlank() || raw.toByteArray(Charsets.UTF_8).size > MAX_BRIDGE_JSON_BYTES) return
            scrapedLibraryJson.set(raw)
            runCatching {
                val obj = JSONObject(raw)
                val name = obj.optString("profileName", "").trim()
                if (name.isNotBlank()) scrapedProfileName.set(name)
            }
            RyotunesAccountVault.saveScrapedLibraryJson(this@RyotunesAccountAuthActivity, provider, raw)
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
            }, 550L)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        provider = RyotunesAccountVault.normalizeProvider(intent.getStringExtra(EXTRA_PROVIDER) ?: "ytmusic")
        cleanMobileUa = buildCleanMobileUa(this)
        cleanDesktopUa = buildCleanDesktopUa(this)

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

        if (provider == "spotify") {
            val tipBanner = TextView(this).apply {
                text = "Tip: Si Google te bloquea, escribe tu correo directo en Spotify y entra con código de 6 dígitos."
                setBackgroundColor(Color.parseColor("#191326"))
                setTextColor(Color.parseColor("#C4B5FD"))
                textSize = 11f
                setPadding(dpPx(14), dpPx(6), dpPx(14), dpPx(7))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }
            root.addView(tipBanner)
        }

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
                allowFileAccess = false
                allowContentAccess = false
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = false
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = false
                setGeolocationEnabled(false)
                mediaPlaybackRequiresUserGesture = false
                useWideViewPort = true
                loadWithOverviewMode = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                userAgentString = cleanMobileUa
                suppressRequestedWithHeader(this)
            }
            // Register bridge & DocumentStart script BEFORE loading any URL
            addJavascriptInterface(AuthBridge(), "RyotunesAuthBridge")
        }

        if (provider == "spotify") {
            installSpotifyDocumentStartHook(webView)
        }

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(webView, true)

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val allowed = request.resources.filter {
                    it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                }.toTypedArray()
                if (allowed.isNotEmpty()) request.grant(allowed) else request.deny()
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                val urlStr = uri.toString()
                // Strict HTTPS-only allowlist (blocks javascript:, file://, content://, and arbitrary domains)
                if (!isAllowedAuthUrl(urlStr)) return true

                if (provider == "spotify" && view != null) {
                    val host = uri.host?.lowercase().orEmpty()
                    if (host == "open.spotify.com" && !desktopUaApplied) {
                        desktopUaApplied = true
                        view.settings.userAgentString = cleanDesktopUa
                        view.loadUrl(urlStr)
                        return true
                    } else if ((host.contains("accounts.spotify.com") || host.contains("accounts.google.com")) &&
                        desktopUaApplied
                    ) {
                        desktopUaApplied = false
                        view.settings.userAgentString = cleanMobileUa
                        view.loadUrl(urlStr)
                        return true
                    }
                }
                return false
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                if (!completed && request != null) {
                    val host = request.url?.host?.lowercase().orEmpty()
                    val hdrs = request.requestHeaders
                    if (hdrs != null && hdrs.isNotEmpty()) {
                        if (provider == "spotify" && (host == "spotify.com" || host.endsWith(".spotify.com"))) {
                            val hasSpDc = CookieManager.getInstance()
                                .getCookie("https://open.spotify.com")
                                ?.contains("sp_dc=") == true
                            if (hasSpDc) {
                                var updated = false
                                for ((k, v) in hdrs.entries) {
                                    if (k.equals("authorization", ignoreCase = true) &&
                                        v.startsWith("Bearer ", ignoreCase = true)
                                    ) {
                                        val tok = v.substring(7).trim()
                                        if (tok.length > 24) {
                                            capturedAccessToken.set(tok)
                                            updated = true
                                        }
                                    } else if (k.equals("client-token", ignoreCase = true) && v.length > 10) {
                                        capturedClientToken.set(v.trim())
                                        updated = true
                                    }
                                }
                                if (updated) {
                                    RyotunesAccountVault.updateTokens(
                                        this@RyotunesAccountAuthActivity,
                                        "spotify",
                                        capturedAccessToken.get(),
                                        capturedClientToken.get()
                                    )
                                    if (capturedAccessToken.get().isNotBlank()) {
                                        scheduleSpotifyCheck()
                                    }
                                }
                            }
                        } else if (provider == "tidal" &&
                            (host.contains("api.tidal.com") || host.contains("listen.tidal.com"))
                        ) {
                            for ((k, v) in hdrs.entries) {
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
                if (url != null) currentWebUrl.set(url)
                if (!completed && provider == "spotify" && url != null && view != null) {
                    val isOpenSpotify = url.contains("://open.spotify.com", ignoreCase = true)
                    if (isOpenSpotify && !desktopUaApplied) {
                        desktopUaApplied = true
                        view.stopLoading()
                        view.settings.userAgentString = cleanDesktopUa
                        view.loadUrl(url)
                        return
                    }
                    if (isOpenSpotify) {
                        titleTv.text = "● VERIFICANDO SESIÓN // SPOTIFY…"
                        // Fallback injection if DOCUMENT_START_SCRIPT isn't supported on older WebView
                        view.evaluateJavascript(SPOTIFY_DOCUMENT_START_HOOK_JS, null)
                    }
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null) currentWebUrl.set(url)
                if (!completed && url != null) {
                    if (provider == "spotify" && url.contains("://open.spotify.com", ignoreCase = true)) {
                        titleTv.text = "● VERIFICANDO SESIÓN // SPOTIFY…"
                        view?.evaluateJavascript(SPOTIFY_DOCUMENT_START_HOOK_JS, null)
                        mainHandler.postDelayed({
                            if (!completed) {
                                view?.evaluateJavascript(SPOTIFY_DOM_RESCUE_JS, null)
                                checkSessionAndFinish(manualTap = false, currentUrl = webView.url ?: url)
                            }
                        }, 1800L)
                    } else {
                        checkSessionAndFinish(manualTap = false, currentUrl = url)
                    }
                }
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                if (url != null) currentWebUrl.set(url)
                if (!completed && url != null) {
                    if (provider == "spotify" && url.contains("://open.spotify.com", ignoreCase = true)) {
                        view?.evaluateJavascript(SPOTIFY_DOCUMENT_START_HOOK_JS, null)
                        scheduleSpotifyCheck()
                    } else {
                        checkSessionAndFinish(manualTap = false, currentUrl = url)
                    }
                }
            }
        }

        root.addView(webView)
        setContentView(root)

        val loginUrl = when (provider) {
            "ytmusic" -> "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F"
            "spotify" -> "https://accounts.spotify.com/es/login?continue=https%3A%2F%2Fopen.spotify.com%2F"
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

    private fun verifySpotifyAndComplete(
        cookies: String,
        spDc: String,
        accessTok: String,
        clientTok: String,
        authenticatedUi: Boolean,
        manualTap: Boolean
    ) {
        if (completed) return
        if (!verifyingSpotify.compareAndSet(false, true)) return

        verifyExecutor.execute {
            try {
                val conn = (URL("https://api.spotify.com/v1/me").openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 7500
                    readTimeout = 7500
                    setRequestProperty("Authorization", "Bearer $accessTok")
                    setRequestProperty("User-Agent", cleanDesktopUa)
                    setRequestProperty("Origin", "https://open.spotify.com")
                    setRequestProperty("Referer", "https://open.spotify.com/")
                    setRequestProperty("Accept", "application/json")
                    if (clientTok.isNotBlank()) {
                        setRequestProperty("client-token", clientTok)
                    }
                }
                val code = try {
                    conn.responseCode
                } catch (_: Throwable) {
                    0
                }
                val body = try {
                    if (code in 200..299) {
                        conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    } else null
                } catch (_: Throwable) {
                    null
                } finally {
                    conn.disconnect()
                }

                if (code == 200 && !body.isNullOrBlank()) {
                    val me = runCatching { JSONObject(body) }.getOrNull()
                    val displayName = me?.optString("display_name", "")
                        ?.ifBlank { me.optString("id", "") }
                        ?.ifBlank { scrapedProfileName.get() }
                        ?.ifBlank { "Spotify" } ?: "Spotify"
                    mainHandler.post {
                        verifyingSpotify.set(false)
                        if (!completed) {
                            completeWithSession(cookies, spDc, displayName, accessTok, clientTok)
                        }
                    }
                } else if (code == 403 && spDc.isNotBlank() && authenticatedUi) {
                    // Flexible validation: newer Pathfinder-scoped web tokens return 403 on /v1/me
                    // Keep token + clientToken + scraped DOM/Pathfinder library and finish cleanly!
                    val label = scrapedProfileName.get().ifBlank { "Spotify" }
                    mainHandler.post {
                        verifyingSpotify.set(false)
                        if (!completed) {
                            completeWithSession(cookies, spDc, label, accessTok, clientTok)
                        }
                    }
                } else {
                    if (code == 401) capturedAccessToken.set("")
                    mainHandler.post {
                        verifyingSpotify.set(false)
                        if (manualTap && !completed) {
                            if (spDc.isNotBlank() && authenticatedUi && scrapedLibraryJson.get().isNotBlank()) {
                                val label = scrapedProfileName.get().ifBlank { "Spotify" }
                                completeWithSession(cookies, spDc, label, accessTok, clientTok)
                            } else {
                                Toast.makeText(
                                    this@RyotunesAccountAuthActivity,
                                    "Spotify aún no validó la sesión (HTTP $code). Espera 2s en open.spotify.com y reintenta.",
                                    Toast.LENGTH_LONG
                                ).show()
                            }
                        }
                    }
                }
            } catch (_: Throwable) {
                verifyingSpotify.set(false)
            }
        }
    }

    private fun parseRescueJson(raw: String?): JSONObject {
        if (raw.isNullOrBlank() || raw == "null") return JSONObject()
        val unquoted = if (raw.startsWith("\"") && raw.endsWith("\"")) {
            runCatching { JSONObject("{\"v\":$raw}").optString("v", "") }.getOrDefault("")
        } else {
            raw
        }
        return runCatching { JSONObject(unquoted) }.getOrElse { JSONObject() }
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
                val onAccounts = currentUrl.contains("accounts.spotify.com", ignoreCase = true) ||
                    currentUrl.contains("accounts.google.com", ignoreCase = true)
                val onOpenSpotify = currentUrl.contains("://open.spotify.com", ignoreCase = true)

                if (spDc.isBlank()) {
                    if (manualTap) {
                        Toast.makeText(this, "Completa el acceso a Spotify antes de pulsar LISTO", Toast.LENGTH_SHORT).show()
                    }
                    return
                }

                if (onAccounts || !onOpenSpotify) {
                    if (manualTap) {
                        Toast.makeText(this, "Abriendo open.spotify.com para validar sesión…", Toast.LENGTH_SHORT).show()
                        desktopUaApplied = true
                        webView.settings.userAgentString = cleanDesktopUa
                        webView.loadUrl("https://open.spotify.com/")
                    }
                    return
                }

                // Always inspect DOM for DRM block + scrape visible profile & playlists as live backup
                webView.evaluateJavascript(SPOTIFY_DOM_RESCUE_JS) { raw ->
                    if (completed) return@evaluateJavascript
                    val state = parseRescueJson(raw)
                    val blocked = state.optBoolean("drmBlocked", false)
                    val authUi = state.optBoolean("authenticatedUi", false)
                    val domProfile = state.optString("profileName", "").trim()
                    if (domProfile.isNotBlank()) scrapedProfileName.set(domProfile)

                    if (blocked) {
                        if (manualTap) {
                            Toast.makeText(
                                this,
                                "Spotify mostró 'Reproducción deshabilitada'. Recargando con DRM habilitado…",
                                Toast.LENGTH_LONG
                            ).show()
                            webView.reload()
                        }
                        return@evaluateJavascript
                    }

                    val latestTok = capturedAccessToken.get()
                    val latestClient = capturedClientToken.get()
                    if (latestTok.isNotBlank()) {
                        verifySpotifyAndComplete(cookies, spDc, latestTok, latestClient, authUi, manualTap)
                    } else if (manualTap) {
                        // Plan B: give the nudged session fetch 900ms, then complete cleanly with DOM library + sp_dc
                        Toast.makeText(this, "Sincronizando sesión y biblioteca de Spotify…", Toast.LENGTH_SHORT).show()
                        mainHandler.postDelayed({
                            if (completed) return@postDelayed
                            val (cNow, dcNow) = readSpotifyCookies(CookieManager.getInstance())
                            val tokAfter = capturedAccessToken.get()
                            val ctAfter = capturedClientToken.get()
                            if (tokAfter.isNotBlank()) {
                                verifySpotifyAndComplete(
                                    cNow,
                                    dcNow.ifBlank { spDc },
                                    tokAfter,
                                    ctAfter,
                                    authUi || scrapedLibraryJson.get().isNotBlank(),
                                    true
                                )
                            } else if (authUi || scrapedLibraryJson.get().isNotBlank()) {
                                val label = scrapedProfileName.get().ifBlank { "Spotify" }
                                completeWithSession(cNow, dcNow.ifBlank { spDc }, label, "", ctAfter)
                            } else {
                                Toast.makeText(
                                    this,
                                    "Espera a que cargue tu biblioteca en Spotify Web y vuelve a pulsar LISTO.",
                                    Toast.LENGTH_LONG
                                ).show()
                            }
                        }, 950L)
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
        val scraped = scrapedLibraryJson.get()
        if (scraped.isNotBlank()) {
            RyotunesAccountVault.saveScrapedLibraryJson(this, provider, scraped)
        }
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
        verifyExecutor.shutdownNow()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}
