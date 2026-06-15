const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError, ForbiddenError } = require('../../utils/httpErrors');
const { DatabaseImportManager } = require('../../dataLayer/databaseImportManager');
const { ImportManager } = require('./importManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { ScopesManager } = require('../security/scopesManager');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { logInfo } = require('../common/logging');

class ImportOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {ImportManager} importManager
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {AuditLogger} auditLogger
     * @property {DatabaseImportManager} databaseImportManager
     *
     * @param {ConstructorParams}
     */
    constructor({
        scopesManager,
        fhirLoggingManager,
        importManager,
        postRequestProcessor,
        auditLogger,
        databaseImportManager
    }) {
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

        this.importManager = importManager;
        assertTypeEquals(importManager, ImportManager);

        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        this.databaseImportManager = databaseImportManager;
        assertTypeEquals(databaseImportManager, DatabaseImportManager);
    }

    /**
     * @typedef {Object} ImportAsyncParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Object} args
     *
     * @param {ImportAsyncParams}
     * @returns {Promise<Resource>}
     */
    async importAsync({ requestInfo, args }) {
        assertIsValid(requestInfo !== undefined);
        const currentOperationName = 'import';
        const startTime = Date.now();
        const {
            requestId,
            scope
        } = requestInfo;

        const { base_version, resource } = args;

        assertIsValid(requestId, 'requestId is null');

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError('Bulk import cannot be triggered with patient scopes');
        }

        const filepath = resource?.filepath;
        if (!filepath) {
            throw new BadRequestError('filepath is required in request body');
        }

        if (!filepath.startsWith('s3://')) {
            throw new BadRequestError('filepath must be an S3 URI (s3://...)');
        }

        const range = resource?.range;
        if (range) {
            if (typeof range.start !== 'number' || typeof range.end !== 'number') {
                throw new BadRequestError('range.start and range.end must be numbers');
            }
            if (range.start < 1) {
                throw new BadRequestError('range.start must be >= 1');
            }
            if (range.end < range.start) {
                throw new BadRequestError('range.end must be >= range.start');
            }
        }

        try {
            const importStatusResource = await this.importManager.generateImportStatusResourceAsync({
                requestInfo,
                filepath,
                range
            });

            await this.databaseImportManager.insertImportStatusAsync({
                importStatusResource,
                requestId
            });

            logInfo(
                `Created ImportStatus resource with Id: ${importStatusResource.id}`,
                { importStatusId: importStatusResource.id }
            );

            // Trigger K8s job to import data
            await this.importManager.triggerImportJob({ importStatusResource, requestId });

            const importStatusUuid = importStatusResource._uuid;
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.auditLogger.logAuditEntryAsync({
                        requestInfo,
                        base_version,
                        resourceType: 'ImportStatus',
                        operation: currentOperationName,
                        args,
                        ids: [importStatusUuid]
                    });
                }
            });

            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName
            });

            return importStatusResource;
        } catch (e) {
            await this.fhirLoggingManager.logOperationFailureAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName,
                error: e
            });
            throw e;
        }
    }
}

module.exports = { ImportOperation };
