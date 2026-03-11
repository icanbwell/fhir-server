const { PreSaveHandler } = require('./preSaveHandler');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { assertIsValid } = require('../../utils/assertType');
const { IdentifierSystem } = require('../../utils/identifierSystem');

/**
 * @classdesc Adds global id fields to every reference
 */
class ReferenceGlobalIdHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync({ resource }) {
        // get sourceAssigningAuthority of resource
        /**
         * @type {string}
         */
        const sourceAssigningAuthority = resource._sourceAssigningAuthority;
        assertIsValid(
            sourceAssigningAuthority,
            `sourceAssigningAuthority is null for ${resource.resourceType}/${resource.id}`
        );
        await resource.updateReferencesAsync({
            fnUpdateReferenceAsync: async (reference) =>
                await this.updateReferenceAsync({
                    sourceAssigningAuthority,
                    reference
                })
        });
        return resource;
    }

    /**
     * updates references
     * @param {string} sourceAssigningAuthority
     * @param {Reference} reference
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync({ sourceAssigningAuthority, reference }) {
        assertIsValid(sourceAssigningAuthority, 'sourceAssigningAuthority is null');
        /**
         * @type {string}
         */
        const referenceValue = reference.reference;

        if (!referenceValue) {
            return reference;
        }

        /**
         * @type {string}
         */
        let uuid;

        /**
         * @type {string[]}
         */
        const referenceParts = referenceValue.split('/');
        /**
         * @type {string|null}
         */
        const referenceResourceType = referenceParts.length > 1 ? referenceParts[0] : null;
        /**
         * get the part after/ as the id e.g., Patient/123 -> 123
         * @type {string}
         */
        let referenceId = referenceParts.slice(-1)[0];

        // if sourceAssigningAuthority is specified then extract the id and sourceAssigningAuthority
        if (referenceId.includes('|')) {
            const parts = referenceId.split('|');
            referenceId = parts[0];
            sourceAssigningAuthority = parts[1];
        } else if (reference._sourceAssigningAuthority) {
            sourceAssigningAuthority = reference._sourceAssigningAuthority;
        }

        // see if we need to create a uuid
        if (isUuid(referenceId)) {
            // already a uuid so nothing to do
            uuid = referenceId;
        } else {
            // get sourceAssigningAuthority of parent
            uuid = generateUUIDv5(`${referenceId}|${sourceAssigningAuthority}`);
        }

        const resourcePrefix = referenceResourceType ? `${referenceResourceType}/` : '';
        reference._uuid = resourcePrefix + uuid;
        reference._sourceId = resourcePrefix + referenceId;
        reference._sourceAssigningAuthority = sourceAssigningAuthority;

        // remove extension having url for uuid, sourceId or sourceAssigningAuthority
        // Only process if extensions exist
        if (reference.extension && reference.extension.length > 0) {
            const excludedUrls = [
                IdentifierSystem.uuid,
                IdentifierSystem.sourceId,
                SecurityTagSystem.sourceAssigningAuthority
            ];
            reference.extension = reference.extension.filter((ext) => !excludedUrls.includes(ext.url));
        }

        return reference;
    }
}

module.exports = {
    ReferenceGlobalIdHandler
};
