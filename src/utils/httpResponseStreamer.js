const {BaseResponseStreamer} = require('./baseResponseStreamer');

class HttpResponseStreamer extends BaseResponseStreamer {
    /**
     * constructor
     * @param {import('express').Response} response
     * @param {string} requestId
     * @param {string|undefined} [title]
     * @param {string|undefined} [html]
     * @param {function(BundleEntry): string|null} fnGetHtmlForBundleEntry
     */
    constructor(
        {
            response,
            requestId,
            title,
            html,
            fnGetHtmlForBundleEntry
        }
    ) {
        super({
            response, requestId
        });
        this.title = title;
        this.html = html;

        /**
         * @type {function(BundleEntry): string|null}
         */
        this.fnGetHtmlForBundleEntry = fnGetHtmlForBundleEntry;
    }

    /**
     * Starts response
     * @return {Promise<void>}
     */
    async startAsync() {
        const contentType = 'text/html; charset=UTF-8';
        this.response.setHeader('Content-Type', contentType);
        this.response.setHeader('Transfer-Encoding', 'chunked');

        const header =
            '<!DOCTYPE html>\n' +
            '<html lang="en">\n' +
            '<head>\n' +
            '<meta charset="utf-8">\n' +
            `<title>${this.title || ''}</title>\n` +
            '</head>\n' +
            '<body>\n';

        this.response.write(header);

        if (this.html) {
            this.response.write(this.html);
        }
    }

    /**
     * writes to response
     * @param {BundleEntry} bundleEntry
     * @return {Promise<void>}
     */
    async writeBundleEntryAsync({bundleEntry}) {
        if (this.fnGetHtmlForBundleEntry) {
            const html = this.fnGetHtmlForBundleEntry(bundleEntry);
            if (html) {
                this.response.write(html);
            }
        }
    }

    async writeAsync({content}) {
        this.response.write(content);
    }

    /**
     * ends response
     * @return {Promise<void>}
     */
    async endAsync() {
        // since this is the last chunk, close the stream.
        const html =
            '</body>\n' +
            '</html>';

        this.response.end(html);
    }
}

module.exports = {
    HttpResponseStreamer
};
