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
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Bundle
import android.text.TextPaint
import android.text.TextUtils
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Single-Canvas Aspect-Ratio-Locked Nothing OS x Ryoku Purple Home Screen Widget.
 * Reads launcher minWidth/minHeight options dynamically so circles, squares, text,
 * 26x5 LED matrix, wave, and 42-division dial never stretch or deform.
 */
class RyotunesBentoWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val state = readCachedState(context)
        for (appWidgetId in appWidgetIds) {
            updateSingleWidget(context, appWidgetManager, appWidgetId, state, fullBind = true)
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle
    ) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
        val state = readCachedState(context)
        updateSingleWidget(context, appWidgetManager, appWidgetId, state, fullBind = true)
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
            // Safe guard if OS denies background launch without exemption
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

        @Volatile
        private var cachedNdotTypeface: Typeface? = null

        private fun getNdotTypeface(context: Context): Typeface {
            cachedNdotTypeface?.let { return it }
            val loaded = try {
                ResourcesCompat.getFont(context, R.font.ndot57) ?: Typeface.MONOSPACE
            } catch (_: Throwable) {
                Typeface.MONOSPACE
            }
            cachedNdotTypeface = loaded
            return loaded
        }

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
                updateSingleWidget(context, manager, id, state, fullBind = true)
            }
        }

        fun updateLiveSpectrumAndProgress(
            context: Context,
            spectrum: DoubleArray?,
            positionMs: Long,
            durationMs: Long,
            isPlaying: Boolean
        ) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, RyotunesBentoWidgetProvider::class.java))
            if (ids.isEmpty()) return

            val base = readCachedState(context)
            val state = base.copy(
                isPlaying = isPlaying,
                positionSec = (positionMs.coerceAtLeast(0L)) / 1000.0,
                durationSec = if (durationMs > 0L) durationMs / 1000.0 else base.durationSec,
                spectrumBands = spectrum
            )
            for (id in ids) {
                updateSingleWidget(context, manager, id, state, fullBind = false)
            }
        }

        private fun readCachedState(context: Context): WidgetState {
            val p = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return WidgetState(
                title = p.getString("title", "OPEN CTHz") ?: "OPEN CTHz",
                artist = p.getString("artist", "CTHz // HI-FI AUDIO") ?: "CTHz // HI-FI AUDIO",
                isPlaying = p.getBoolean("isPlaying", false),
                positionSec = p.getFloat("position", 0f).toDouble(),
                durationSec = p.getFloat("duration", 0f).toDouble(),
                artworkPath = p.getString("artworkPath", null),
                spectrumBands = null
            )
        }

        private fun updateSingleWidget(
            context: Context,
            manager: AppWidgetManager,
            appWidgetId: Int,
            state: WidgetState,
            fullBind: Boolean
        ) {
            val opts = manager.getAppWidgetOptions(appWidgetId)
            val minW = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 340).coerceAtLeast(180)
            val minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 165).coerceAtLeast(110)
            val aspect = minH.toFloat() / minW.toFloat()

            var pxW = 640
            var pxH = (pxW * aspect).roundToInt().coerceIn(220, 640)
            while (pxW * pxH * 4 > 780_000 && pxW > 320) {
                pxW = (pxW * 0.92f).roundToInt()
                pxH = (pxW * aspect).roundToInt().coerceIn(180, 640)
            }

            val bmp = renderBentoCanvas(context, pxW, pxH, minW.toFloat(), state)
            val views = RemoteViews(context.packageName, R.layout.ryotunes_bento_widget)
            try {
                views.setImageViewBitmap(R.id.widget_canvas_img, bmp)
                if (fullBind) {
                    views.setOnClickPendingIntent(R.id.widget_btn_open, openAppPending(context))
                    views.setOnClickPendingIntent(R.id.widget_btn_prev, broadcastPending(context, 101, RyotunesAudioService.ACTION_PREV))
                    views.setOnClickPendingIntent(R.id.widget_btn_play_pause, broadcastPending(context, 102, RyotunesAudioService.ACTION_TOGGLE_PLAY))
                    views.setOnClickPendingIntent(R.id.widget_btn_next, broadcastPending(context, 103, RyotunesAudioService.ACTION_NEXT))
                    manager.updateAppWidget(appWidgetId, views)
                } else {
                    manager.partiallyUpdateAppWidget(appWidgetId, views)
                }
            } finally {
                bmp.recycle()
            }
        }

        private fun renderBentoCanvas(
            context: Context,
            w: Int,
            h: Int,
            dpW: Float,
            state: WidgetState
        ): Bitmap {
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val ndot = getNdotTypeface(context)
            val pxPerDp = (w / dpW).coerceAtLeast(1.2f)
            val u = (h / 310f).coerceIn(0.65f, 1.35f)
            val wf = w.toFloat()
            val hf = h.toFloat()

            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

            // 1. Subtle obsidian dot-matrix background field
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(38, 192, 132, 252)
            val gridStep = 14f * u
            var gy = 14f * u
            while (gy < hf - 14f * u) {
                var gx = 16f * u
                while (gx < wf - 16f * u) {
                    canvas.drawCircle(gx, gy, 1.15f * u, paint)
                    gx += gridStep
                }
                gy += gridStep
            }

            // 2. Instrument corner registration brackets
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2f * u
            paint.color = Color.argb(200, 168, 85, 247)
            val pad = 12f * u
            val bLen = 11f * u
            // Top-left
            canvas.drawLine(pad, pad, pad + bLen, pad, paint)
            canvas.drawLine(pad, pad, pad, pad + bLen, paint)
            // Top-right
            canvas.drawLine(wf - pad, pad, wf - pad - bLen, pad, paint)
            canvas.drawLine(wf - pad, pad, wf - pad, pad + bLen, paint)
            // Bottom-left
            canvas.drawLine(pad, hf - pad, pad + bLen, hf - pad, paint)
            canvas.drawLine(pad, hf - pad, pad, hf - pad - bLen, paint)
            // Bottom-right
            canvas.drawLine(wf - pad, hf - pad, wf - pad - bLen, hf - pad, paint)
            canvas.drawLine(wf - pad, hf - pad, wf - pad, hf - pad - bLen, paint)

            // 3. Top Header Row
            val contentLeft = 20f * u
            val contentRight = wf - 20f * u
            val headerY = 28f * u

            paint.style = Paint.Style.FILL
            paint.color = if (state.isPlaying) Color.parseColor("#A855F7") else Color.parseColor("#5C4F78")
            canvas.drawCircle(contentLeft + 5f * u, headerY, 4.5f * u, paint)

            val headerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = ndot
                textSize = 15.5f * u
                letterSpacing = 0.08f
                color = if (state.isPlaying) Color.parseColor("#E9D5FF") else Color.parseColor("#9D91B8")
            }
            val headerText = if (state.isPlaying) "PLAYING // CTHz" else "STANDBY // CTHz"
            val hFm = headerPaint.fontMetrics
            canvas.drawText(headerText, contentLeft + 18f * u, headerY - (hFm.ascent + hFm.descent) / 2f, headerPaint)

            // Top-right [ ⊙ CTHz ↗ ] chip
            val chipW = 104f * u
            val chipH = 26f * u
            val chipRect = RectF(contentRight - chipW, headerY - chipH / 2f, contentRight, headerY + chipH / 2f)
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#1F1830")
            canvas.drawRoundRect(chipRect, chipH / 2f, chipH / 2f, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.4f * u
            paint.color = Color.parseColor("#A855F7")
            canvas.drawRoundRect(chipRect, chipH / 2f, chipH / 2f, paint)

            val chipTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = ndot
                textSize = 12.5f * u
                letterSpacing = 0.06f
                color = Color.parseColor("#F3EEFF")
                textAlign = Paint.Align.CENTER
            }
            val cFm = chipTextPaint.fontMetrics
            canvas.drawText("⊙ CTHz ↗", chipRect.centerX(), chipRect.centerY() - (cFm.ascent + cFm.descent) / 2f, chipTextPaint)

            // 4. Center Row: True Square Artwork + Metadata + Wave & 26x5 Dot-Matrix LEDs
            val artSize = hf * 0.40f
            val artTop = 52f * u
            val artRect = RectF(contentLeft, artTop, contentLeft + artSize, artTop + artSize)
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#14101F")
            canvas.drawRoundRect(artRect, 14f * u, 14f * u, paint)

            val artBmp = loadSquareArtwork(state.artworkPath, artSize.roundToInt().coerceAtLeast(64))
            if (artBmp != null) {
                val roundedArt = roundBitmap(artBmp, 14f * u)
                canvas.drawBitmap(roundedArt, artRect.left, artRect.top, paint)
                roundedArt.recycle()
                artBmp.recycle()
            } else {
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2.5f * u
                paint.color = Color.parseColor("#A855F7")
                canvas.drawCircle(artRect.centerX(), artRect.centerY(), artSize * 0.28f, paint)
                canvas.drawCircle(artRect.centerX(), artRect.centerY(), artSize * 0.09f, paint)
            }
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f * u
            paint.color = if (state.isPlaying) Color.parseColor("#A855F7") else Color.parseColor("#382C52")
            canvas.drawRoundRect(artRect, 14f * u, 14f * u, paint)

            val metaLeft = artRect.right + 16f * u
            val metaWidth = (contentRight - metaLeft).coerceAtLeast(80f)

            val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = Typeface.create(ndot, Typeface.BOLD)
                textSize = 21f * u
                color = Color.parseColor("#F3EEFF")
            }
            val safeTitle = TextUtils.ellipsize(state.title.uppercase(), titlePaint, metaWidth, TextUtils.TruncateAt.END).toString()
            canvas.drawText(safeTitle, metaLeft, artTop + 21f * u, titlePaint)

            val artistPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = Typeface.SANS_SERIF
                textSize = 15.5f * u
                color = Color.parseColor("#C084FC")
            }
            val safeArtist = TextUtils.ellipsize(state.artist, artistPaint, metaWidth, TextUtils.TruncateAt.END).toString()
            canvas.drawText(safeArtist, metaLeft, artTop + 44f * u, artistPaint)

            // Wave + 26x5 Dot Matrix right under title/artist
            val vizTop = artTop + 56f * u
            val vizBottom = artRect.bottom
            val vizHeight = (vizBottom - vizTop).coerceAtLeast(32f * u)
            drawSpectrumMatrixAndWave(
                canvas = canvas,
                left = metaLeft,
                top = vizTop,
                width = metaWidth,
                height = vizHeight,
                bands = state.spectrumBands,
                isPlaying = state.isPlaying,
                posSec = state.positionSec,
                u = u
            )

            // 5. 42-Division Instrument Scale
            val scaleY = artRect.bottom + 24f * u
            val progress = if (state.durationSec > 0.0) (state.positionSec / state.durationSec).toFloat().coerceIn(0f, 1f) else 0f
            val scalePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
            val ticks = 42
            val scaleSpan = contentRight - contentLeft
            for (i in 0..ticks) {
                val t = i / ticks.toFloat()
                val tx = contentLeft + t * scaleSpan
                val major = i % 7 == 0
                val mid = i % 3 == 0
                val th = when {
                    major -> 15f * u
                    mid -> 10f * u
                    else -> 5.5f * u
                }
                scalePaint.strokeWidth = (if (major) 2.2f else 1.3f) * u
                scalePaint.color = if (t <= progress) Color.parseColor("#C084FC") else Color.parseColor("#382C52")
                canvas.drawLine(tx, scaleY - th / 2f, tx, scaleY + th / 2f, scalePaint)
            }
            val needleX = contentLeft + scaleSpan * progress
            scalePaint.strokeWidth = 2.8f * u
            scalePaint.color = if (state.isPlaying) Color.parseColor("#F3EEFF") else Color.parseColor("#A855F7")
            canvas.drawLine(needleX, scaleY - 10f * u, needleX, scaleY + 10f * u, scalePaint)

            // 6. Bottom Row: Time Pill bottom-left + Transport Controls bottom-right (matching XML hitboxes)
            val btnBottomPad = 8f * pxPerDp
            val btnRightPad = 12f * pxPerDp
            val btnH = 32f * pxPerDp
            val btnGap = 6f * pxPerDp
            val nextW = 42f * pxPerDp
            val playW = 78f * pxPerDp
            val prevW = 42f * pxPerDp

            val btnBottom = hf - btnBottomPad
            val btnTop = btnBottom - btnH
            val btnCenterY = (btnTop + btnBottom) / 2f

            // Time pill on bottom-left
            val pillH = btnH.coerceAtMost(32f * u)
            val pillRect = RectF(contentLeft, btnCenterY - pillH / 2f, contentLeft + 144f * u, btnCenterY + pillH / 2f)
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#14101F")
            canvas.drawRoundRect(pillRect, 9f * u, 9f * u, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.3f * u
            paint.color = Color.parseColor("#382C52")
            canvas.drawRoundRect(pillRect, 9f * u, 9f * u, paint)

            paint.style = Paint.Style.FILL
            paint.color = if (state.isPlaying) Color.parseColor("#A855F7") else Color.parseColor("#5C4F78")
            canvas.drawCircle(pillRect.left + 14f * u, pillRect.centerY(), 3.6f * u, paint)

            val timePaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = ndot
                textSize = 13.5f * u
                color = Color.parseColor("#C084FC")
            }
            val tFm = timePaint.fontMetrics
            canvas.drawText(
                "${fmtTime(state.positionSec)} / ${fmtTime(state.durationSec)}",
                pillRect.left + 25f * u,
                pillRect.centerY() - (tFm.ascent + tFm.descent) / 2f,
                timePaint
            )

            // Transport buttons aligned to XML layout hitboxes
            val nextLeft = wf - btnRightPad - nextW
            val nextRect = RectF(nextLeft, btnTop, nextLeft + nextW, btnBottom)
            val playLeft = nextLeft - btnGap - playW
            val playRect = RectF(playLeft, btnTop, playLeft + playW, btnBottom)
            val prevLeft = playLeft - btnGap - prevW
            val prevRect = RectF(prevLeft, btnTop, prevLeft + prevW, btnBottom)

            drawTransportButton(canvas, prevRect, isPrimary = false, glyph = "prev", u = u)
            drawTransportButton(canvas, playRect, isPrimary = state.isPlaying, glyph = if (state.isPlaying) "pause" else "play", u = u, ndot = ndot)
            drawTransportButton(canvas, nextRect, isPrimary = false, glyph = "next", u = u)

            return bmp
        }

        private fun drawSpectrumMatrixAndWave(
            canvas: Canvas,
            left: Float,
            top: Float,
            width: Float,
            height: Float,
            bands: DoubleArray?,
            isPlaying: Boolean,
            posSec: Double,
            u: Float
        ) {
            if (isPlaying && bands != null && bands.isNotEmpty()) {
                val path = Path()
                path.moveTo(left, top + height)
                val steps = 32
                for (i in 0..steps) {
                    val x = left + (i.toFloat() / steps) * width
                    val norm = sampleBandInterpolated(bands, i, steps + 1)
                    val mod = 0.65 + 0.35 * sin(i * 0.48 + posSec * 6.0)
                    val amp = (norm * mod).toFloat().coerceIn(0f, 1f)
                    val y = top + height - amp * height * 0.62f
                    path.lineTo(x, y)
                }
                path.lineTo(left + width, top + height)
                path.close()
                val wp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    style = Paint.Style.FILL
                    color = Color.argb(60, 168, 85, 247)
                }
                canvas.drawPath(path, wp)
            }

            val cols = 26
            val rows = 5
            val gap = 2.4f * u
            val cellW = (width - gap * (cols - 1)) / cols.toFloat()
            val cellH = (height - gap * (rows - 1)) / rows.toFloat()
            val ledPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

            for (c in 0 until cols) {
                val litRows = if (isPlaying && bands != null && bands.isNotEmpty()) {
                    val norm = sampleBandInterpolated(bands, c, cols)
                    val scaled = (norm.pow(0.76) * rows).roundToInt()
                    if (norm > 0.015) scaled.coerceIn(1, rows) else 0
                } else {
                    0
                }
                for (r in 0 until rows) {
                    val fromBottom = rows - 1 - r
                    val x = left + c * (cellW + gap)
                    val y = top + r * (cellH + gap)
                    ledPaint.color = if (fromBottom < litRows) {
                        when {
                            fromBottom == rows - 1 -> Color.parseColor("#F3EEFF")
                            fromBottom >= rows - 2 -> Color.parseColor("#C084FC")
                            else -> Color.parseColor("#A855F7")
                        }
                    } else {
                        Color.parseColor("#222228")
                    }
                    canvas.drawRoundRect(x, y, x + cellW, y + cellH, 1.5f * u, 1.5f * u, ledPaint)
                }
            }
        }

        private fun drawTransportButton(
            canvas: Canvas,
            rect: RectF,
            isPrimary: Boolean,
            glyph: String,
            u: Float,
            ndot: Typeface? = null
        ) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            val radius = if (glyph == "play" || glyph == "pause") rect.height() / 2f else 9f * u
            paint.style = Paint.Style.FILL
            paint.color = when {
                isPrimary -> Color.parseColor("#A855F7")
                glyph == "play" || glyph == "pause" -> Color.parseColor("#1F1830")
                else -> Color.parseColor("#1F1830")
            }
            canvas.drawRoundRect(rect, radius, radius, paint)

            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.3f * u
            paint.color = if (glyph == "play" || glyph == "pause") Color.parseColor("#A855F7") else Color.parseColor("#382C52")
            canvas.drawRoundRect(rect, radius, radius, paint)

            val cx = rect.centerX()
            val cy = rect.centerY()
            paint.style = Paint.Style.FILL
            paint.color = if (isPrimary) Color.WHITE else Color.parseColor("#F3EEFF")

            when (glyph) {
                "prev" -> {
                    val barW = 2.6f * u
                    val hHalf = 7f * u
                    canvas.drawRect(cx - 7.5f * u, cy - hHalf, cx - 7.5f * u + barW, cy + hHalf, paint)
                    val path = Path().apply {
                        moveTo(cx - 3.5f * u, cy)
                        lineTo(cx + 7.5f * u, cy - hHalf)
                        lineTo(cx + 7.5f * u, cy + hHalf)
                        close()
                    }
                    canvas.drawPath(path, paint)
                }
                "next" -> {
                    val barW = 2.6f * u
                    val hHalf = 7f * u
                    val path = Path().apply {
                        moveTo(cx + 3.5f * u, cy)
                        lineTo(cx - 7.5f * u, cy - hHalf)
                        lineTo(cx - 7.5f * u, cy + hHalf)
                        close()
                    }
                    canvas.drawPath(path, paint)
                    canvas.drawRect(cx + 5f * u, cy - hHalf, cx + 5f * u + barW, cy + hHalf, paint)
                }
                "pause" -> {
                    val leftGx = cx - 28f * u
                    val hHalf = 6.2f * u
                    canvas.drawRect(leftGx - 5f * u, cy - hHalf, leftGx - 1.5f * u, cy + hHalf, paint)
                    canvas.drawRect(leftGx + 1.5f * u, cy - hHalf, leftGx + 5f * u, cy + hHalf, paint)
                    val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                        typeface = ndot ?: Typeface.MONOSPACE
                        textSize = 13.5f * u
                        color = Color.WHITE
                    }
                    val fm = tp.fontMetrics
                    canvas.drawText("PAUSE", leftGx + 11f * u, cy - (fm.ascent + fm.descent) / 2f, tp)
                }
                "play" -> {
                    val leftGx = cx - 22f * u
                    val hHalf = 6.5f * u
                    val path = Path().apply {
                        moveTo(leftGx - 4.5f * u, cy - hHalf)
                        lineTo(leftGx + 5.5f * u, cy)
                        lineTo(leftGx - 4.5f * u, cy + hHalf)
                        close()
                    }
                    canvas.drawPath(path, paint)
                    val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                        typeface = ndot ?: Typeface.MONOSPACE
                        textSize = 13.5f * u
                        color = Color.parseColor("#F3EEFF")
                    }
                    val fm = tp.fontMetrics
                    canvas.drawText("PLAY", leftGx + 11f * u, cy - (fm.ascent + fm.descent) / 2f, tp)
                }
            }
        }

        private fun sampleBandInterpolated(bands: DoubleArray, targetCol: Int, totalCols: Int): Double {
            if (bands.isEmpty()) return 0.0
            if (bands.size == 1 || totalCols <= 1) {
                val v = bands[0]
                return if (v.isFinite()) (v / 1000.0).coerceIn(0.0, 1.0) else 0.0
            }
            val pos = ((targetCol.toDouble() / (totalCols - 1)) * (bands.size - 1)).coerceIn(0.0, (bands.size - 1).toDouble())
            val lo = floor(pos).toInt().coerceIn(0, bands.lastIndex)
            val hi = ceil(pos).toInt().coerceIn(lo, bands.lastIndex)
            val frac = pos - lo
            val vLo = if (bands[lo].isFinite()) (bands[lo] / 1000.0).coerceIn(0.0, 1.0) else 0.0
            val vHi = if (bands[hi].isFinite()) (bands[hi] / 1000.0).coerceIn(0.0, 1.0) else 0.0
            return vLo * (1.0 - frac) + vHi * frac
        }

        private fun loadSquareArtwork(path: String?, size: Int): Bitmap? {
            if (path.isNullOrBlank()) return null
            return try {
                val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(path, opts)
                val maxDim = maxOf(opts.outWidth, opts.outHeight)
                val sample = if (maxDim > size * 2) maxOf(1, maxDim / size) else 1
                val decOpts = BitmapFactory.Options().apply { inSampleSize = sample }
                val raw = BitmapFactory.decodeFile(path, decOpts) ?: return null
                val scaled = Bitmap.createScaledBitmap(raw, size, size, true)
                if (scaled !== raw) raw.recycle()
                scaled
            } catch (_: Throwable) {
                null
            }
        }

        private fun roundBitmap(src: Bitmap, radius: Float): Bitmap {
            val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(out)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            val rect = Rect(0, 0, src.width, src.height)
            canvas.drawRoundRect(RectF(rect), radius, radius, paint)
            paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
            canvas.drawBitmap(src, rect, rect, paint)
            return out
        }

        private fun fmtTime(secs: Double): String {
            if (!secs.isFinite() || secs <= 0.0) return "0:00"
            val s = secs.toInt()
            return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
        }

        private fun openAppPending(context: Context): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            return PendingIntent.getActivity(
                context,
                99,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun broadcastPending(context: Context, reqCode: Int, action: String): PendingIntent {
            val intent = Intent(context, RyotunesBentoWidgetProvider::class.java).setAction(action)
            return PendingIntent.getBroadcast(
                context,
                reqCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
