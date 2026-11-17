package dev.ryoku.ryotunes

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import kotlin.math.pow

/**
 * Nothing OS x Ryoku Purple Home Screen Widget (Canvas 560x280dp-safe Bitmap Renderer).
 * Uses strictly ImageView + ImageButton in RemoteViews layout to avoid InflateException
 * on @font or View tags and stays cleanly under the 1MB Binder transaction limit (~612 KB).
 */
class RyotunesBentoWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val state = readCachedState(context)
        for (appWidgetId in appWidgetIds) {
            updateSingleWidget(context, appWidgetManager, appWidgetId, state)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val cmd = when (intent.action) {
            RyotunesAudioService.ACTION_PREV,
            RyotunesAudioService.ACTION_TOGGLE_PLAY,
            RyotunesAudioService.ACTION_NEXT -> intent.action
            ACTION_WIDGET_COMMAND -> intent.getStringExtra(EXTRA_CMD)
            else -> null
        } ?: return

        val svcIntent = Intent(context, RyotunesAudioService::class.java).setAction(cmd)
        try {
            ContextCompat.startForegroundService(context, svcIntent)
        } catch (_: Exception) {
            // Safe guard if OS denies background launch without exemptions
        }
    }

    data class WidgetState(
        val title: String = "OPEN RYOTUNES",
        val artist: String = "NOTHING × RYOKU PURPLE",
        val isPlaying: Boolean = false,
        val positionSec: Double = 0.0,
        val durationSec: Double = 0.0,
        val artworkPath: String? = null,
        val spectrumBands: DoubleArray? = null
    )

    companion object {
        const val ACTION_WIDGET_COMMAND = "dev.ryoku.ryotunes.WIDGET_ACTION"
        const val EXTRA_CMD = "widget_cmd"
        private const val PREFS_NAME = "ryotunes_widget_state"
        private const val CANVAS_W = 560
        private const val CANVAS_H = 280

        fun saveAndUpdateAll(context: Context, state: WidgetState) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
                putString("title", state.title)
                putString("artist", state.artist)
                putBoolean("isPlaying", state.isPlaying)
                putFloat("position", state.positionSec.toFloat())
                putFloat("duration", state.durationSec.toFloat())
                putString("artworkPath", state.artworkPath)
                apply()
            }
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, RyotunesBentoWidgetProvider::class.java))
            if (ids.isEmpty()) return
            for (id in ids) {
                updateSingleWidget(context, manager, id, state)
            }
        }

        private fun readCachedState(context: Context): WidgetState {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return WidgetState(
                title = prefs.getString("title", "OPEN RYOTUNES") ?: "OPEN RYOTUNES",
                artist = prefs.getString("artist", "NOTHING × RYOKU PURPLE") ?: "NOTHING × RYOKU PURPLE",
                isPlaying = prefs.getBoolean("isPlaying", false),
                positionSec = prefs.getFloat("position", 0f).toDouble(),
                durationSec = prefs.getFloat("duration", 0f).toDouble(),
                artworkPath = prefs.getString("artworkPath", null),
                spectrumBands = null
            )
        }

        private fun updateSingleWidget(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            state: WidgetState
        ) {
            val views = RemoteViews(context.packageName, R.layout.ryotunes_bento_widget)
            val canvasBmp = renderBentoBitmap(context, state)
            views.setImageViewBitmap(R.id.widget_canvas_img, canvasBmp)

            val launchIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val openPending = PendingIntent.getActivity(
                context,
                100,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_btn_open, openPending)
            views.setOnClickPendingIntent(R.id.widget_btn_open_left, openPending)

            views.setOnClickPendingIntent(
                R.id.widget_btn_prev,
                broadcastPendingIntent(context, 201, RyotunesAudioService.ACTION_PREV)
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_play_pause,
                broadcastPendingIntent(context, 202, RyotunesAudioService.ACTION_TOGGLE_PLAY)
            )
            views.setOnClickPendingIntent(
                R.id.widget_btn_next,
                broadcastPendingIntent(context, 203, RyotunesAudioService.ACTION_NEXT)
            )

            manager.updateAppWidget(widgetId, views)
        }

        private fun broadcastPendingIntent(context: Context, reqCode: Int, actionCmd: String): PendingIntent {
            val intent = Intent(context, RyotunesBentoWidgetProvider::class.java).setAction(actionCmd)
            return PendingIntent.getBroadcast(
                context,
                reqCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun renderBentoBitmap(context: Context, state: WidgetState): Bitmap {
            val w = CANVAS_W
            val h = CANVAS_H
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)

            val ndot: Typeface = try {
                ResourcesCompat.getFont(context, R.font.ndot57) ?: Typeface.MONOSPACE
            } catch (_: Throwable) {
                Typeface.MONOSPACE
            }

            val purple = Color.parseColor("#A855F7")
            val lavender = Color.parseColor("#C084FC")
            val obsidian = Color.parseColor("#0B0910")
            val surface = Color.parseColor("#14101F")
            val elevated = Color.parseColor("#1F1830")
            val borderDim = Color.parseColor("#382C52")
            val inkWhite = Color.parseColor("#F3EEFF")
            val inkMuted = Color.parseColor("#9D91B8")
            val scaleInk = Color.parseColor("#847A9E")
            val ledIdle = Color.parseColor("#4A3E66")
            val ledUnlit = Color.parseColor("#222228")

            // 1. Rounded obsidian card background + subtle radial purple glow + border
            val cardRect = RectF(2f, 2f, w - 2f, h - 2f)
            val radius = 24f
            val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = obsidian
                style = Paint.Style.FILL
            }
            canvas.drawRoundRect(cardRect, radius, radius, bgPaint)

            val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = RadialGradient(
                    w * 0.72f,
                    h * 0.16f,
                    w * 0.55f,
                    Color.argb(if (state.isPlaying) 64 else 32, 168, 85, 247),
                    Color.TRANSPARENT,
                    Shader.TileMode.CLAMP
                )
            }
            canvas.save()
            val clipPath = Path().apply { addRoundRect(cardRect, radius, radius, Path.Direction.CW) }
            canvas.clipPath(clipPath)
            canvas.drawRect(cardRect, glowPaint)

            // 2. Dot-Matrix 14px grid
            val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(38, 192, 132, 252)
                style = Paint.Style.FILL
            }
            var gx = 16f
            while (gx < w - 12f) {
                var gy = 14f
                while (gy < h - 12f) {
                    canvas.drawCircle(gx, gy, 1.35f, dotPaint)
                    gy += 14f
                }
                gx += 14f
            }
            canvas.restore()

            val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (state.isPlaying) purple else borderDim
                style = Paint.Style.STROKE
                strokeWidth = 2.2f
            }
            canvas.drawRoundRect(cardRect, radius, radius, borderPaint)

            // 3. InstrumentBrackets (┌ top-left & ┘ bottom-right)
            val bracketPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(225, 168, 85, 247)
                style = Paint.Style.FILL
            }
            val bInset = 10f
            val bLen = 14f
            val bWt = 2.5f
            canvas.drawRect(bInset, bInset, bInset + bLen, bInset + bWt, bracketPaint)
            canvas.drawRect(bInset, bInset, bInset + bWt, bInset + bLen, bracketPaint)
            canvas.drawRect(w - bInset - bLen, h - bInset - bWt, w - bInset, h - bInset, bracketPaint)
            canvas.drawRect(w - bInset - bWt, h - bInset - bLen, w - bInset, h - bInset, bracketPaint)

            // 4. Top header: status LED + label + [ ⊙ RYOTUNES ↗ ] chip
            val ledPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (state.isPlaying) purple else ledIdle
                style = Paint.Style.FILL
            }
            canvas.drawCircle(28f, 26f, 4.5f, ledPaint)

            val headerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = ndot
                textSize = 12.5f
                color = if (state.isPlaying) lavender else inkMuted
                letterSpacing = 0.06f
            }
            val headerTxt = if (state.isPlaying) "PLAYING // RYOTUNES" else "STANDBY // RYOTUNES"
            canvas.drawText(headerTxt, 40f, 30.5f, headerPaint)

            val chipRect = RectF(418f, 15f, 538f, 38f)
            canvas.drawRoundRect(chipRect, 11.5f, 11.5f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = elevated })
            canvas.drawRoundRect(chipRect, 11.5f, 11.5f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = purple
                style = Paint.Style.STROKE
                strokeWidth = 1.4f
            })
            val chipPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = ndot
                textSize = 10.5f
                color = inkWhite
                textAlign = Paint.Align.CENTER
            }
            canvas.drawText("RYOTUNES ↗", chipRect.centerX(), 30f, chipPaint)

            // 5. Artwork 96x96
            val artRect = RectF(22f, 50f, 118f, 146f)
            val artBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = surface }
            canvas.drawRoundRect(artRect, 14f, 14f, artBoxPaint)

            val artBmp = loadRoundedArtwork(state.artworkPath, 96, 14f)
            if (artBmp != null) {
                canvas.drawBitmap(artBmp, artRect.left, artRect.top, null)
                artBmp.recycle()
            } else {
                val discPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = purple
                    style = Paint.Style.STROKE
                    strokeWidth = 2f
                }
                canvas.drawCircle(artRect.centerX(), artRect.centerY(), 24f, discPaint)
                canvas.drawCircle(artRect.centerX(), artRect.centerY(), 6f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = lavender })
            }
            canvas.drawRoundRect(artRect, 14f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (state.isPlaying) purple else borderDim
                style = Paint.Style.STROKE
                strokeWidth = 1.5f
            })

            // 6. Title & Artist + 26x5 LED Dot Matrix Spectrum
            val textX = 134f
            val maxTextW = (w - 22f) - textX

            val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = ndot
                textSize = 19f
                color = inkWhite
            }
            val safeTitle = TextUtils.ellipsize(state.title.uppercase(), titlePaint, maxTextW, TextUtils.TruncateAt.END).toString()
            canvas.drawText(safeTitle, textX, 68f, titlePaint)

            val artistPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = ndot
                textSize = 12.5f
                color = lavender
            }
            val safeArtist = TextUtils.ellipsize(state.artist.uppercase(), artistPaint, maxTextW, TextUtils.TruncateAt.END).toString()
            canvas.drawText(safeArtist, textX, 88f, artistPaint)

            // 26x5 LED Dot Matrix inside [134..538, 102..146]
            val cols = 26
            val rows = 5
            val gridLeft = 134f
            val gridTop = 102f
            val gridW = 404f
            val gridH = 44f
            val cellW = gridW / cols
            val cellH = gridH / rows
            val dotR = 2.6f
            val bands = state.spectrumBands

            val ledMatrixPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
            for (c in 0 until cols) {
                val litRows = if (state.isPlaying && bands != null && bands.isNotEmpty()) {
                    val idx = ((c * bands.size) / cols).coerceIn(0, bands.lastIndex)
                    val norm = (bands[idx] / 1000.0).coerceIn(0.0, 1.0)
                    (norm.pow(0.75) * rows).toInt().coerceIn(0, rows)
                } else {
                    0
                }
                for (r in 0 until rows) {
                    val fromBottom = rows - 1 - r
                    ledMatrixPaint.color = when {
                        fromBottom == litRows && litRows > 0 -> purple
                        fromBottom < litRows && fromBottom >= rows - 2 -> purple
                        fromBottom < litRows -> inkWhite
                        else -> ledUnlit
                    }
                    ledMatrixPaint.alpha = if (fromBottom <= litRows && litRows > 0) 240 else 135
                    val cx = gridLeft + c * cellW + cellW / 2f
                    val cy = gridTop + r * cellH + cellH / 2f
                    canvas.drawCircle(cx, cy, dotR, ledMatrixPaint)
                }
            }

            // 7. 42-division InstrumentScale bar across y=166..190
            val scaleLeft = 22f
            val scaleW = 516f
            val scaleBottom = 190f
            val scaleH = 22f
            val divisions = 42
            val divPitch = scaleW / divisions
            val tickW = (divPitch * 0.42f).coerceAtLeast(2.2f)
            val fraction = if (state.durationSec > 0) (state.positionSec / state.durationSec).coerceIn(0.0, 1.0) else 0.0

            val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
            for (i in 0 until divisions) {
                val major = i % 6 == 0
                val filled = (i + 0.5) / divisions <= fraction
                val th = if (major) scaleH else scaleH * 0.68f
                val tl = scaleLeft + i * divPitch + (divPitch - tickW) / 2f
                tickPaint.color = when {
                    filled -> purple
                    major -> Color.argb(128, Color.red(scaleInk), Color.green(scaleInk), Color.blue(scaleInk))
                    else -> Color.argb(64, Color.red(scaleInk), Color.green(scaleInk), Color.blue(scaleInk))
                }
                canvas.drawRect(tl, scaleBottom - th, tl + tickW, scaleBottom, tickPaint)
            }

            // 8. Bottom Row: Time Pill + [⏮] [▶/⏸] [⏭]
            val timeRect = RectF(22f, 210f, 188f, 252f)
            canvas.drawRoundRect(timeRect, 10f, 10f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = surface })
            canvas.drawRoundRect(timeRect, 10f, 10f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = borderDim
                style = Paint.Style.STROKE
                strokeWidth = 1.4f
            })
            canvas.drawCircle(36f, timeRect.centerY(), 3.2f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = lavender })

            val clockStr = "${RyoFormat.formatClock(state.positionSec)} / ${RyoFormat.formatClock(state.durationSec)}"
            val timePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                typeface = ndot
                textSize = 14f
                color = inkWhite
            }
            canvas.drawText(clockStr, 46f, timeRect.centerY() + 5f, timePaint)

            // Right transport pill buttons aligned to 3x56dp touch regions
            val btnPrev = RectF(292f, 208f, 366f, 254f)
            val btnPlay = RectF(376f, 208f, 456f, 254f)
            val btnNext = RectF(466f, 208f, 540f, 254f)

            drawTransportBox(canvas, btnPrev, elevated, borderDim)
            drawSkipGlyph(canvas, btnPrev.centerX(), btnPrev.centerY(), inkWhite, forward = false)

            drawTransportBox(
                canvas,
                btnPlay,
                if (state.isPlaying) purple else elevated,
                purple
            )
            if (state.isPlaying) {
                drawPauseGlyph(canvas, btnPlay.centerX(), btnPlay.centerY(), Color.WHITE)
            } else {
                drawPlayGlyph(canvas, btnPlay.centerX(), btnPlay.centerY(), inkWhite)
            }

            drawTransportBox(canvas, btnNext, elevated, borderDim)
            drawSkipGlyph(canvas, btnNext.centerX(), btnNext.centerY(), inkWhite, forward = true)

            return bmp
        }

        private fun drawTransportBox(canvas: Canvas, rect: RectF, fillColor: Int, strokeColor: Int) {
            canvas.drawRoundRect(rect, 14f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fillColor })
            canvas.drawRoundRect(rect, 14f, 14f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = strokeColor
                style = Paint.Style.STROKE
                strokeWidth = 1.6f
            })
        }

        private fun drawSkipGlyph(canvas: Canvas, cx: Float, cy: Float, color: Int, forward: Boolean) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = color
                style = Paint.Style.FILL
            }
            val dir = if (forward) 1f else -1f
            // Vertical bar
            val barLeft = if (forward) cx + 6f else cx - 9f
            canvas.drawRoundRect(RectF(barLeft, cy - 8f, barLeft + 3f, cy + 8f), 1.5f, 1.5f, paint)
            // Triangle pointing toward bar
            val tri = Path().apply {
                moveTo(cx + dir * 5f, cy)
                lineTo(cx - dir * 8f, cy - 8f)
                lineTo(cx - dir * 8f, cy + 8f)
                close()
            }
            canvas.drawPath(tri, paint)
        }

        private fun drawPlayGlyph(canvas: Canvas, cx: Float, cy: Float, color: Int) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = color
                style = Paint.Style.FILL
            }
            val tri = Path().apply {
                moveTo(cx + 8f, cy)
                lineTo(cx - 6f, cy - 9f)
                lineTo(cx - 6f, cy + 9f)
                close()
            }
            canvas.drawPath(tri, paint)
        }

        private fun drawPauseGlyph(canvas: Canvas, cx: Float, cy: Float, color: Int) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = color
                style = Paint.Style.FILL
            }
            canvas.drawRoundRect(RectF(cx - 7f, cy - 8.5f, cx - 2f, cy + 8.5f), 1.5f, 1.5f, paint)
            canvas.drawRoundRect(RectF(cx + 2f, cy - 8.5f, cx + 7f, cy + 8.5f), 1.5f, 1.5f, paint)
        }

        private fun loadRoundedArtwork(path: String?, sizePx: Int, radiusPx: Float): Bitmap? {
            if (path.isNullOrEmpty()) return null
            return try {
                val src = BitmapFactory.decodeFile(path) ?: return null
                val scaled = Bitmap.createScaledBitmap(src, sizePx, sizePx, true)
                if (scaled !== src) src.recycle()
                val out = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(out)
                val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                val rect = Rect(0, 0, sizePx, sizePx)
                canvas.drawARGB(0, 0, 0, 0)
                canvas.drawRoundRect(RectF(rect), radiusPx, radiusPx, paint)
                paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
                canvas.drawBitmap(scaled, rect, rect, paint)
                scaled.recycle()
                out
            } catch (_: Exception) {
                null
            }
        }
    }
}
