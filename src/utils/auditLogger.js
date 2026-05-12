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
const CodeableConcept = require('../fhir/classes/4_0_0/complex_types/codeableConcept');
const AuditEventAgent = require('../fhir/classes/4_0_0/backbone_elements/auditEventAgent');
const AuditEventSource = require('../fhir/classes/4_0_0/backbone_elements/auditEventSource');
const AuditEventEntity = require('../fhir/classes/4_0_0/backbone_elements/auditEventEntity');
const AuditEventNetwork = require('../fhir/classes/4_0_0/backbone_elements/auditEventNetwork');
const { Mutex } = require('async-mutex');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { ConfigManager } = require('./configManager');
const { PERSON_PROXY_PREFIX, AUTH_USER_TYPES, PURPOSE_OF_USE_SYSTEM } = require('../constants');
const mutex = new Mutex();

class AuditLogger {
    /**
     * constructor
     * @typedef {Object} params
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {DatabaseBulkInserter} databaseBulkInserter
     * @property {PreSaveManager} preSaveManager
     * @property {ConfigManager} configManager
     * @property {string} base_version
     *
     * @param {params}
     */
    constructor ({
                    postRequestProcessor,
                    databaseBulkInserter,
                    preSaveManager,
                    configManager,
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
         * @type {{doc: import('../fhir/classes/4_0_0/resources/resource'), requestInfo: import('./fhirRequestInfo').FhirRequestInfo}[]}
         */
        this.queue = [];
        /**
         * @type {string}
         */
        this.base_version = base_version;
        /**
         * @type {number}
         */
        this.maxIdsPerAuditEvent = this.configManager.maxIdsPerAuditEvent;
    }

    /**
     * Builds agent array and source from requestInfo
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {{agents: AuditEventAgent[], whoReference: Reference|undefined}}
     */
    buildAgents (requestInfo) {
        const isUser = Boolean(requestInfo?.isUser);
        const whoReference = isUser
            ? new Reference({ reference: `Patient/${PERSON_PROXY_PREFIX}${requestInfo.user}` })
            : undefined;

        const hasDelegatedActor = requestInfo?.userType === AUTH_USER_TYPES.delegatedUser;
        const alternateId = requestInfo?.alternateUserId;

        let agents;
        if (hasDelegatedActor) {
            const consentPolicy = requestInfo.actor.consentPolicy;
            agents = [
                new AuditEventAgent({
                    who: whoReference,
                    altId: alternateId,
                    requestor: false,
                    network: new AuditEventNetwork({
                        type: '2'
                    })
                }),
                new AuditEventAgent({
                    who: new Reference({
                        reference: requestInfo.actor?.reference
                    }),
                    policy: consentPolicy ? [consentPolicy] : undefined,
                    altId: requestInfo.actor?.sub,
                    requestor: true,
                    network: new AuditEventNetwork({
                        address: requestInfo?.remoteIpAddress,
                        type: '2'
                    })
                })
            ];
        } else {
            const consentPolicy = requestInfo.actor?.consentPolicy;
            agents = [
                new AuditEventAgent({
                    who: whoReference,
                    altId: alternateId,
                    requestor: true,
                    policy: consentPolicy ? [consentPolicy] : undefined,
                    network: new AuditEventNetwork({
                        address: requestInfo?.remoteIpAddress,
                        type: '2'
                    })
                })
            ];
        }

        return { agents, whoReference };
    }

    /**
     * Create an AuditEntry resource
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string} params.resourceType
     * @param {string} params.operation
     * @param {Object} params.cleanedArgs
     * @param {string[]} params.ids
     * @returns {AuditEvent}
     */
    createAuditEntry (
        {
            requestInfo, operation,
            ids, resourceType, cleanedArgs
        }
    ) {
        const operationCodeMapping = {
            create: 'C',
            read: 'R',
            update: 'U',
            delete: 'D',
            execute: 'E'
        };

        const { agents, whoReference } = this.buildAgents(requestInfo);

        const purposeOfEvent = requestInfo.purposeOfUse?.length
            ? requestInfo.purposeOfUse.map(code => new CodeableConcept({
                coding: [new Coding({ system: PURPOSE_OF_USE_SYSTEM, code })]
            }))
            : undefined;

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
            agent: agents,
            source: new AuditEventSource({
                    observer: new Reference({
                        reference: `Organization/${this.configManager.auditEventObserverOrganizationId}`
                    })
                }),
            action: operationCodeMapping[`${operation}`],
            entity: ids.map((resourceId, index) => {
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
            }),
            purposeOfEvent
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
    async logAuditEntryAsync ({
        requestInfo, base_version, resourceType, operation, args, ids
    }) {
        if (!this.configManager.enableAccessAuditEvent || resourceType === 'AuditEvent') {
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

        for (let i = 0; i < ids.length; i += this.maxIdsPerAuditEvent) {
            const idChunk = ids.slice(i, i + this.maxIdsPerAuditEvent);
            /**
             * @type {Resource}
             */
            const doc = this.createAuditEntry(
                {
                    base_version, requestInfo, operation, ids: idChunk, resourceType, cleanedArgs
                }
            );

            await this.preSaveManager.preSaveAsync({ resource: doc });
            this.queue.push({ doc, requestInfo });
        }
    }

    /**
     * Creates an AuditEvent for an error response
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string|null} params.resourceType
     * @param {number} params.errorCode - HTTP status code (401, 403, 404, 500) or 0 for abort
     * @param {string} params.errorMessage
     * @returns {AuditEvent}
     */
    createErrorAuditEntry ({ requestInfo, resourceType, errorCode, errorMessage }) {
        const originalUrl = requestInfo.originalUrl;
        const requestId = requestInfo.requestId;
        const securityAlertType = new Coding({
            system: 'http://dicom.nema.org/resources/ontology/DCM',
            code: '110113',
            display: 'Security Alert'
        });

        const restType = new Coding({
            system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
            code: 'rest',
            display: 'RESTful Operation'
        });

        const isSecurityError = errorCode === 401 || errorCode === 403;
        const type = isSecurityError ? securityAlertType : restType;
        const outcome = errorCode >= 500 ? '8' : '4';

        const { agents, whoReference } = this.buildAgents(requestInfo);

        const detail = [
            ...(originalUrl ? [{ type: 'requestUrl', valueString: originalUrl }] : []),
            ...(requestId ? [{ type: 'requestId', valueString: requestId }] : [])
        ];
        const entity = detail.length > 0 ? [
            new AuditEventEntity({ detail })
        ] : undefined;

        return new AuditEvent({
            id: generateUUID(),
            meta: new Meta({
                versionId: '1',
                lastUpdated: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
                security: [
                    new Coding({ system: SecurityTagSystem.owner, code: 'bwell' }),
                    new Coding({ system: SecurityTagSystem.access, code: 'bwell' })
                ]
            }),
            recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ')),
            type,
            action: 'E',
            outcome,
            outcomeDesc: errorMessage,
            agent: agents,
            source: new AuditEventSource({
                observer: new Reference({
                    reference: `Organization/${this.configManager.auditEventObserverOrganizationId}`
                })
            }),
            entity
        });
    }


    /**
     * Logs an error audit entry
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string|null} params.resourceType
     * @param {number} params.errorCode
     * @param {string} params.errorMessage
     * @return {Promise<void>}
     */
    async logErrorAuditEntryAsync ({
        requestInfo, resourceType,
        errorCode, errorMessage
    }) {
        if (!this.configManager.enableAccessAuditEvent) {
            return;
        }

        const doc = this.createErrorAuditEntry({
            requestInfo, resourceType, errorCode, errorMessage
        });

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

        const resourceType = 'AuditEvent';
        let requestId;

        const operationsMap = new Map();
        operationsMap.set(resourceType, []);

        for (const { doc, requestInfo } of currentQueue) {
            assertTypeEquals(doc, AuditEvent);
            ({ requestId } = requestInfo);

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

        if (operationsMap.get(resourceType).length > 0) {
            const requestInfo = currentQueue[0].requestInfo;
            const mergeResults = await this.databaseBulkInserter.executeAsync({
                requestInfo,
                base_version: this.base_version,
                operationsMap,
                maintainOrder: false
            });

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
