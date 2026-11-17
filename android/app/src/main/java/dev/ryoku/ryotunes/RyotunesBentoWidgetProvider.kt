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
 * Hybrid Vector + High-DPI Micro-Bitmap Android Home Widget (Nothing OS x Ryoku Purple).
 * - Uses crisp vector shapes/icons in XML (ImageView + ImageButton only; zero View/TextView/@font).
 * - Full updates refresh header, 256px artwork, Ndot57 metadata, and play/pause vector icon.
 * - Live ticks use AppWidgetManager.partiallyUpdateAppWidget with 3 light micro-bitmaps (<150 KB total)
 *   to animate the 26x5 FFT dot matrix + ambient wave + 42-tick dial + time capsule smoothly.
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
                updateSingleWidget(context, manager, id, state)
            }
        }

        /**
         * Regenerates ONLY the 3 lightweight micro-bitmaps (~142 KB combined) and pushes via
         * partiallyUpdateAppWidget so artwork, buttons, and card frame never flicker.
         */
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

            val ndot = getNdotTypeface(context)
            val posSec = (positionMs.coerceAtLeast(0L)) / 1000.0
            val durSec = if (durationMs > 0L) durationMs / 1000.0 else 0.0
            val progress = if (durSec > 0.0) (posSec / durSec).toFloat().coerceIn(0f, 1f) else 0f

            val specBmp = renderSpectrumBitmap(spectrum, isPlaying, posSec)
            val scaleBmp = renderScaleBitmap(progress, isPlaying)
            val timeBmp = renderTimeBitmap(ndot, posSec, durSec, isPlaying)

            try {
                val views = RemoteViews(context.packageName, R.layout.ryotunes_bento_widget)
                views.setImageViewBitmap(R.id.widget_spectrum_bmp, specBmp)
                views.setImageViewBitmap(R.id.widget_scale_bmp, scaleBmp)
                views.setImageViewBitmap(R.id.widget_time_bmp, timeBmp)
                manager.partiallyUpdateAppWidget(ids, views)
            } finally {
                specBmp.recycle()
                scaleBmp.recycle()
                timeBmp.recycle()
            }
        }

        private fun readCachedState(context: Context): WidgetState {
            val p = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return WidgetState(
                title = p.getString("title", "OPEN RYOTUNES") ?: "OPEN RYOTUNES",
                artist = p.getString("artist", "NOTHING × RYOKU PURPLE") ?: "NOTHING × RYOKU PURPLE",
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
            state: WidgetState
        ) {
            val views = RemoteViews(context.packageName, R.layout.ryotunes_bento_widget)
            val ndot = getNdotTypeface(context)
            val progress = if (state.durationSec > 0.0) (state.positionSec / state.durationSec).toFloat().coerceIn(0f, 1f) else 0f

            val headerBmp = renderHeaderBitmap(ndot, state.isPlaying)
            val chipBmp = renderChipBitmap(ndot)
            val artBmp = loadRoundedArtwork256(state.artworkPath)
            val metaBmp = renderMetaBitmap(ndot, state.title, state.artist)
            val specBmp = renderSpectrumBitmap(state.spectrumBands, state.isPlaying, state.positionSec)
            val scaleBmp = renderScaleBitmap(progress, state.isPlaying)
            val timeBmp = renderTimeBitmap(ndot, state.positionSec, state.durationSec, state.isPlaying)

            try {
                views.setImageViewBitmap(R.id.widget_header_bmp, headerBmp)
                views.setImageViewBitmap(R.id.widget_btn_open, chipBmp)
                if (artBmp != null) {
                    views.setImageViewBitmap(R.id.widget_art_img, artBmp)
                } else {
                    views.setImageViewResource(R.id.widget_art_img, R.drawable.ic_ryo_album)
                }
                views.setImageViewBitmap(R.id.widget_meta_bmp, metaBmp)
                views.setImageViewBitmap(R.id.widget_spectrum_bmp, specBmp)
                views.setImageViewBitmap(R.id.widget_scale_bmp, scaleBmp)
                views.setImageViewBitmap(R.id.widget_time_bmp, timeBmp)
                views.setImageViewResource(
                    R.id.widget_btn_play_pause,
                    if (state.isPlaying) R.drawable.ic_ryo_pause else R.drawable.ic_ryo_play
                )

                val openPending = openAppPending(context)
                views.setOnClickPendingIntent(R.id.widget_btn_open, openPending)
                views.setOnClickPendingIntent(R.id.widget_art_img, openPending)
                views.setOnClickPendingIntent(R.id.widget_meta_bmp, openPending)
                views.setOnClickPendingIntent(R.id.widget_btn_prev, broadcastPending(context, 101, RyotunesAudioService.ACTION_PREV))
                views.setOnClickPendingIntent(R.id.widget_btn_play_pause, broadcastPending(context, 102, RyotunesAudioService.ACTION_TOGGLE_PLAY))
                views.setOnClickPendingIntent(R.id.widget_btn_next, broadcastPending(context, 103, RyotunesAudioService.ACTION_NEXT))

                manager.updateAppWidget(appWidgetId, views)
            } finally {
                headerBmp.recycle()
                chipBmp.recycle()
                artBmp?.recycle()
                metaBmp.recycle()
                specBmp.recycle()
                scaleBmp.recycle()
                timeBmp.recycle()
            }
        }

        private fun renderHeaderBitmap(ndot: Typeface, isPlaying: Boolean): Bitmap {
            val w = 360
            val h = 40
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

            paint.style = Paint.Style.FILL
            paint.color = if (isPlaying) Color.parseColor("#A855F7") else Color.parseColor("#6B5F88")
            canvas.drawCircle(12f, h / 2f, 6f, paint)

            val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = ndot
                textSize = 22f
                letterSpacing = 0.08f
                color = if (isPlaying) Color.parseColor("#E9D5FF") else Color.parseColor("#9A8EB8")
            }
            val label = if (isPlaying) "PLAYING // RYOTUNES" else "STANDBY // RYOTUNES"
            val fm = textPaint.fontMetrics
            val baseline = h / 2f - (fm.ascent + fm.descent) / 2f
            canvas.drawText(label, 28f, baseline, textPaint)
            return bmp
        }

        private fun renderChipBitmap(ndot: Typeface): Bitmap {
            val w = 224
            val h = 48
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = ndot
                textSize = 19f
                letterSpacing = 0.06f
                color = Color.parseColor("#E9D5FF")
                textAlign = Paint.Align.CENTER
            }
            val fm = textPaint.fontMetrics
            val baseline = h / 2f - (fm.ascent + fm.descent) / 2f
            canvas.drawText("⊙ RYOTUNES ↗", w / 2f, baseline, textPaint)
            return bmp
        }

        private fun renderMetaBitmap(ndot: Typeface, rawTitle: String, rawArtist: String): Bitmap {
            val w = 520
            val h = 72
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)

            val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = Typeface.create(ndot, Typeface.BOLD)
                textSize = 28f
                color = Color.parseColor("#F3EEFF")
            }
            val safeTitle = TextUtils.ellipsize(rawTitle.uppercase(), titlePaint, w - 4f, TextUtils.TruncateAt.END).toString()
            canvas.drawText(safeTitle, 0f, 30f, titlePaint)

            val artistPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = Typeface.SANS_SERIF
                textSize = 21f
                color = Color.parseColor("#C084FC")
            }
            val safeArtist = TextUtils.ellipsize(rawArtist, artistPaint, w - 4f, TextUtils.TruncateAt.END).toString()
            canvas.drawText(safeArtist, 0f, 60f, artistPaint)
            return bmp
        }

        private fun sampleBandInterpolated(bands: DoubleArray?, targetCol: Int, totalCols: Int): Double {
            if (bands == null || bands.isEmpty()) return 0.0
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

        private fun renderSpectrumBitmap(bands: DoubleArray?, isPlaying: Boolean, posSec: Double): Bitmap {
            // 320 x 60 px ARGB_8888 = ~76.8 KB
            val w = 320
            val h = 60
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)

            // Ambient purple wave layer along bottom driven by FFT bands
            if (isPlaying && bands != null && bands.isNotEmpty()) {
                val wavePath = Path()
                wavePath.moveTo(0f, h.toFloat())
                val steps = 36
                for (i in 0..steps) {
                    val x = (i.toFloat() / steps) * w
                    val norm = sampleBandInterpolated(bands, i, steps + 1)
                    val carrier = 0.6 + 0.4 * sin(i * 0.45 + posSec * 6.0)
                    val amp = (norm * carrier).toFloat().coerceIn(0f, 1f)
                    val y = h - (amp * h * 0.65f)
                    wavePath.lineTo(x, y)
                }
                wavePath.lineTo(w.toFloat(), h.toFloat())
                wavePath.close()
                val wavePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    style = Paint.Style.FILL
                    color = Color.argb(56, 168, 85, 247)
                }
                canvas.drawPath(wavePath, wavePaint)
            }

            // 26 x 5 LED matrix
            val cols = 26
            val rows = 5
            val gapX = 3f
            val gapY = 3f
            val cellW = (w - gapX * (cols - 1)) / cols.toFloat()
            val cellH = (h - gapY * (rows - 1)) / rows.toFloat()
            val ledPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

            for (c in 0 until cols) {
                val litRows = if (isPlaying && bands != null && bands.isNotEmpty()) {
                    val norm = sampleBandInterpolated(bands, c, cols)
                    val scaled = (norm.pow(0.78) * rows).roundToInt()
                    if (norm > 0.015) scaled.coerceIn(1, rows) else 0
                } else {
                    0
                }
                for (r in 0 until rows) {
                    val fromBottom = rows - 1 - r
                    val x = c * (cellW + gapX)
                    val y = r * (cellH + gapY)
                    ledPaint.color = if (fromBottom < litRows) {
                        when {
                            fromBottom == rows - 1 -> Color.parseColor("#F3EEFF")
                            fromBottom >= rows - 2 -> Color.parseColor("#C084FC")
                            else -> Color.parseColor("#A855F7")
                        }
                    } else {
                        Color.parseColor("#222228")
                    }
                    canvas.drawRoundRect(x, y, x + cellW, y + cellH, 1.5f, 1.5f, ledPaint)
                }
            }
            return bmp
        }

        private fun renderScaleBitmap(progress: Float, isPlaying: Boolean): Bitmap {
            // 440 x 24 px ARGB_8888 = ~42.2 KB
            val w = 440
            val h = 24
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }

            val padX = 6f
            val spanW = w - padX * 2f
            val ticks = 42
            for (i in 0..ticks) {
                val t = i / ticks.toFloat()
                val tx = padX + t * spanW
                val major = i % 7 == 0
                val mid = i % 3 == 0
                val tickH = when {
                    major -> 16f
                    mid -> 11f
                    else -> 6f
                }
                tickPaint.strokeWidth = if (major) 2.2f else 1.4f
                tickPaint.color = if (t <= progress) Color.parseColor("#C084FC") else Color.parseColor("#382C52")
                canvas.drawLine(tx, (h - tickH) / 2f, tx, (h + tickH) / 2f, tickPaint)
            }

            val headX = padX + spanW * progress
            tickPaint.strokeWidth = 3f
            tickPaint.color = if (isPlaying) Color.parseColor("#F3EEFF") else Color.parseColor("#A855F7")
            canvas.drawLine(headX, 2f, headX, h - 2f, tickPaint)
            return bmp
        }

        private fun renderTimeBitmap(ndot: Typeface, posSec: Double, durSec: Double, isPlaying: Boolean): Bitmap {
            // 180 x 32 px ARGB_8888 = ~23.0 KB
            val w = 180
            val h = 32
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#14101F")
            val rect = RectF(1f, 1f, w - 1f, h - 1f)
            canvas.drawRoundRect(rect, 9f, 9f, paint)

            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f
            paint.color = Color.parseColor("#382C52")
            canvas.drawRoundRect(rect, 9f, 9f, paint)

            paint.style = Paint.Style.FILL
            paint.color = if (isPlaying) Color.parseColor("#A855F7") else Color.parseColor("#6B5F88")
            canvas.drawCircle(16f, h / 2f, 4f, paint)

            val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
                typeface = ndot
                textSize = 16f
                color = Color.parseColor("#C084FC")
            }
            val label = "${fmtTime(posSec)} / ${fmtTime(durSec)}"
            val fm = textPaint.fontMetrics
            val baseline = h / 2f - (fm.ascent + fm.descent) / 2f
            canvas.drawText(label, 28f, baseline, textPaint)
            return bmp
        }

        private fun loadRoundedArtwork256(path: String?): Bitmap? {
            if (path.isNullOrBlank()) return null
            return try {
                val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(path, opts)
                val maxDim = maxOf(opts.outWidth, opts.outHeight)
                val sample = if (maxDim > 512) maxOf(1, maxDim / 256) else 1
                val decOpts = BitmapFactory.Options().apply { inSampleSize = sample }
                val raw = BitmapFactory.decodeFile(path, decOpts) ?: return null
                val size = 256
                val scaled = Bitmap.createScaledBitmap(raw, size, size, true)
                if (scaled !== raw) raw.recycle()

                val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(output)
                val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                val rect = Rect(0, 0, size, size)
                val rectF = RectF(0f, 0f, size.toFloat(), size.toFloat())
                canvas.drawRoundRect(rectF, 24f, 24f, paint)
                paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
                canvas.drawBitmap(scaled, rect, rect, paint)
                scaled.recycle()
                output
            } catch (_: Throwable) {
                null
            }
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
