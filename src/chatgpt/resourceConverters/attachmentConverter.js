const {BaseConverter} = require('./baseConverter');

class AttachmentConverter extends BaseConverter {
    /**
     * converts a FHIR resource to summary text
     * @param {Resource} resource
     * @returns {string}
     */
    convert({resource}) {
        const attachment = /** @type {Attachment} */ resource;
        const {id, data, contentType} = attachment;
        // base64 decode the data
        const content = contentType === 'text/text' ?
            Buffer.from(data, 'base64').toString('utf8') :
            undefined;
        // TODO: Handle PDF by converting it to text using https://www.npmjs.com/package/pdfreader
        const formattedOutput = `
- Resource: Attachment
- ID: ${id}
- Content:
${content}
`;
        return formattedOutput;
    }
}

module.exports = {
    AttachmentConverter
};
