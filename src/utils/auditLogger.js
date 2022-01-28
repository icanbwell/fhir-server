/**
 * logs audit entries
 */
const globals = require('../globals');
const {CLIENT_DB} = require('../constants');
const env = require('var');
const moment = require('moment-timezone');
const {getMeta} = require('../operations/common/getMeta');
const {getResource} = require('../operations/common/getResource');
const {getUuid} = require('./uid.util');
const {logDebug} = require('../operations/common/logging');
const {removeNull} = require('./nullRemover');
const {isTrue} = require('./isTrue');

/**
 * logs an entry for audit
 * @param {string} user
 * @param {string} remoteIPAddress
 * @param {string} scope
 * @param {string} resourceType
 * @param {string} base_version
 * @param {string} operation
 * @param {string[]} ids
 */
async function logAuditEntry(user, remoteIPAddress, scope, base_version, resourceType, operation, ids) {
    if (isTrue(env.DISABLE_AUDIT_LOGGING)) {
        return;
    }
    // noinspection JSValidateTypes
    /**
     * mongo db connection
     * @type {import('mongodb').Db}
     */
    let db = globals.get(CLIENT_DB);
    const collection_name = env.INTERNAL_AUDIT_TABLE || 'AuditEvent';
    /**
     * @type {string}
     */
    const mongoCollectionName = `${collection_name}_${base_version}`;
    /**
     * mongo collection
     * @type {import('mongodb').Collection}
     */
    let collection = db.collection(mongoCollectionName);

    /**
     * @type {function({Object}): Meta}
     */
    let Meta = getMeta(base_version);

    const operationCodeMapping = {
        'create': 'C',
        'read': 'R',
        'update': 'U',
        'delete': 'D',
        'execute': 'E'
    };

    // Get current record
    let Resource = getResource(base_version, 'AuditEvent');

    const document = {
        meta: new Meta({
            versionId: '1',
            lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
            security: [
                {
                    'system': 'https://www.icanbwell.com/owner',
                    'code': 'bwell'
                },
                {
                    'system': 'https://www.icanbwell.com/access',
                    'code': 'bwell'
                }
            ]
        }),
        recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
        type: {
            system: 'http://dicom.nema.org/resources/ontology/DCM',
            code: 110112,
            display: 'Query'
        },
        agent: [
            {
                who: {
                    reference: `Person/${user}`
                },
                altId: scope,
                requestor: true,
                name: user,
                network: {
                    address: remoteIPAddress,
                    type: 2
                }
            }
        ],
        action: operationCodeMapping[`${operation}`],
        entity: ids.map(id => {
            return {
                what: {
                    reference: `${resourceType}/${id}`
                }
            };
        })
    };
    let resource = new Resource(document);

    let id = getUuid(resource);
    logDebug(user, `id: ${id}`);

    let doc = removeNull(resource.toJSON());
    Object.assign(doc, {id: id});

    await collection.insertOne(doc);
}

module.exports = {
    logAuditEntry: logAuditEntry
};
