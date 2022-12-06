class HttpResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     */
    constructor(
        {
            response
        }
    ) {
        /**
         * @type {import('express').Response}
         */
        this.response = response;
    }

    /**
     * Starts response
     * @param {string|undefined} title
     * @param {string|undefined} html
     * @return {Promise<void>}
     */
    async startAsync({title, html}) {
        const contentType = 'text/html; charset=UTF-8';
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('Transfer-Encoding', 'chunked');

        const header =
            '<!DOCTYPE html>' +
            '<html lang="en">' +
            '<head>' +
            '<meta charset="utf-8">' +
            `<title>${title}</title>` +
            '</head>' +
            '<body>';

        this.response.write(header);

        if (html) {
            this.response.write(html);
        }
    }

    /**
     * writes to response
     * @param {string} html
     * @return {Promise<void>}
     */
    async writeAsync({html}) {
        if (html) {
            this.response.write(html);
        }
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        // since this is the last chunk, close the stream.
        const html =
            '</body>' +
            '</html';

        this.response.end(html);
    }
}

module.exports = {
    HttpResponseStreamer
};
