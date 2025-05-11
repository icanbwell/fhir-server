const {Readable} = require('stream');
const {fhirContentTypes} = require("./contentTypes");

class BufferToChunkTransferResponse {
    /**
     * Converts a buffer to a chunked transfer stream.
     * @param {ServerResponse} response
     * @param {Buffer} buffer
     * @param {number} chunkSize
     * @returns {void}
     */
    sendLargeFileChunked({response, buffer, chunkSize = 64 * 1024}) {
        // Create a readable stream from the buffer
        /**
         * @type {module:stream.Stream.Readable | module:stream.internal.Readable}
         */
        const readableStream = new Readable({
            read() {
                // If buffer is not empty, push chunks
                if (buffer.length > 0) {
                    const chunk = buffer.subarray(0, Math.min(chunkSize, buffer.length));
                    this.push(chunk);
                    buffer = buffer.subarray(chunk.length);
                }

                // Signal end of stream when buffer is exhausted
                if (buffer.length === 0) {
                    this.push(null);
                }
            }
        });

        response.setHeader('Transfer-Encoding', 'chunked');

        // Pipe the stream to response
        readableStream.pipe(response);

        // Handle potential errors
        readableStream.on('error', (err) => {
            console.error('Stream error:', err);
            response.statusCode = 500;
            response.end('Error streaming file');
        });
        readableStream.on('end', () => {
            response.end();
        });
        readableStream.on('close', () => {
        });
        readableStream.on('finish', () => {
        });
    }
}

module.exports = {
    BufferToChunkTransferResponse
};
