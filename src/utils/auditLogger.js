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
const {DatabaseUpdateManager} = require('../dataLayer/databaseUpdateManager');
const assert = require('node:assert/strict');

class AuditLogger {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {string} base_version
     */
    constructor(postRequestProcessor, databaseBulkInserter, base_version = '4_0_0') {
        assert(postRequestProcessor);
        assert(databaseBulkInserter);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        /**
         * @type {Resource[]}
         */
        this.queue = [];
        /**
         * @type {string}
         */
        this.base_version = base_version;
    }

    /**
     * Create an AuditEntry resource
     * @param {import('./requestInfo').RequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {string} operation
     * @param {Object} cleanedArgs
     * @param {string[]} ids
     * @returns {Resource}
     */
    createAuditEntry(base_version, requestInfo, operation,
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
     */
    async logAuditEntryAsync(requestInfo, base_version, resourceType,
                             operation, args, ids
    ) {
        if (isTrue(env.DISABLE_AUDIT_LOGGING)) {
            return;
        }

        if (resourceType === 'AuditEvent') {
            // don't create audit entries for audit entries
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
         * @type {Resource}
         */
        let doc = this.createAuditEntry(base_version, requestInfo, operation, ids, resourceType, cleanedArgs);

        this.queue.push(doc);
    }

    /**
     * Flush
     * @param {string} requestId
     * @param {string} currentDate
     * @return {Promise<void>}
     */
    async flushAsync(requestId, currentDate) {
        /**
         * Audit entries are always of resource type AuditEvent
         * @type {string}
         */
        const resourceType = 'AuditEvent';
        for (const doc of this.queue) {
            if (this.databaseBulkInserter) {
                await this.databaseBulkInserter.insertOneAsync(resourceType, doc);
            } else {
                try {
                    await new DatabaseUpdateManager(resourceType, this.base_version, false).insertOneAsync(doc);
                } catch (e) {
                    const documentContents = JSON.stringify(doc);
                    throw new Error(`ERROR inserting AuditEvent into db [${Buffer.byteLength(documentContents, 'utf8')} bytes]: ${e}: ${documentContents}`);
                }
            }
        }
        if (this.databaseBulkInserter) {
            await this.databaseBulkInserter.executeAsync(requestId, currentDate, this.base_version, false);
        }
    }
}

module.exports = {
    AuditLogger
};
