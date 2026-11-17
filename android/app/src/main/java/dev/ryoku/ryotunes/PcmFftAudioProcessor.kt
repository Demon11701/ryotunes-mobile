@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package dev.ryoku.ryotunes

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Zero-distortion pass-through PCM-16 AudioProcessor computing a real 512-point Hann-windowed FFT
 * across 40 logarithmic frequency bands (45Hz - 15kHz) at ~30fps.
 */
internal class PcmFftAudioProcessor(
    private val onBands: (DoubleArray) -> Unit
) : BaseAudioProcessor() {

    companion object {
        private const val FFT_N = 512
        private const val BANDS = 40
        private const val EMIT_INTERVAL_MS = 33L
    }

    @Volatile
    var activeCapture: Boolean = false

    private val hann = DoubleArray(FFT_N) { i ->
        0.5 * (1.0 - cos((2.0 * PI * i) / (FFT_N - 1)))
    }
    private val bitRev = IntArray(FFT_N).apply {
        val bits = 9
        for (i in 0 until FFT_N) {
            var r = 0
            var x = i
            for (b in 0 until bits) {
                r = (r shl 1) or (x and 1)
                x = x ushr 1
            }
            this[i] = r
        }
    }

    private val samples = DoubleArray(FFT_N)
    private val real = DoubleArray(FFT_N)
    private val imag = DoubleArray(FFT_N)
    private val smoothed = DoubleArray(BANDS)
    private var lastEmitMs = 0L

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        return if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
            inputAudioFormat
        } else {
            AudioProcessor.AudioFormat.NOT_SET
        }
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (activeCapture) {
            val now = System.currentTimeMillis()
            if (now - lastEmitMs >= EMIT_INTERVAL_MS) {
                try {
                    val dup = inputBuffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
                    val ch = inputAudioFormat.channelCount.coerceAtLeast(1)
                    var idx = 0
                    if (ch == 1) {
                        while (dup.remaining() >= 2 && idx < FFT_N) {
                            samples[idx++] = dup.short / 32768.0
                        }
                    } else {
                        val frameBytes = ch * 2
                        while (dup.remaining() >= frameBytes && idx < FFT_N) {
                            var sum = 0.0
                            for (c in 0 until ch) {
                                sum += dup.short
                            }
                            samples[idx++] = (sum / ch) / 32768.0
                        }
                    }
                    if (idx >= 64) {
                        while (idx < FFT_N) samples[idx++] = 0.0
                        emitSpectrum(inputAudioFormat.sampleRate.coerceAtLeast(22050))
                        lastEmitMs = now
                    }
                } catch (_: Throwable) {
                    // Preserve audio output even if FFT read encounters unexpected slice
                }
            }
        }

        val rem = inputBuffer.remaining()
        if (rem > 0) {
            replaceOutputBuffer(rem).put(inputBuffer).flip()
        }
    }

    override fun onFlush() {
        lastEmitMs = 0L
    }

    override fun onReset() {
        lastEmitMs = 0L
        smoothed.fill(0.0)
    }

    private fun emitSpectrum(sampleRate: Int) {
        for (i in 0 until FFT_N) {
            val j = bitRev[i]
            real[j] = samples[i] * hann[i]
            imag[j] = 0.0
        }

        var size = 2
        while (size <= FFT_N) {
            val half = size ushr 1
            val angle = -2.0 * PI / size
            val wStepRe = cos(angle)
            val wStepIm = sin(angle)
            var start = 0
            while (start < FFT_N) {
                var wRe = 1.0
                var wIm = 0.0
                for (k in 0 until half) {
                    val evenIdx = start + k
                    val oddIdx = evenIdx + half
                    val tRe = wRe * real[oddIdx] - wIm * imag[oddIdx]
                    val tIm = wRe * imag[oddIdx] + wIm * real[oddIdx]
                    real[oddIdx] = real[evenIdx] - tRe
                    imag[oddIdx] = imag[evenIdx] - tIm
                    real[evenIdx] += tRe
                    imag[evenIdx] += tIm
                    val nextWRe = wRe * wStepRe - wIm * wStepIm
                    wIm = wRe * wStepIm + wIm * wStepRe
                    wRe = nextWRe
                }
                start += size
            }
            size = size shl 1
        }

        val nyquist = sampleRate / 2.0
        val minHz = 45.0
        val maxHz = min(15000.0, nyquist * 0.92).coerceAtLeast(1000.0)
        val out = DoubleArray(BANDS)

        for (b in 0 until BANDS) {
            val f0 = minHz * (maxHz / minHz).pow(b.toDouble() / BANDS)
            val f1 = minHz * (maxHz / minHz).pow((b + 1).toDouble() / BANDS)
            val bin0 = ((f0 * FFT_N) / sampleRate).toInt().coerceIn(1, (FFT_N / 2) - 2)
            val bin1 = max(bin0 + 1, ((f1 * FFT_N) / sampleRate).toInt()).coerceIn(bin0 + 1, FFT_N / 2 - 1)

            var peak = 0.0
            for (k in bin0..bin1) {
                val mag = hypot(real[k], imag[k]) / (FFT_N * 0.25)
                if (mag > peak) peak = mag
            }
            // Pre-emphasis weight slightly lifts mids/highs while keeping bass reactive
            val freqWeight = 1.0 + (b / BANDS.toDouble()) * 1.45
            val dbScaled = (ln(1.0 + peak * 18.0 * freqWeight) * 340.0).coerceIn(0.0, 1000.0)
            val next = if (dbScaled >= smoothed[b]) {
                smoothed[b] * 0.25 + dbScaled * 0.75
            } else {
                smoothed[b] * 0.58 + dbScaled * 0.42
            }
            smoothed[b] = if (next < 6.0) 0.0 else next
            out[b] = smoothed[b]
        }

        onBands(out)
    }
}
