const {isUuid} = require('./uid.util');

class ReferenceParser {
    /**
     * Parses reference string
     * The reference can be 'Patient/123|medstar' or 'Patient/123' or '123' or '123|medstar'
     * @param {string} reference
     * @return {{ resourceType: string|undefined, id: string, sourceAssigningAuthority: string|undefined}}
     */
    static parseReference(reference) {
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
        return {resourceType, id, sourceAssigningAuthority};
    }

    /**
     * creates a reference string
     * @param {string|undefined} [resourceType]
     * @param {string} id
     * @param {string|undefined} [sourceAssigningAuthority]
     */
    static createReference({resourceType, id, sourceAssigningAuthority}) {
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
}

module.exports = {
    ReferenceParser
};
