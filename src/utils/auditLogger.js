/**
 * logs audit entries
 */
const { generateUUID } = require('./uid.util');
const { PostRequestProcessor } = require('./postRequestProcessor');
const { assertTypeEquals } = require('./assertType');
const { SecurityTagSystem } = require('./securityTagSystem');
const { logError } = require('../operations/common/logging');
const { Mutex } = require('async-mutex');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { ConfigManager } = require('./configManager');
const { FhirResourceWriteSerializer } = require('../fhir/fhirResourceWriteSerializer');
const { buildBulkWriteRequestContext } = require('../dataLayer/bulkWriteRequestContext');
const { PERSON_PROXY_PREFIX, AUTH_USER_TYPES, PURPOSE_OF_USE_SYSTEM } = require('../constants');
const { STATUS_CODES } = require('http');

const mutex = new Mutex();

/**
 * @param {Object} params
 * @param {Error} params.error
 * @param {number} params.statusCode
 * @return {string}
 */
function sanitizeOutcomeDesc({ error, statusCode }) {
    if (statusCode === 403) {
        return error.message
            || error.issue?.[0]?.diagnostics
            || error.issue?.[0]?.details?.text
            || 'Forbidden';
    }
    return STATUS_CODES[`${statusCode}`] || 'Internal Server Error';
}

class AuditLogger {
    /**
     * constructor
     * @typedef {Object} params
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {import('../dataLayer/fastDatabaseBulkInserter').FastDatabaseBulkInserter} databaseBulkInserter
     * @property {PreSaveManager} preSaveManager
     * @property {ConfigManager} configManager
     * @property {string} base_version
     *
     * @param {params}
     */
    constructor({
        postRequestProcessor,
        databaseBulkInserter,
        preSaveManager,
        configManager,
        base_version = '4_0_0'
    }) {
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        assertTypeEquals(preSaveManager, PreSaveManager);
        assertTypeEquals(configManager, ConfigManager);

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
         * @type {{doc: Object, requestInfo: import('./fhirRequestInfo').FhirRequestInfo}[]}
         */
        this.queue = [];
        this.base_version = base_version;
        this.maxIdsPerAuditEvent = configManager.maxIdsPerAuditEvent;
        this.enableAccessAuditEvent = configManager.enableAccessAuditEvent
        this.auditEventObserverOrganizationId = configManager.auditEventObserverOrganizationId;
    }

    /**
     * Builds the AuditEvent agent array from requestInfo.
     * Returns plain objects matching the FHIR AuditEvent.agent shape.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Object[]}
     */
    buildAgents (requestInfo) {
        const isUser = Boolean(requestInfo?.isUser);
        const whoReference = isUser
            ? { reference: `Patient/${PERSON_PROXY_PREFIX}${requestInfo.user}` }
            : undefined;

        if (requestInfo?.userType === AUTH_USER_TYPES.delegatedUser) {
            const consentPolicy = requestInfo.actor?.consentPolicy;
            return [
                {
                    who: whoReference,
                    altId: requestInfo?.alternateUserId,
                    requestor: false,
                    network: { type: '2' }
                },
                {
                    who: { reference: requestInfo.actor?.reference },
                    policy: consentPolicy ? [consentPolicy] : undefined,
                    altId: requestInfo.actor?.sub,
                    requestor: true,
                    network: {
                        address: requestInfo?.remoteIpAddress,
                        type: '2'
                    }
                }
            ];
        }

        const consentPolicy = requestInfo.actor?.consentPolicy;
        return [
            {
                who: whoReference,
                altId: requestInfo?.alternateUserId,
                requestor: true,
                policy: consentPolicy ? [consentPolicy] : undefined,
                network: {
                    address: requestInfo?.remoteIpAddress,
                    type: '2'
                }
            }
        ];
    }

    /**
     * Builds the AuditEvent fields shared by createAuditEntry and createErrorAuditEntry.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {Object}
     */
    _buildBaseAuditEvent (requestInfo) {
        const now = new Date();
        return {
            resourceType: 'AuditEvent',
            id: generateUUID(),
            meta: {
                versionId: '1',
                lastUpdated: now,
                security: [
                    { system: SecurityTagSystem.owner, code: 'bwell' },
                    { system: SecurityTagSystem.access, code: 'bwell' }
                ]
            },
            recorded: now,
            agent: this.buildAgents(requestInfo),
            source: {
                observer: {
                    reference: `Organization/${this.auditEventObserverOrganizationId}`
                }
            }
        };
    }

    /**
     * Builds the requestUrl/requestId detail entries shared by _buildEntityDetail and
     * createErrorAuditEntry.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @returns {{type: string, valueString: string}[]}
     */
    _buildRequestDetail (requestInfo) {
        const detail = [];
        if (requestInfo.originalUrl) {
            detail.push({ type: 'requestUrl', valueString: requestInfo.originalUrl });
        }
        if (requestInfo.requestId) {
            detail.push({ type: 'requestId', valueString: requestInfo.requestId });
        }
        return detail;
    }

    /**
     * Builds the entity[0].detail array, preserving the previous behavior of
     * blanking the `id` arg and filtering remaining args to strings.
     * @param {import('./fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {Object} args
     * @returns {{type: string, valueString: string}[]}
     */
    _buildEntityDetail (requestInfo, args) {
        const detail = this._buildRequestDetail(requestInfo);
        if (args) {
            for (const [key, value] of Object.entries(args)) {
                if (key === '_id' || key === '_source') continue;
                // Match prior semantics: id is blanked out; non-string args dropped.
                let v = value;
                if (key === 'id' && v) v = '';
                if (typeof v !== 'string') continue;
                detail.push({ type: key, valueString: v });
            }
        }
        return detail;
    }

    /**
     * Create an AuditEntry as a plain object.
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string} params.resourceType
     * @param {string} params.operation
     * @param {Object} params.args
     * @param {string[]} params.ids
     * @param {string} [params.outcome]
     * @param {string} [params.outcomeDesc]
     * @returns {Object}
     */
    createAuditEntry({ requestInfo, operation, ids, resourceType, args, outcome, outcomeDesc }) {
        const operationCodeMapping = {
            create: 'C',
            read: 'R',
            update: 'U',
            delete: 'D',
            execute: 'E'
        };

        const purposeOfEvent = requestInfo.purposeOfUse?.length
            ? requestInfo.purposeOfUse.map((code) => ({
                  coding: [{ system: PURPOSE_OF_USE_SYSTEM, code }]
              }))
            : undefined;

        const doc = {
            ...this._buildBaseAuditEvent(requestInfo),
            type: {
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: '110112',
                display: 'Query'
            },
            action: operationCodeMapping[`${operation}`],
            entity: ids.map((resourceId, index) => ({
                what: { reference: `${resourceType}/${resourceId}` },
                detail: index === 0 ? this._buildEntityDetail(requestInfo, args) : null
            })),
            purposeOfEvent
        };
        if (outcome !== undefined) {
            doc.outcome = outcome;
        }
        if (outcomeDesc !== undefined) {
            doc.outcomeDesc = outcomeDesc;
        }
        return doc;
    }

    /**
     * logs an entry for audit
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.resourceType
     * @param {string} params.operation
     * @param {Object} params.args
     * @param {string[]} params.ids
     * @param {string} [params.outcome]
     * @param {string} [params.outcomeDesc]
     * @return {Promise<void>}
     */
    async logAuditEntryAsync({
        requestInfo, base_version, resourceType, operation, args, ids, outcome, outcomeDesc
    }) {
        if (!this.enableAccessAuditEvent || resourceType === 'AuditEvent') {
            return;
        }

        // Stash only the required fields the bulk-write chain reads. The full
        // FhirRequestInfo (headers, body, scopes, user object, parsedArgs) would
        // otherwise stay alive in the queue until the next cron flush.
        const queueContext = buildBulkWriteRequestContext(requestInfo);

        const idBatches = [];
        for (let i = 0; i < ids.length; i += this.maxIdsPerAuditEvent) {
            idBatches.push(ids.slice(i, i + this.maxIdsPerAuditEvent));
        }
        if (idBatches.length === 0 && outcome !== undefined) {
            idBatches.push([]);
        }

        for (const idChunk of idBatches) {
            const doc = this.createAuditEntry({
                requestInfo,
                operation,
                ids: idChunk,
                resourceType,
                args,
                outcome,
                outcomeDesc
            });
            await this.preSaveManager.preSaveAsync({ resource: doc });
            const serialized = FhirResourceWriteSerializer.serialize({ obj: doc });
            this.queue.push({ doc: serialized, requestInfo: queueContext });
        }
    }

    /**
     * Creates an AuditEvent for an error response as a plain object.
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string|null} params.resourceType
     * @param {number} params.errorCode - HTTP status code (401, 403, 404, 500) or 0 for abort
     * @param {string} params.errorMessage
     * @param {{type: string, valueString: string}[]} [params.extraParams]
     * @returns {Object}
     */
    createErrorAuditEntry({ requestInfo, resourceType, errorCode, errorMessage, extraParams }) {
        const isSecurityError = errorCode === 401 || errorCode === 403;
        const type = isSecurityError
            ? {
                  system: 'http://dicom.nema.org/resources/ontology/DCM',
                  code: '110113',
                  display: 'Security Alert'
              }
            : {
                  system: 'http://terminology.hl7.org/CodeSystem/audit-event-type',
                  code: 'rest',
                  display: 'RESTful Operation'
              };
        const outcome = errorCode >= 500 ? '8' : '4';

        const detail = this._buildRequestDetail(requestInfo);
        if (extraParams) {
            for (const p of extraParams) detail.push(p);
        }
        const entity = detail.length > 0 ? [{ detail }] : undefined;

        return {
            ...this._buildBaseAuditEvent(requestInfo),
            type,
            action: 'E',
            outcome,
            outcomeDesc: errorMessage,
            entity
        };
    }

    /**
     * Logs an error audit entry
     * @param {Object} params
     * @param {import('./fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {string|null} params.resourceType
     * @param {number} params.errorCode
     * @param {string} params.errorMessage
     * @param {{type: string, valueString: string}[]} [params.extraParams]
     * @return {Promise<void>}
     */
    async logErrorAuditEntryAsync({
        requestInfo,
        resourceType,
        errorCode,
        errorMessage,
        extraParams
    }) {
        if (!this.enableAccessAuditEvent) {
            return;
        }

        const doc = this.createErrorAuditEntry({
            requestInfo,
            resourceType,
            errorCode,
            errorMessage,
            extraParams
        });
        await this.preSaveManager.preSaveAsync({ resource: doc });
        const serialized = FhirResourceWriteSerializer.serialize({ obj: doc });
        this.queue.push({
            doc: serialized,
            requestInfo: buildBulkWriteRequestContext(requestInfo)
        });
    }

    /**
     * Flush queued audit events to the database via the bulk inserter.
     * @return {Promise<void>}
     */
    async flushAsync() {
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
            ({ requestId } = requestInfo);

            operationsMap.get(resourceType).push(
                this.databaseBulkInserter.getOperationForResourceAsync({
                    requestId,
                    resourceType,
                    doc,
                    operationType: 'insert',
                    operation: { insertOne: { document: doc } }
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

            const mergeResultErrors = mergeResults.filter((m) => m.issue);
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
    AuditLogger,
    sanitizeOutcomeDesc
};
