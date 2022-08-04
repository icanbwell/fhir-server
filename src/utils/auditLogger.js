/**
 * logs audit entries
 */
const env = require('var');
const moment = require('moment-timezone');
const {getMeta} = require('../operations/common/getMeta');
const {getResource} = require('../operations/common/getResource');
const {getUuid} = require('./uid.util');
const {removeNull} = require('./nullRemover');
const {isTrue} = require('./isTrue');
const deepcopy = require('deepcopy');
const {DatabaseUpdateManager} = require('./databaseUpdateManager');

/**
 * Create an AuditEntry resource
 * @param {import('./requestInfo').RequestInfo} requestInfo
 * @param {string} resourceType
 * @param {string} base_version
 * @param {string} operation
 * @param {Object} cleanedArgs
 * @param {string[]} ids
 * @returns {Object}
 */
function createAuditEntry(base_version, requestInfo, operation,
                          ids, resourceType, cleanedArgs) {
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

    const maxNumberOfIds = env.AUDIT_MAX_NUMBER_OF_IDS ? parseInt(env.AUDIT_MAX_NUMBER_OF_IDS) : 50;
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
                    reference: `Person/${requestInfo.user}`
                },
                altId: requestInfo.scope,
                requestor: true,
                name: requestInfo.user,
                network: {
                    address: requestInfo.remoteIPAddress,
                    type: 2
                }
            }
        ],
        action: operationCodeMapping[`${operation}`],
        entity: ids.slice(0, maxNumberOfIds).map((id, index) => {
            return {
                what: {
                    reference: `${resourceType}/${id}`
                },
                detail: index === 0 ?
                    Object.entries(cleanedArgs).filter(([_, value]) => typeof value === 'string').map(([key, value], _) => {
                        return {
                            type: key,
                            valueString: value
                        };
                    }) : null
            };
        })
    };
    let resource = new Resource(document);

    let id = getUuid(resource);

    let doc = removeNull(resource.toJSON());
    Object.assign(doc, {id: id});
    return doc;
}

/**
 * logs an entry for audit
 * @param {import('./requestInfo').RequestInfo} requestInfo
 * @param {string} resourceType
 * @param {string} base_version
 * @param {string} operation
 * @param {Object} args
 * @param {string[]} ids
 * @param {DatabaseBulkInserter} databaseBulkInserter
 */
async function logAuditEntryAsync(requestInfo, base_version, resourceType,
                                  operation, args, ids,
                                  databaseBulkInserter = null) {
    if (isTrue(env.DISABLE_AUDIT_LOGGING)) {
        return;
    }

    const cleanedArgs = deepcopy(args);
    // remove id and _id args since they are duplicated in the items retrieved
    if (cleanedArgs['id']) {
        cleanedArgs['id'] = '';
    }
    if (cleanedArgs['_id']) {
        delete cleanedArgs['_id'];
    }
    if (cleanedArgs['_source']) {
        delete cleanedArgs['_source'];
    }
    /**
     * @type {string}
     */
    const auditEventCollectionName = env.INTERNAL_AUDIT_TABLE || `AuditEvent_${base_version}`;

    let doc = createAuditEntry(base_version, requestInfo, operation, ids, resourceType, cleanedArgs);

    if (databaseBulkInserter) {
        await databaseBulkInserter.insertOneAsync(auditEventCollectionName, doc);
    } else {
        try {
            await new DatabaseUpdateManager('AuditEvent', base_version, false).insertOne(doc);
        } catch (e) {
            const documentContents = JSON.stringify(doc);
            throw new Error(`ERROR inserting AuditEvent into db [${Buffer.byteLength(documentContents, 'utf8')} bytes]: ${documentContents}`);
        }
    }
}

module.exports = {
    logAuditEntryAsync
};
