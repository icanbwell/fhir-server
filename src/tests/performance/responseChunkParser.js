class ResponseChunkParser {
    /**
     * Parser that reads chunks as they are received from server
     */
    getFhirBundleParser() {
        return (req, callback) => {
            req.text = '';
            let text = '';
            req.setEncoding('utf8');
            let chunkNumber = 0;
            req.on('data', (chunk) => {
                req.text += chunk;
                text += chunk;
                chunkNumber++;
                console.log(`FhirBundleParser received chunk ${chunkNumber} of length ${chunk.length}`);
            });
            req.on('end', () => {
                // Process the response data here
                callback(null, JSON.parse(text));
            });
        };
    }

    /**
     * Parser that reads chunks as they are received from server
     */
    getTextParser() {
        return (req, callback) => {
            req.text = '';
            let text = '';
            req.setEncoding('utf8');
            let chunkNumber = 0;
            let totalLineCount = 0;
            req.on('data', (chunk) => {
                req.text += chunk;
                text += chunk;
                const lines = chunk.split('\n'); // Handles all types of line endings
                const lineCount = lines.length;
                totalLineCount += lineCount;
                chunkNumber++;
                console.log(`TextParser received chunk ${chunkNumber} with ${lineCount} lines. ` +
                    `Total lines: ${totalLineCount}, Total length: ${chunk.length}`);
            });
            req.on('end', () => {
                // Process the response data here
                callback(null, text);
            });
        };
    }

}

module.exports = {
    ResponseChunkParser
};
