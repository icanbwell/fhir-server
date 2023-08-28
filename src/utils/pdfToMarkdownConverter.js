class PdfToMarkdownConverter {
    /**
     * convert pdf to markdown
     * @param pdfBuffer
     * @return {Promise<string>}
     */
    async convertPdfToMarkdownAsync({pdfBuffer}) {
        const pdf2md = require('@opendocsg/pdf2md');
        // noinspection ES6RedundantAwait
        const markdown = await pdf2md(pdfBuffer);
        return markdown;
    }
}

module.exports = {
    PdfToMarkdownConverter
};
