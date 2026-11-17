@file:OptIn(androidx.media3.common.util.UnstableApi::class)
package dev.ryoku.ryotunes

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import kotlin.math.min

/**
 * Shared Media3 DataSource wrapper that automatically splits googlevideo.com streams
 * into bounded 512KB HTTP Range chunks (preventing HTTP 403 from YouTube's iOS client
 * and preserving Range headers across CDN 302 redirects), while passing other URLs straight through.
 */
@OptIn(UnstableApi::class)
internal class ChunkedGoogleVideoDataSource(
    private val upstream: HttpDataSource
) : DataSource {

    companion object {
        private const val CHUNK_SIZE = 512L * 1024L
    }

    private var isChunkedMode = false
    private var upstreamOpened = false
    private var rootSpec: DataSpec? = null
    private var openedUri: Uri? = null
    private var curPos = 0L
    private var requestedRemaining = -1L
    private var totalKnownLen = -1L
    private var chunkRemaining = 0L

    override fun addTransferListener(transferListener: TransferListener) {
        upstream.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        rootSpec = dataSpec
        openedUri = dataSpec.uri
        val isIosFallbackStream =
            dataSpec.uri.host?.contains("googlevideo.com", ignoreCase = true) == true &&
                dataSpec.uri.getQueryParameter("c").equals("IOS", ignoreCase = true)
        isChunkedMode = isIosFallbackStream
        if (!isChunkedMode) {
            val len = upstream.open(dataSpec)
            upstreamOpened = true
            return len
        }

        val startPos = dataSpec.position.coerceAtLeast(0L)
        curPos = startPos
        requestedRemaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else -1L
        totalKnownLen = dataSpec.uri.getQueryParameter("clen")?.toLongOrNull() ?: -1L
        chunkRemaining = 0L

        if (!openNextChunk()) {
            return 0L
        }

        return when {
            requestedRemaining >= 0L && totalKnownLen > 0L ->
                min(requestedRemaining, (totalKnownLen - startPos).coerceAtLeast(0L))
            requestedRemaining >= 0L -> requestedRemaining
            totalKnownLen > 0L -> (totalKnownLen - startPos).coerceAtLeast(0L)
            else -> C.LENGTH_UNSET.toLong()
        }
    }

    private fun openNextChunk(): Boolean {
        closeUpstreamSafe()
        val spec = rootSpec ?: return false
        if (requestedRemaining == 0L) return false
        if (totalKnownLen > 0L && curPos >= totalKnownLen) return false

        val byReq = if (requestedRemaining > 0L) min(CHUNK_SIZE, requestedRemaining) else CHUNK_SIZE
        val byTotal = if (totalKnownLen > 0L) (totalKnownLen - curPos) else byReq
        val chunkLen = min(byReq, byTotal)
        if (chunkLen <= 0L) return false

        val subSpec = spec.buildUpon()
            .setPosition(curPos)
            .setLength(chunkLen)
            .build()

        return try {
            val opened = upstream.open(subSpec)
            upstreamOpened = true
            if (totalKnownLen <= 0L) {
                val cr = upstream.responseHeaders["Content-Range"]?.firstOrNull()
                    ?: upstream.responseHeaders["content-range"]?.firstOrNull()
                val parsedTotal = cr?.substringAfter('/', "")?.toLongOrNull()
                if (parsedTotal != null && parsedTotal > 0L) {
                    totalKnownLen = parsedTotal
                }
            }
            chunkRemaining = if (opened != C.LENGTH_UNSET.toLong() && opened >= 0L) opened else chunkLen
            chunkRemaining > 0L
        } catch (e: HttpDataSource.InvalidResponseCodeException) {
            upstreamOpened = false
            if (e.responseCode == 416) {
                false
            } else {
                throw e
            }
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (!isChunkedMode) {
            return upstream.read(buffer, offset, length)
        }
        if (length == 0) return 0

        while (true) {
            if (requestedRemaining == 0L || (totalKnownLen > 0L && curPos >= totalKnownLen)) {
                return C.RESULT_END_OF_INPUT
            }
            if (!upstreamOpened || chunkRemaining <= 0L) {
                if (!openNextChunk()) {
                    return C.RESULT_END_OF_INPUT
                }
            }

            val toRead = min(length.toLong(), chunkRemaining).toInt().coerceAtLeast(1)
            val n = upstream.read(buffer, offset, toRead)
            if (n == C.RESULT_END_OF_INPUT) {
                chunkRemaining = 0L
                closeUpstreamSafe()
                if (totalKnownLen > 0L && curPos >= totalKnownLen) {
                    return C.RESULT_END_OF_INPUT
                }
                continue
            }
            if (n > 0) {
                curPos += n
                chunkRemaining -= n
                if (requestedRemaining > 0L) {
                    requestedRemaining -= n
                }
                return n
            }
            return n
        }
    }

    override fun getUri(): Uri? = if (isChunkedMode) openedUri else upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        openedUri = null
        rootSpec = null
        closeUpstreamSafe()
    }

    private fun closeUpstreamSafe() {
        if (upstreamOpened) {
            try {
                upstream.close()
            } finally {
                upstreamOpened = false
            }
        }
    }
}
