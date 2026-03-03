const { IdentifierSystem } = require('../../../../utils/identifierSystem');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

// Function to populate reference extension from _ fields in read operations
function enrichReferenceExtension(rawJson) {
    if (!rawJson || typeof rawJson !== 'object') return;

    const extensions = rawJson.extension || [];

    const referenceUuid = rawJson?._uuid;
    // sourceId can be missing for cases when reference is uuid based
    const referenceSourceId = rawJson?._sourceId || rawJson?._uuid;
    const referenceSourceAssigningAuthority = rawJson?._sourceAssigningAuthority;

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
    if (referenceSourceId) {
        if (!sourceIdExtension) {
            extensions.push({
                id: 'sourceId',
                url: IdentifierSystem.sourceId,
                valueString: referenceSourceId
            });
        } else if (sourceIdExtension.valueString !== referenceSourceId) {
            sourceIdExtension.valueString = referenceSourceId;
        }
    }

    // update uuid extension if needed
    if (referenceUuid) {
        if (!uuidExtension) {
            extensions.push({
                id: 'uuid',
                url: IdentifierSystem.uuid,
                valueString: referenceUuid
            });
        } else if (uuidExtension.valueString !== referenceUuid) {
            uuidExtension.valueString = referenceUuid;
        }
    }

    // update sourceAssigningAuthority extension if needed
    if (referenceSourceAssigningAuthority) {
        if (!sourceAssigningAuthorityExtension) {
            extensions.push({
                id: 'sourceAssigningAuthority',
                url: SecurityTagSystem.sourceAssigningAuthority,
                valueString: referenceSourceAssigningAuthority
            });
        } else if (sourceAssigningAuthorityExtension.valueString !== referenceSourceAssigningAuthority) {
            sourceAssigningAuthorityExtension.valueString = referenceSourceAssigningAuthority;
        }
    }

    if (extensions.length > 0) {
        rawJson.extension = extensions;
    }
}

module.exports = { enrichReferenceExtension };
