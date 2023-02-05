const {PreSaveHandler} = require('./preSaveHandler');
const {isUuid, generateUUIDv5} = require('../../utils/uid.util');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {assertIsValid} = require('../../utils/assertType');
const {IdentifierSystem} = require('../../utils/identifierSystem');
const Extension = require('../../fhir/classes/4_0_0/complex_types/extension');

class ReferenceGlobalIdHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    async preSaveAsync({resource}) {
        // get sourceAssigningAuthority of resource
        /**
         * @type {string[]}
         */
        const sourceAssigningAuthorityCodes = resource.meta.security.filter(
            s => s.system === SecurityTagSystem.sourceAssigningAuthority).map(s => s.code);
        assertIsValid(sourceAssigningAuthorityCodes.length > 0,
            `No sourceAssigningAuthority codes found for resource id: ${resource.id}`);
        /**
         * @type {string}
         */
        const sourceAssigningAuthority = sourceAssigningAuthorityCodes[0];
        resource.updateReferences(
            {
                fnUpdateReference: (reference) => this.updateReference(
                    {
                        sourceAssigningAuthority,
                        reference
                    }
                )
            }
        );
        return resource;
    }

    /**
     * updates references
     * @param {string} sourceAssigningAuthority
     * @param {Reference} reference
     * @return {Reference}
     */
    updateReference({sourceAssigningAuthority, reference}) {
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
         * get the part after/ as the id e.g., Patient/123 -> 123
         * @type {string}
         */
        let referenceId = referenceValue.split('/').slice(-1)[0];

        // if sourceAssigningAuthority is specified then extract the id and sourceAssigningAuthority
        if (referenceId.includes('|')) {
            const parts = referenceId.split('|');
            referenceId = parts[0];
            sourceAssigningAuthority = parts[1];
        }

        // see if we need to create a uuid
        if (isUuid(referenceId)) {
            // already a uuid so nothing to do
            uuid = referenceId;
        } else {
            // get sourceAssigningAuthority of parent
            uuid = generateUUIDv5(`${referenceId}|${sourceAssigningAuthority}`);
        }
        /**
         * @type {Extension[]}
         */
        const extensions = reference.extension || [];

        let referenceUpdated = false;

        // update sourceId extension if needed
        /**
         * @type {Extension|undefined}
         */
        const sourceIdExtension = extensions.find(ext => ext.url === IdentifierSystem.sourceId);
        if (!sourceIdExtension) {
            extensions.push(
                new Extension(
                    {
                        id: 'sourceId',
                        url: IdentifierSystem.sourceId,
                        valueString: referenceId
                    }
                )
            );
            referenceUpdated = true;
        } else if (sourceIdExtension.valueString !== referenceId) {
            sourceIdExtension.valueString = referenceId;
            referenceUpdated = true;
        }

        // update uuid extension if needed
        /**
         * @type {Extension|undefined}
         */
        const uuidExtension = extensions.find(ext => ext.url === IdentifierSystem.uuid);
        if (!uuidExtension) {
            extensions.push(
                new Extension(
                    {
                        id: 'uuid',
                        url: IdentifierSystem.uuid,
                        valueString: uuid
                    }
                )
            );
            referenceUpdated = true;
        } else if (uuidExtension.valueString !== uuid) {
            uuidExtension.valueString = uuid;
            referenceUpdated = true;
        }

        // update sourceAssigningAuthority extension if needed
        /**
         * @type {Extension|undefined}
         */
        const sourceAssigningAuthorityExtension = extensions.find(ext => ext.url === SecurityTagSystem.sourceAssigningAuthority);
        if (!sourceAssigningAuthorityExtension) {
            extensions.push(
                new Extension(
                    {
                        id: 'sourceAssigningAuthority',
                        url: SecurityTagSystem.sourceAssigningAuthority,
                        valueString: sourceAssigningAuthority
                    }
                )
            );
            referenceUpdated = true;
        } else if (sourceAssigningAuthorityExtension.valueString !== sourceAssigningAuthority) {
            sourceAssigningAuthorityExtension.valueString = sourceAssigningAuthority;
            referenceUpdated = true;
        }

        if (referenceUpdated) {
            reference.extension = extensions;
        }
        return reference;
    }
}

module.exports = {
    ReferenceGlobalIdHandler
};
