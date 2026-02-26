/**
 * logs audit entries
 */
const moment = require('moment-timezone');
const { generateUUID } = require('./uid.util');
const deepcopy = require('deepcopy');
const { PostRequestProcessor } = require('./postRequestProcessor');
const { DatabaseBulkInserter } = require('../dataLayer/databaseBulkInserter');
const { assertTypeEquals } = require('./assertType');
const { SecurityTagSystem } = require('./securityTagSystem');
const { logError } = require('../operations/common/logging');
const AuditEvent = require('../fhir/classes/4_0_0/resources/auditEvent');
const Meta = require('../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../fhir/classes/4_0_0/complex_types/coding');
const Reference = require('../fhir/classes/4_0_0/complex_types/reference');
const AuditEventAgent = require('../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const AuditEventSource = require('../fhir/classes/4_0_0/backbone_elements/auditEventSource');
const AuditEventEntity = require('../fhir/classes/4_0_0/backbone_elements/auditEventEntity');
const AuditEventNetwork = require('../fhir/classes/4_0_0/backbone_elements/auditEventNetwork');
const { Mutex } = require('async-mutex');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { AuditEventKafkaProducer } = require('./auditEventKafkaProducer');
const { ConfigManager } = require('./configManager');
const { PERSON_PROXY_PREFIX } = require('../constants');
const mutex = new Mutex();

class AuditLogger {
    /**
     * constructor
     * @typedef {Object} params
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {DatabaseBulkInserter} databaseBulkInserter
     * @property {PreSaveManager} preSaveManager
     * @property {ConfigManager} configManager
     * @property {AuditEventKafkaProducer} auditEventKafkaProducer
     * @property {string} base_version
     *
     * @param {params}
     */
    constructor ({
                    postRequestProcessor,
                    databaseBulkInserter,
                    preSaveManager,
                    configManager,
                    auditEventKafkaProducer,
                    base_version = '4_0_0'
                }) {
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        assertTypeEquals(preSaveManager, PreSaveManager);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        /**
         * @type {DatabaseBulkInserter}
         */
        this.databaseBulkInserter = databaseBulkInserter;
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {AuditEventKafkaProducer}
         */
        this.auditEventKafkaProducer = auditEventKafkaProducer;
        assertTypeEquals(auditEventKafkaProducer, AuditEventKafkaProducer);
        /**
         * @type {{doc: import('../fhir/classes/4_0_0/resources/resource'), requestInfo: import('./fhirRequestInfo').FhirRequestInfo}[]}
         */
        this.queue = [];
        /**
         * @type {string}
         */
        this.base_version = base_version;

        /**
         * @type {boolean}
         */
        this.isAuditEventEnabled = this.configManager.enableAuditEventMongoDB || this.configManager.enableAuditEventKafka;
        /**
         * @type {number}
         */
        this.maxIdsPerAuditEvent = this.configManager.maxIdsPerAuditEvent;
    }

    /**
     * Create an AuditEntry resource
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string} params.resourceType
     * @param {string} params.operation
     * @param {Object} params.cleanedArgs
     * @param {string[]} params.ids
     * @param {number} [params.maxNumberOfIds] - Optional max number of IDs to include in audit entry
     * @returns {AuditEvent}
     */
    createAuditEntry (
        {
            requestInfo, operation,
            ids, resourceType, cleanedArgs,
            maxNumberOfIds
        }
    ) {
        const operationCodeMapping = {
            create: 'C',
            read: 'R',
            update: 'U',
            delete: 'D',
            execute: 'E'
        };

        // Get current record
        const maxIds = maxNumberOfIds !== undefined ? maxNumberOfIds : this.maxIdsPerAuditEvent;

        const isUser = Boolean(requestInfo?.isUser);

        /**
         * @type {string}
         */
        let actorReference;
        /**
         * @type {string|null}
         */
        const alternateId = requestInfo.alternateUserId;

        if (isUser) {
            actorReference = `Patient/${PERSON_PROXY_PREFIX}${requestInfo.user}`;
        } else {
            actorReference = `Person/${requestInfo.user}`;
        }

        const resource = new AuditEvent({
            id: generateUUID(),
            meta: new Meta({
                versionId: '1',
                lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
                security: [
                    new Coding({
                        system: SecurityTagSystem.owner,
                        code: 'bwell'
                    }),
                    new Coding({
                        system: SecurityTagSystem.access,
                        code: 'bwell'
                    })
                ]
            }),
            recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
            type: new Coding({
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: '110112',
                display: 'Query'
            }),
            agent: [
                new AuditEventAgent({
                    who: new Reference({
                        reference: actorReference
                    }),
                    altId: alternateId,
                    requestor: true,
                    network: new AuditEventNetwork({
                        address: requestInfo.remoteIpAddress,
                        type: '2'
                    })
                })
            ],
            source: new AuditEventSource({
                observer: new Reference(
                    {
                        reference: actorReference
                    }
                )
            }),
            action: operationCodeMapping[`${operation}`],
            entity: ids.slice(0, maxIds).map((resourceId, index) => {
                return new AuditEventEntity({
                    what: new Reference({
                        reference: `${resourceType}/${resourceId}`
                    }),
                    detail: index === 0
                        ? Object.entries(cleanedArgs).filter(([_, value]) => typeof value === 'string').map(([key, value], _) => {
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
     * @param {number} [maxNumberOfIds] - Optional max number of IDs to include in audit entry
     * @return {Promise<void>}
     */
    async logAuditEntryAsync ({
        requestInfo, base_version, resourceType, operation, args, ids, maxNumberOfIds
    }) {
        // don't create audit entries for AuditEvent or if disabled
        if (!this.isAuditEventEnabled || resourceType === 'AuditEvent') {
            return;
        }

        const cleanedArgs = deepcopy(args);
        // remove id and _id args since they are duplicated in the items retrieved
        if (cleanedArgs.id) {
            cleanedArgs.id = '';
        }
        if (cleanedArgs._id) {
            delete cleanedArgs._id;
        }
        if (cleanedArgs._source) {
            delete cleanedArgs._source;
        }
        /**
         * @type {Resource}
         */
        const doc = this.createAuditEntry(
            {
                base_version, requestInfo, operation, ids, resourceType, cleanedArgs, maxNumberOfIds
            }
        );

        await this.preSaveManager.preSaveAsync({ resource: doc });
        this.queue.push({ doc, requestInfo });
    }

    /**
     * Flush
     * @return {Promise<void>}
     */
    async flushAsync () {
        if (this.queue.length === 0) {
            return;
        }
        const release = await mutex.acquire();
        let currentQueue = [];
        try {
            currentQueue = this.queue.splice(0, this.queue.length);
        } finally {
            release();
        }

        /**
         * Audit entries are always of resource type AuditEvent
         * @type {string}
         */
        const resourceType = 'AuditEvent';
        let requestId;

        /**
         * @type {Map<string,import('../dataLayer/bulkInsertUpdateEntry').BulkInsertUpdateEntry>}
         */
        const operationsMap = new Map();
        operationsMap.set(resourceType, []);
        const kafkaAuditEvents = [];

        for (const { doc, requestInfo } of currentQueue) {
            assertTypeEquals(doc, AuditEvent);
            ({ requestId } = requestInfo);

            if (this.configManager.enableAuditEventKafka) {
                kafkaAuditEvents.push({ data: doc.toJSONInternal(), requestId });
            }
            if (this.configManager.enableAuditEventMongoDB) {
                operationsMap.get(resourceType).push(
                    this.databaseBulkInserter.getOperationForResourceAsync({
                        requestId,
                        resourceType,
                        doc,
                        operationType: 'insert',
                        operation: {
                            insertOne: {
                                document: doc.toJSONInternal()
                            }
                        }
                    })
                );
            }
        }
        if (kafkaAuditEvents.length > 0) {
            await this.auditEventKafkaProducer.produce(kafkaAuditEvents);
        }
        if (operationsMap.get(resourceType).length > 0) {
            const requestInfo = currentQueue[0].requestInfo;
            /**
             * @type {import('../operations/common/mergeResultEntry').MergeResultEntry[]}
             */
            const mergeResults = await this.databaseBulkInserter.executeAsync({
                requestInfo,
                base_version: this.base_version,
                operationsMap,
                maintainOrder: false
            });
            /**
             * @type {import('../operations/common/mergeResultEntry').MergeResultEntry[]}
             */
            const mergeResultErrors = mergeResults.filter(m => m.issue);
            if (mergeResultErrors.length > 0) {
                logError('Error creating audit entries', {
                    error: mergeResultErrors,
                    source: 'flushAsync',
                    args: {
                        request: { id: requestId },
                        errors: mergeResultErrors
                    }
                });
            }
        }
    }
}

module.exports = {
    AuditLogger
};
