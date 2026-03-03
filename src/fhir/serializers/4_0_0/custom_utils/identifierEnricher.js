const { IdentifierSystem } = require('../../../../utils/identifierSystem');

// Function to populate identifier list from _ fields in read operations
function enrichIdentifierList(rawJson) {
    if (!rawJson || typeof rawJson !== 'object') return;

    const identifiers = rawJson.identifier || [];

    const resourceUuid = rawJson?._uuid;
    const resourceSourceId = rawJson?._sourceId;

    let sourceIdIdentifier = null;
    let uuidIdentifier = null;

    for (const iden of identifiers) {
        if (iden.system === IdentifierSystem.sourceId) {
            sourceIdIdentifier = iden;
        } else if (iden.system === IdentifierSystem.uuid) {
            uuidIdentifier = iden;
        }
    }

    // update sourceId extension if needed
    if (resourceSourceId) {
        if (!sourceIdIdentifier) {
            identifiers.push({
                id: 'sourceId',
                system: IdentifierSystem.sourceId,
                value: resourceSourceId
            });
        } else if (sourceIdIdentifier.value !== resourceSourceId) {
            sourceIdIdentifier.value = resourceSourceId;
        }
    }

    // update uuid extension if needed
    if (resourceUuid) {
        if (!uuidIdentifier) {
            identifiers.push({
                id: 'uuid',
                system: IdentifierSystem.uuid,
                value: resourceUuid
            });
        } else if (uuidIdentifier.value !== resourceUuid) {
            uuidIdentifier.value = resourceUuid;
        }
    }

    if (identifiers.length > 0) {
        rawJson.identifier = identifiers;
    }
}

module.exports = { enrichIdentifierList };
