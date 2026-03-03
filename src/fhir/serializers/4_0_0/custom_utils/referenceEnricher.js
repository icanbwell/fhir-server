const { IdentifierSystem } = require('../../../../utils/identifierSystem');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

// Function to poplate reference extension from _ fields in read operations
function enrichReferenceExtension(rawJson) {
    if (!rawJson || typeof rawJson !== 'object') return;

    const extensions = rawJson.extension || [];

    const referenceValueUuid = rawJson?._uuid;
    // sourceId can be missing for cases when reference is uuid based
    const referenceValueSourceId = rawJson?._sourceId || rawJson?._uuid;
    const sourceAssigningAuthority = rawJson?._sourceAssigningAuthority;

    let sourceIdExtension = null;
    let uuidExtension = null;
    let sourceAssigningAuthorityExtension = null;

    for (const ext of extensions) {
        if (ext.url === IdentifierSystem.sourceId) {
            sourceIdExtension = ext;
        } else if (ext.url === IdentifierSystem.uuid) {
            uuidExtension = ext;
        } else if (ext.url === SecurityTagSystem.sourceAssigningAuthority) {
            sourceAssigningAuthorityExtension = ext;
        }
    }

    // update sourceId extension if needed
    if (!sourceIdExtension) {
        extensions.push({
            id: 'sourceId',
            url: IdentifierSystem.sourceId,
            valueString: referenceValueSourceId
        });
    } else if (sourceIdExtension.valueString !== referenceValueSourceId) {
        sourceIdExtension.valueString = referenceValueSourceId;
    }

    // update uuid extension if needed
    if (!uuidExtension) {
        extensions.push({
            id: 'uuid',
            url: IdentifierSystem.uuid,
            valueString: referenceValueUuid
        });
    } else if (uuidExtension.valueString !== referenceValueUuid) {
        uuidExtension.valueString = referenceValueUuid;
    }

    // update sourceAssigningAuthority extension if needed
    if (!sourceAssigningAuthorityExtension) {
        extensions.push({
            id: 'sourceAssigningAuthority',
            url: SecurityTagSystem.sourceAssigningAuthority,
            valueString: sourceAssigningAuthority
        });
    } else if (sourceAssigningAuthorityExtension.valueString !== sourceAssigningAuthority) {
        sourceAssigningAuthorityExtension.valueString = sourceAssigningAuthority;
    }

    rawJson.extension = extensions;
}

module.exports = { enrichReferenceExtension };
