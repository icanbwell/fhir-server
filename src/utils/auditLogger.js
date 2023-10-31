/**
 * logs audit entries
 */
const env = require('var');
const moment = require('moment-timezone');
const {generateUUID} = require('./uid.util');
const {isTrue} = require('./isTrue');
const deepcopy = require('deepcopy');
const {PostRequestProcessor} = require('./postRequestProcessor');
const {DatabaseBulkInserter} = require('../dataLayer/databaseBulkInserter');
const {assertTypeEquals} = require('./assertType');
const {SecurityTagSystem} = require('./securityTagSystem');
const {logError} = require('../operations/common/logging');
const AuditEvent = require('../fhir/classes/4_0_0/resources/auditEvent');
const Meta = require('../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const AuditEventAgent = require('../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const AuditEventSource = require('../fhir/classes/4_0_0/backbone_elements/auditEventSource');
const AuditEventEntity = require('../fhir/classes/4_0_0/backbone_elements/auditEventEntity');
const AuditEventNetwork = require('../fhir/classes/4_0_0/backbone_elements/auditEventNetwork');

class AuditLogger {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {DatabaseBulkInserter} databaseBulkInserter
     * @param {string} base_version
     */
    constructor({
                    postRequestProcessor,
                    databaseBulkInserter,
                    base_version = '4_0_0'
                }) {
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
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
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} operation
     * @param {Object} cleanedArgs
     * @param {string[]} ids
     * @returns {Resource}
     */
    createAuditEntry(
        {
            requestInfo, operation,
            ids, resourceType, cleanedArgs
        }
    ) {
        const operationCodeMapping = {
            'create': 'C',
            'read': 'R',
            'update': 'U',
            'delete': 'D',
            'execute': 'E'
        };

        // Get current record
        const maxNumberOfIds = env.AUDIT_MAX_NUMBER_OF_IDS ? parseInt(env.AUDIT_MAX_NUMBER_OF_IDS) : 50;

        const resource = new AuditEvent({
            id: generateUUID(),
            meta: new Meta({
                versionId: '1',
                lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
                security: [
                    new Coding({
                        'system': SecurityTagSystem.owner,
                        'code': 'bwell'
                    }),
                    new Coding({
                        'system': SecurityTagSystem.access,
                        'code': 'bwell'
                    })
                ]
            }),
            recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ')),
            type: new Coding({
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: '110112',
                display: 'Query'
            }),
            agent: [
                new AuditEventAgent({
                    who: new Reference({
                        reference: `Person/${requestInfo.user}`
                    }),
                    altId: requestInfo.scope,
                    requestor: true,
                    name: requestInfo.user,
                    network: new AuditEventNetwork({
                        address: requestInfo.remoteIPAddress,
                        type: '2'
                    })
                })
            ],
            source: new AuditEventSource({
                observer: new Reference(
                    {
                        reference: `Person/${requestInfo.user}`
                    }
                )
            }),
            action: operationCodeMapping[`${operation}`],
            entity: ids.slice(0, maxNumberOfIds).map((resourceId, index) => {
                return new AuditEventEntity({
                    what: new Reference({
                        reference: `${resourceType}/${resourceId}`
                    }),
                    detail: index === 0 ?
                        Object.entries(cleanedArgs).filter(([_, value]) => typeof value === 'string').map(([key, value], _) => {
                            return {
                                type: key,
                                valueString: value
                            };
                        }) : null
                });
            })
        });

        return resource;
    }

    /**
     * logs an entry for audit
     * @param {FhirRequestInfo} requestInfo
     * @param {string} resourceType
     * @param {string} base_version
     * @param {string} operation
     * @param {Object} args
     * @param {string[]} ids
     * @return {Promise<void>}
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
     * @param {string} method
     * @param {string} userRequestId
     * @return {Promise<void>}
     */
    async flushAsync({requestId, currentDate, method, userRequestId}) {
        /**
         * Audit entries are always of resource type AuditEvent
         * @type {string}
         */
        const resourceType = 'AuditEvent';

        /**
         * @type {Resource[]}
         */
        const currentQueue = this.queue.splice(0, this.queue.length);

        for (const /** @type {Resource} */ doc of currentQueue) {
            await this.databaseBulkInserter.insertOnlyAsync({requestId, resourceType, doc});
        }
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResults = await this.databaseBulkInserter.executeAsync(
            {
                requestId, currentDate, base_version: this.base_version,
                method,
                userRequestId,
            }
        );
        /**
         * @type {MergeResultEntry[]}
         */
        const mergeResultErrors = mergeResults.filter(m => m.issue);
        if (mergeResultErrors.length > 0) {
            logError('Error creating audit entries', {
                error: mergeResultErrors,
                source: 'flushAsync',
                args: {
                    request: {id: requestId},
                    errors: mergeResultErrors
                }
            });
        }
    }
}

module.exports = {
    AuditLogger
};
