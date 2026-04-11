const { isUuid, generateUUIDv5 } = require('./uid.util');

/**
 * Enriches member entity references with _uuid and _sourceId.
 * Replicates referenceGlobalIdHandler.updateReferenceAsync logic for flows
 * that bypass the normal pre-save pipeline (PATCH, diff-computed removals).
 *
 * @param {Array<Object>} members - Member objects with entity.reference
 * @param {string} resourceSourceAssigningAuthority - sourceAssigningAuthority from the parent resource
 */
function enrichMemberReferences(members, resourceSourceAssigningAuthority) {
    for (const member of members) {
        if (!member.entity?.reference) {
            continue;
        }

        // Skip if already enriched
        if (member.entity._uuid && member.entity._sourceId) {
            continue;
        }

        const referenceValue = member.entity.reference;
        const referenceParts = referenceValue.split('/');
        const referenceResourceType = referenceParts.length > 1 ? referenceParts[0] : null;
        let referenceId = referenceParts.slice(-1)[0];
        let sourceAssigningAuthority = resourceSourceAssigningAuthority;

        // If sourceAssigningAuthority is in the reference, extract it
        if (referenceId.includes('|')) {
            const parts = referenceId.split('|');
            referenceId = parts[0];
            sourceAssigningAuthority = parts[1];
        }

        // Generate UUID: use as-is if already a UUID, otherwise generate UUIDv5
        let uuid;
        if (isUuid(referenceId)) {
            uuid = referenceId;
        } else {
            uuid = generateUUIDv5(`${referenceId}|${sourceAssigningAuthority}`);
        }

        const resourcePrefix = referenceResourceType ? `${referenceResourceType}/` : '';
        member.entity._uuid = resourcePrefix + uuid;
        member.entity._sourceId = resourcePrefix + referenceId;
    }
}

module.exports = { enrichMemberReferences };
