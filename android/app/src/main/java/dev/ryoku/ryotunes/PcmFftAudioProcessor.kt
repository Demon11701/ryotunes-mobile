@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package dev.ryoku.ryotunes

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Zero-distortion pass-through PCM-16 AudioProcessor with a 1024-sample stereo-to-mono
 * circular ring buffer, 1024-pt Hann-windowed Radix-2 FFT, fractional bin interpolation,
 * and spatial continuity filtering across 40 logarithmic bands (40 Hz - 14 kHz).
 */
internal class PcmFftAudioProcessor(
    private val onBands: (DoubleArray) -> Unit
) : BaseAudioProcessor() {

    companion object {
        private const val FFT_N = 1024
        private const val FFT_BITS = 10
        private const val BANDS = 40
        private const val EMIT_INTERVAL_MS = 33L
    }

    @Volatile
    var activeCapture: Boolean = false

    private val hann = DoubleArray(FFT_N) { i ->
        0.5 * (1.0 - cos((2.0 * PI * i) / (FFT_N - 1)))
    }
    private val bitRev = IntArray(FFT_N).apply {
        for (i in 0 until FFT_N) {
            var r = 0
            var x = i
            for (b in 0 until FFT_BITS) {
                r = (r shl 1) or (x and 1)
                x = x ushr 1
            }
            this[i] = r
        }
    }

    private val ring = FloatArray(FFT_N)
    private var ringPos = 0
    private var ringFilled = 0

    private val mags = DoubleArray(FFT_N / 2)
    private val rawBands = DoubleArray(BANDS)
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
            try {
                val dup = inputBuffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
                val ch = inputAudioFormat.channelCount.coerceAtLeast(1)
                if (ch == 1) {
                    while (dup.remaining() >= 2) {
                        val s = dup.short.toFloat() / 32768f
                        ring[ringPos] = s
                        ringPos = (ringPos + 1) and (FFT_N - 1)
                        if (ringFilled < FFT_N) ringFilled++
                    }
                } else if (ch == 2) {
                    while (dup.remaining() >= 4) {
                        val left = dup.short.toFloat()
                        val right = dup.short.toFloat()
                        ring[ringPos] = ((left + right) * 0.5f) / 32768f
                        ringPos = (ringPos + 1) and (FFT_N - 1)
                        if (ringFilled < FFT_N) ringFilled++
                    }
                } else {
                    val frameBytes = ch * 2
                    while (dup.remaining() >= frameBytes) {
                        var sum = 0f
                        for (c in 0 until ch) {
                            sum += dup.short.toFloat()
                        }
                        ring[ringPos] = (sum / ch) / 32768f
                        ringPos = (ringPos + 1) and (FFT_N - 1)
                        if (ringFilled < FFT_N) ringFilled++
                    }
                }

                val now = System.currentTimeMillis()
                if (ringFilled >= 256 && now - lastEmitMs >= EMIT_INTERVAL_MS) {
                    emitSpectrum(inputAudioFormat.sampleRate.coerceAtLeast(22050))
                    lastEmitMs = now
                }
            } catch (_: Throwable) {
                // Keep playback untouched if an unexpected buffer slice arrives
            }
        }

        val rem = inputBuffer.remaining()
        if (rem > 0) {
            replaceOutputBuffer(rem).put(inputBuffer).flip()
        }
    }

    override fun onFlush() {
        lastEmitMs = 0L
        ring.fill(0f)
        ringPos = 0
        ringFilled = 0
    }

    override fun onReset() {
        lastEmitMs = 0L
        ring.fill(0f)
        ringPos = 0
        ringFilled = 0
        smoothed.fill(0.0)
    }

    private fun emitSpectrum(sampleRate: Int) {
        val startOffset = ringPos
        for (i in 0 until FFT_N) {
            val sample = ring[(startOffset + i) and (FFT_N - 1)].toDouble()
            val j = bitRev[i]
            real[j] = sample * hann[i]
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

        val normScale = FFT_N * 0.25
        val nyquistBin = (FFT_N / 2) - 1
        for (k in 0..nyquistBin) {
            mags[k] = hypot(real[k], imag[k]) / normScale
        }

        val nyquist = sampleRate / 2.0
        val minHz = 40.0
        val maxHz = min(14000.0, nyquist * 0.92).coerceAtLeast(1000.0)
        val ratio = maxHz / minHz

        for (i in 0 until BANDS) {
            val fc = minHz * ratio.pow(i / (BANDS - 1).toDouble())
            val fLow = minHz * ratio.pow((i - 0.5).coerceAtLeast(0.0) / (BANDS - 1).toDouble())
            val fHigh = minHz * ratio.pow((i + 0.5).coerceAtMost((BANDS - 1).toDouble()) / (BANDS - 1).toDouble())

            val exactBin = ((fc * FFT_N) / sampleRate).coerceIn(1.0, (nyquistBin - 1).toDouble())
            val binLow = floor(exactBin).toInt().coerceIn(1, nyquistBin - 1)
            val binHigh = ceil(exactBin).toInt().coerceIn(binLow, nyquistBin)
            val frac = exactBin - binLow
            val lerped = mags[binLow] * (1.0 - frac) + mags[binHigh] * frac

            val spanLow = floor((fLow * FFT_N) / sampleRate).toInt().coerceIn(1, nyquistBin - 1)
            val spanHigh = ceil((fHigh * FFT_N) / sampleRate).toInt().coerceIn(spanLow, nyquistBin)
            var windowPeak = lerped
            for (k in spanLow..spanHigh) {
                if (mags[k] > windowPeak) windowPeak = mags[k]
            }

            val energy = lerped * 0.55 + windowPeak * 0.45
            val freqWeight = 1.0 + (i / (BANDS - 1).toDouble()) * 1.55
            val compressed = (energy * 4.2 * freqWeight).coerceAtLeast(0.0).pow(0.65)
            rawBands[i] = (compressed * 420.0).coerceIn(0.0, 1000.0)
        }

        val out = DoubleArray(BANDS)
        for (i in 0 until BANDS) {
            val left = rawBands[max(0, i - 1)]
            val center = rawBands[i]
            val right = rawBands[min(BANDS - 1, i + 1)]
            val spatial = 0.22 * left + 0.56 * center + 0.22 * right

            val next = if (spatial >= smoothed[i]) {
                smoothed[i] * 0.18 + spatial * 0.82
            } else {
                smoothed[i] * 0.72 + spatial * 0.28
            }
            smoothed[i] = if (next < 5.0) 0.0 else next
            out[i] = smoothed[i]
        }

        onBands(out)
    }
}
