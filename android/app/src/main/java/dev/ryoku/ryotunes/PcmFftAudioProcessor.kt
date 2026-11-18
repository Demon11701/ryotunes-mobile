@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package dev.ryoku.ryotunes

import android.os.SystemClock
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
 * Zero-distortion pass-through PCM-16 AudioProcessor computing a gapless 1024-pt Hann FFT
 * across 40 logarithmic bands (40 Hz - 14 kHz) with burst-gap continuity hold & spatial filter.
 */
internal class PcmFftAudioProcessor(
    private val onBands: (DoubleArray) -> Unit
) : BaseAudioProcessor() {

    companion object {
        private const val FFT_N = 1024
        private const val FFT_BITS = 10
        private const val BANDS = 40
        private const val EMIT_INTERVAL_MS = 28L
    }

    @Volatile
    var activeCapture: Boolean = false

    @Volatile
    var lastBufferRealtimeMs: Long = 0L
        private set

    private val bandLock = Any()

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

    private var avgBassEnergy = 0.0
    private var avgMidEnergy = 0.0
    private var modPhase = 0.0
    private var lastEmitRealtimeMs = 0L

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        return if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) {
            inputAudioFormat
        } else {
            AudioProcessor.AudioFormat.NOT_SET
        }
    }

    fun getLatestBands(isPlaying: Boolean): DoubleArray {
        synchronized(bandLock) {
            if (!isPlaying) {
                smoothed.fill(0.0)
                avgBassEnergy = 0.0
                avgMidEnergy = 0.0
                return DoubleArray(BANDS) { 0.0 }
            }
            val now = SystemClock.elapsedRealtime()
            val sinceBuf = now - lastBufferRealtimeMs
            if (lastBufferRealtimeMs > 0L && sinceBuf in 42L..349L) {
                modPhase += 0.36
                val hasEnergy = avgBassEnergy > 0.02 || avgMidEnergy > 0.02
                val floorVal = if (hasEnergy) 18.0 + (avgBassEnergy + avgMidEnergy) * 28.0 else 0.0
                for (i in 0 until BANDS) {
                    val decayed = smoothed[i] * 0.92
                    val mod = 1.0 + 0.05 * sin(modPhase + i * 0.34) * min(1.0, avgBassEnergy + avgMidEnergy)
                    val next = (decayed * mod).coerceIn(0.0, 1000.0)
                    smoothed[i] = if (hasEnergy && next < floorVal) floorVal else next
                }
            }
            return smoothed.copyOf()
        }
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (activeCapture) {
            try {
                val dup = inputBuffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
                val ch = inputAudioFormat.channelCount.coerceAtLeast(1)
                var ingested = false
                if (ch == 1) {
                    while (dup.remaining() >= 2) {
                        ring[ringPos] = dup.short.toFloat() / 32768f
                        ringPos = (ringPos + 1) and (FFT_N - 1)
                        if (ringFilled < FFT_N) ringFilled++
                        ingested = true
                    }
                } else if (ch == 2) {
                    while (dup.remaining() >= 4) {
                        val left = dup.short.toFloat()
                        val right = dup.short.toFloat()
                        ring[ringPos] = ((left + right) * 0.5f) / 32768f
                        ringPos = (ringPos + 1) and (FFT_N - 1)
                        if (ringFilled < FFT_N) ringFilled++
                        ingested = true
                    }
                } else {
                    val frameBytes = ch * 2
                    while (dup.remaining() >= frameBytes) {
                        var sum = 0f
                        for (c in 0 until ch) sum += dup.short.toFloat()
                        ring[ringPos] = (sum / ch) / 32768f
                        ringPos = (ringPos + 1) and (FFT_N - 1)
                        if (ringFilled < FFT_N) ringFilled++
                        ingested = true
                    }
                }

                val now = SystemClock.elapsedRealtime()
                if (ingested) {
                    lastBufferRealtimeMs = now
                }
                if (ringFilled >= 256 && now - lastEmitRealtimeMs >= EMIT_INTERVAL_MS) {
                    computeSpectrum(inputAudioFormat.sampleRate.coerceAtLeast(22050))
                    lastEmitRealtimeMs = now
                }
            } catch (_: Throwable) {
                // Keep output audio pure on unexpected slice
            }
        }

        val rem = inputBuffer.remaining()
        if (rem > 0) {
            replaceOutputBuffer(rem).put(inputBuffer).flip()
        }
    }

    override fun onFlush() {
        lastEmitRealtimeMs = 0L
        ring.fill(0f)
        ringPos = 0
        ringFilled = 0
    }

    override fun onReset() {
        lastEmitRealtimeMs = 0L
        lastBufferRealtimeMs = 0L
        ring.fill(0f)
        ringPos = 0
        ringFilled = 0
        synchronized(bandLock) {
            smoothed.fill(0.0)
            avgBassEnergy = 0.0
            avgMidEnergy = 0.0
        }
    }

    private fun computeSpectrum(sampleRate: Int) {
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

        var peakRaw = 0.0
        var bassSum = 0.0
        var midSum = 0.0

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

            val energy = lerped * 0.52 + windowPeak * 0.48
            val freqWeight = 1.0 + (i / (BANDS - 1).toDouble()) * 1.55
            val compressed = (energy * 4.4 * freqWeight).coerceAtLeast(0.0).pow(0.65)
            val bandVal = (compressed * 430.0).coerceIn(0.0, 1000.0)
            rawBands[i] = bandVal
            if (bandVal > peakRaw) peakRaw = bandVal
            if (i < 8) bassSum += bandVal
            else if (i < 24) midSum += bandVal
        }

        val hasMusicSignal = peakRaw > 14.0
        val out = synchronized(bandLock) {
            avgBassEnergy = (bassSum / (8.0 * 1000.0)).coerceIn(0.0, 1.0)
            avgMidEnergy = (midSum / (16.0 * 1000.0)).coerceIn(0.0, 1.0)
            val floorActive = if (hasMusicSignal) 18.0 + (avgBassEnergy + avgMidEnergy) * 24.0 else 0.0

            val res = DoubleArray(BANDS)
            for (i in 0 until BANDS) {
                val prev = rawBands[max(0, i - 1)]
                val curr = rawBands[i]
                val nextBand = rawBands[min(BANDS - 1, i + 1)]
                val spatial = 0.25 * prev + 0.50 * curr + 0.25 * nextBand

                val next = if (spatial >= smoothed[i]) {
                    smoothed[i] * 0.18 + spatial * 0.82
                } else {
                    smoothed[i] * 0.78 + spatial * 0.22
                }
                val floored = if (hasMusicSignal && next < floorActive) floorActive else next
                smoothed[i] = if (floored < 4.0) 0.0 else floored.coerceIn(0.0, 1000.0)
                res[i] = smoothed[i]
            }
            res
        }

        onBands(out)
    }
}
