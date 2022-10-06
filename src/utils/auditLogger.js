/**
 * logs audit entries
 */
const env = require('var');
const moment = require('moment-timezone');
const {getMeta} = require('../operations/common/getMeta');
const {getResource} = require('../operations/common/getResource');
const {generateUUID} = require('./uid.util');
const {isTrue} = require('./isTrue');
const deepcopy = require('deepcopy');
const {PostRequestProcessor} = require('./postRequestProcessor');
const {DatabaseBulkInserter} = require('../dataLayer/databaseBulkInserter');
const {ErrorReporter} = require('./slack.logger');
const {assertTypeEquals} = require('./assertType');

class AuditLogger {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {ErrorReporter} errorReporter
     * @param {string} base_version
     */
    constructor({
                    postRequestProcessor,
                    databaseBulkInserter,
                    errorReporter,
                    base_version = '4_0_0'
                }) {
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        assertTypeEquals(errorReporter, ErrorReporter);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        /**
         * @type {ErrorReporter}
         */
        this.errorReporter = errorReporter;
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
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {string} operation
     * @param {Object} cleanedArgs
     * @param {string[]} ids
     * @returns {Resource}
     */
    createAuditEntry(
        {
            base_version, requestInfo, operation,
            ids, resourceType, cleanedArgs
        }
    ) {
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
        let ResourceCreator = getResource(base_version, 'AuditEvent');

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
        let resource = new ResourceCreator(document);

        let id = generateUUID();
        resource.id = id;

        return resource;
    }

    /**
     * logs an entry for audit
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {string} operation
     * @param {Object} args
     * @param {string[]} ids
     */
    async logAuditEntryAsync(
        {
            requestInfo, base_version, resourceType,
            operation, args, ids
        }
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
        let doc = this.createAuditEntry(
            {
                base_version, requestInfo, operation, ids, resourceType, cleanedArgs
            }
        );

        this.queue.push(doc);
    }

    /**
     * Flush
     * @param {string} requestId
     * @param {string} currentDate
     * @return {Promise<void>}
     */
    async flushAsync({requestId, currentDate}) {
        /**
         * Audit entries are always of resource type AuditEvent
         * @type {string}
         */
        const resourceType = 'AuditEvent';
        for (const /** @type {Resource} */ doc of this.queue) {
            await this.databaseBulkInserter.insertOneAsync({resourceType, doc});
        }
        this.queue = [];
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResults = await this.databaseBulkInserter.executeAsync(
            {
                requestId, currentDate, base_version: this.base_version
            }
        );
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResultErrors = mergeResults.filter(m => m.issue);
        if (mergeResultErrors.length > 0) {
            await this.errorReporter.reportErrorAsync(
                {
                    source: 'flushAsync',
                    message: `Error creating audit entries: ${JSON.stringify(mergeResultErrors)}`,
                    args: {
                        requestId: requestId,
                        errors: mergeResultErrors
                    }
                }
            );
        }
    }
}

module.exports = {
    AuditLogger
};
