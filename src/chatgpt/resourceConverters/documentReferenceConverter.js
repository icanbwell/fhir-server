const {BaseConverter} = require('./baseConverter');
const {assertTypeEquals} = require('../../utils/assertType');
const {MongoDatabaseManager} = require('../../utils/mongoDatabaseManager');
const {DatabaseAttachmentManager} = require('../../dataLayer/databaseAttachmentManager');
const {PdfToMarkdownConverter} = require('../../utils/pdfToMarkdownConverter');

class DocumentReferenceConverter extends BaseConverter {
    /**
     * constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {PdfToMarkdownConverter} pdfToMarkdownConverter
     */
    constructor(
        {
            mongoDatabaseManager,
            databaseAttachmentManager,
            pdfToMarkdownConverter
        }
    ) {
        super();

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {PdfToMarkdownConverter}
         */
        this.pdfToMarkdownConverter = pdfToMarkdownConverter;
        assertTypeEquals(pdfToMarkdownConverter, PdfToMarkdownConverter);
    }

    /**
     * converts a FHIR resource to summary text
     * @param {Resource} resource
     * @returns {Promise<string>}
     */
    async convertAsync({resource}) {
        const documentReference = /** @type {DocumentReference} */ resource;
        const {
            id,
            meta: {lastUpdated, source},
            identifier,
            /** @type {DocumentReferenceContent[]} */ content,
            resourceType
        } = documentReference;
        const contentBlocks = [];
        if (content && content.length > 0) {
            for (const /** @type {DocumentReferenceContent} */ contentItem of content) {
                /**
                 * @type {Attachment}
                 */
                let attachment = contentItem.attachment;
                if (attachment && attachment._file_id) {
                    const gridFSBucket = await this.mongoDatabaseManager.getGridFsBucket();
                    attachment = /** @type {Element} */ await this.databaseAttachmentManager.convertFileIdToData(attachment, gridFSBucket);
                }
                if (attachment && attachment.data) {
                    switch (attachment.contentType) {
                        case 'application/pdf':
                            contentBlocks.push(await this.pdfToMarkdownConverter.convertPdfToMarkdownAsync({pdfBuffer: Buffer.from(attachment.data, 'base64')}));
                            break;
                        case 'text/plain':
                            contentBlocks.push(Buffer.from(attachment.data, 'base64').toString('utf8'));
                            break;
                    }
                }
            }
        }

        let textArray = [
            '# ResourceType',
            `${resourceType}`,
            `## ${resourceType} ID`,
            `${id}`
        ];

        // https://github.github.com/gfm/

        textArray = textArray.concat(
            this.getDate({title: 'Last Updated', date: lastUpdated})
        );

        textArray = textArray.concat(
            this.getIdentifiers({title: 'Identifiers', identifier})
        );

        textArray = textArray.concat(
            this.getText({title: 'Source', source})
        );

        if (contentBlocks.length > 0) {
            for (const contentBlock of contentBlocks) {
                textArray.push('### Content');
                textArray.push(contentBlock);
            }
        }

        return textArray.join('\n');
    }
}

module.exports = {
    DocumentReferenceConverter
};
