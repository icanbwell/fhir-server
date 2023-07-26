const { IdentifierSystem } = require('./identifierSystem');

/**
 * Gets defaultSortId value from the resource provided
 * @param {Resource} resource
 * @param {string} defaultSortId
 * @returns {string|null}
 */
function getDefaultSortIdValue(resource, defaultSortId) {
    // check for defaultSortId in resource
    if (resource[String(defaultSortId)]) {
        return resource[String(defaultSortId)];
    }
    // if not present in resource then check in resource.identifier
    if (resource.identifier && Array.isArray(resource.identifier)) {
        return resource.identifier.find(
            identifier => identifier.system === IdentifierSystem[defaultSortId.replace('_', '')]
        ).value;
    }
    // if not found return null
    return null;
}

module.exports = {
    getDefaultSortIdValue
};
