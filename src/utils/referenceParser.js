const { isUuid } = require('./uid.util');
const { UrlParser } = require('./urlParser');

class ReferenceParser {
    /**
     * Parses reference string
     * The reference can be 'Patient/123|client' or 'Patient/123' or '123' or '123|client'
     * @param {string} reference
     * @return {{ resourceType: string|undefined, id: string, sourceAssigningAuthority: string|undefined}}
     */
    static parseReference (reference) {
        if (UrlParser.isUrl(reference)) { // is a url so don't try to parse
            return { id: reference };
        }
        const parts = reference.split('/');
        let resourceType;
        let id;
        let sourceAssigningAuthority;
        if (parts.length > 1) {
            resourceType = parts[0];
            id = parts[1];
            const idParts = id.split('|');
            if (idParts.length > 1) {
                id = idParts[0];
                sourceAssigningAuthority = idParts[1];
            }
        } else {
            id = parts[0];
            const idParts = id.split('|');
            if (idParts.length > 1) {
                id = idParts[0];
                sourceAssigningAuthority = idParts[1];
            }
        }
        return { resourceType, id, sourceAssigningAuthority };
    }

    /**
     * creates a reference string
     * @param {string|undefined} [resourceType]
     * @param {string} id
     * @param {string|undefined} [sourceAssigningAuthority]
     */
    static createReference ({ resourceType, id, sourceAssigningAuthority }) {
        let reference = '';
        if (resourceType) {
            reference = `${resourceType}/`;
        }
        reference = `${reference}${id}`;
        if (sourceAssigningAuthority && !isUuid(id)) {
            reference += `|${sourceAssigningAuthority}`;
        }
        return reference;
    }

    /**
     * whether this reference is a uuid reference
     * @param reference
     * @return {boolean}
     */
    static isUuidReference (reference) {
        const { id } = ReferenceParser.parseReference(reference);
        return isUuid(id);
    }

    /**
     * returns resourceType from reference
     * @param {string} reference
     * @return {string|undefined}
     */
    static getResourceType (reference) {
        const { resourceType } = ReferenceParser.parseReference(reference);
        return resourceType;
    }

    /**
     * returns sourceAssigningAuthority from reference
     * @param {string} reference
     * @return {string|undefined}
     */
    static getSourceAssigningAuthority (reference) {
        const { sourceAssigningAuthority } = ReferenceParser.parseReference(reference);
        return sourceAssigningAuthority;
    }

    /**
     * returns sourceAssigningAuthority from reference
     * @param {string} reference
     * @return {string}
     */
    static createReferenceWithoutSourceAssigningAuthority (reference) {
        const { id, resourceType } = ReferenceParser.parseReference(reference);
        return ReferenceParser.createReference({ resourceType, id });
    }
}

module.exports = {
    ReferenceParser
};
