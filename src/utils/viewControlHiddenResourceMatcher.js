const { IdParser } = require('./idParser');
const { isUuid } = require('./uid.util');

/**
 * Builds a predicate telling whether a resource is hidden by a dataConnectionViewControl Consent,
 * for results that were not filtered by the query (the $everything cache replay).
 *
 * It matches ids the way the query's `_id:not` filter does (see FilterById.filterByItems): a uuid
 * matches the resource's `_uuid`, any other value matches its source id, and a
 * sourceAssigningAuthority suffix (`id|authority`) is ignored.
 * @param {Readonly<{[resourceType: string]: ReadonlyArray<string>}>|undefined} excludeMap hidden ids
 *  by resourceType, as returned by PatientDataViewControlExclusion
 * @return {((resource: {resourceType?: string, id?: string, _uuid?: string, _sourceId?: string}) => boolean)|null}
 *  null when nothing is hidden
 */
function createViewControlHiddenResourceMatcher(excludeMap) {
    /** @type {Map<string, {uuids: Set<string>, sourceIds: Set<string>}>} */
    const hiddenByType = new Map();
    for (const [resourceType, values] of Object.entries(excludeMap || {})) {
        for (const value of values || []) {
            const { id } = IdParser.parse(value);
            if (!id) {
                continue;
            }
            if (!hiddenByType.has(resourceType)) {
                hiddenByType.set(resourceType, { uuids: new Set(), sourceIds: new Set() });
            }
            const hidden = hiddenByType.get(resourceType);
            (isUuid(id) ? hidden.uuids : hidden.sourceIds).add(id);
        }
    }
    if (hiddenByType.size === 0) {
        return null;
    }
    return (resource) => {
        const hidden = hiddenByType.get(resource?.resourceType);
        if (!hidden) {
            return false;
        }
        return hidden.uuids.has(resource._uuid) ||
            hidden.sourceIds.has(resource._sourceId) ||
            hidden.sourceIds.has(resource.id);
    };
}

module.exports = {
    createViewControlHiddenResourceMatcher
};
