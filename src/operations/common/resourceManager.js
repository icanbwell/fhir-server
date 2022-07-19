const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, ATLAS_CLIENT_DB, CLIENT_DB} = require('../../constants');

/**
 * returns the collection name for resourceType
 * @param {string} resourceType
 * @param {string} base_version
 * @returns {string}
 */
function getCollectionNameForResourceType(resourceType, base_version = '4_0_0') {
    return `${resourceType}_${base_version}`;
}

/**
 * Gets the database connection for the given collection
 * @param {string} collectionName
 * @param {boolean?} useAtlas
 * @returns {import('mongodb').Db}
 */
function getDatabaseConnectionForCollection(collectionName, useAtlas) {
    return (collectionName === 'AuditEvent_4_0_0') ?
        globals.get(AUDIT_EVENT_CLIENT_DB) : (useAtlas && globals.has(ATLAS_CLIENT_DB)) ?
            globals.get(ATLAS_CLIENT_DB) : globals.get(CLIENT_DB);
}

module.exports = {
    getCollectionNameForResourceType,
    getDatabaseConnectionForCollection
};
