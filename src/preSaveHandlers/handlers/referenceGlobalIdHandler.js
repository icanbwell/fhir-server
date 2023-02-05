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

        /**
         * @type {string}
         */
        let uuid;

        /**
         * @type {string}
         */
        let id;
        if (isUuid(referenceValue)) {
            // already a uuid so nothing to do
            uuid = referenceValue;
            id = referenceValue.split('/').slice(-1)[0];
        } else if (referenceValue.includes('|')) {
            uuid = generateUUIDv5(referenceValue);
            const parts = referenceValue.split('|');
            id = parts[0].split('/').slice(-1)[0];
            sourceAssigningAuthority = parts[1];
        } else {
            // get sourceAssigningAuthority of parent
            uuid = generateUUIDv5(`${referenceValue}|${sourceAssigningAuthority}`);
            id = id = referenceValue.split('/').slice(-1)[0];
        }
        /**
         * @type {Extension[]}
         */
        const extensions = reference.extension || [];

        let referenceUpdated = false;
        if (!extensions.some(ext => ext.url === IdentifierSystem.sourceId)) {
            extensions.push(
                new Extension(
                    {
                        url: IdentifierSystem.sourceId,
                        valueString: id
                    }
                )
            );
            referenceUpdated = true;
        }
        if (!extensions.some(ext => ext.url === IdentifierSystem.uuid)) {
            extensions.push(
                new Extension(
                    {
                        url: IdentifierSystem.uuid,
                        valueString: uuid
                    }
                )
            );
            referenceUpdated = true;
        }
        if (!extensions.some(ext => ext.url === SecurityTagSystem.sourceAssigningAuthority)
        ) {
            extensions.push(
                new Extension(
                    {
                        url: SecurityTagSystem.sourceAssigningAuthority,
                        valueString: sourceAssigningAuthority
                    }
                )
            );
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
