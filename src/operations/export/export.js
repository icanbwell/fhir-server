const moment = require('moment-timezone');
const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError, ForbiddenError, NotValidatedError } = require('../../utils/httpErrors');
const { DatabaseExportManager } = require('../../dataLayer/databaseExportManager');
const { ExportManager } = require('./exportManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { K8sClient } = require('../../utils/k8sClient');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ResourceValidator } = require('../common/resourceValidator');
const { ScopesManager } = require('../security/scopesManager');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { generateUUID } = require('../../utils/uid.util');
const { ConfigManager } = require('../../utils/configManager');


class ExportOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {PreSaveManager} preSaveManager
     * @property {ResourceValidator} resourceValidator
     * @property {ExportManager} exportManager
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {AuditLogger} auditLogger
     * @property {DatabaseExportManager} databaseExportManager
     * @property {K8sClient} k8sClient
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams}
     */
    constructor({
        scopesManager,
        fhirLoggingManager,
        preSaveManager,
        resourceValidator,
        exportManager,
        postRequestProcessor,
        auditLogger,
        databaseExportManager,
        k8sClient,
        configManager
    }) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {FhirLoggingManager}
         */
        this.fhirLoggingManager = fhirLoggingManager;
        assertTypeEquals(fhirLoggingManager, FhirLoggingManager);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);

        /**
         * @type {ExportManager}
         */
        this.exportManager = exportManager;
        assertTypeEquals(exportManager, ExportManager);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        /**
         * @type {DatabaseExportManager}
         */
        this.databaseExportManager = databaseExportManager;
        assertTypeEquals(databaseExportManager, DatabaseExportManager);

        /**
         * @type {K8sClient}
         */
        this.k8sClient = k8sClient;
        assertTypeEquals(k8sClient, K8sClient);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * does FHIR bulk export
     * @typedef {Object} ExportAsyncParams
     * @property {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @property {Object} args
     *
     * @param {ExportAsyncParams}
     * @returns {Promise<Resource>}
     */
    async exportAsync({ requestInfo, args }) {
        assertIsValid(requestInfo !== undefined);
        const currentOperationName = 'export';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string} */
            requestId,
            /** @type {Object | null} */
            body: incomingResource,
            /** @type {string} */
            user,
            /** @type {string} */
            scope,
            /** @type {string} */
            path
        } = requestInfo;

        /**
         * @type {string}
         */
        const currentDate = moment.utc().format('YYYY-MM-DD');

        const { base_version } = args;

        assertIsValid(requestId, 'requestId is null');

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError(`Bulk export cannot be triggered with patient scopes`);
        }

        try {
            if (!incomingResource || incomingResource.resourceType !== 'Parameters') {
                throw new BadRequestError(
                    new Error('Bulk request requires Parameters resource in the body')
                );
            }

            // generate uuid to avoid conflict
            incomingResource.id = generateUUID();

            const parametersResource = FhirResourceCreator.create(incomingResource);

            // validate parameter resource in body
            const validationOperationOutcome =
                this.resourceValidator.validateResourceMetaSync(parametersResource) ||
                (await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: parametersResource.id,
                    resourceType: parametersResource.resourceType,
                    resourceToValidate: incomingResource,
                    path,
                    currentDate
                }));

            if (validationOperationOutcome) {
                throw new NotValidatedError(validationOperationOutcome);
            }
            await this.preSaveManager.preSaveAsync({ resource: parametersResource });

            this.exportManager.validateSecurityTags({ user, scope, parametersResource });

            // Create ExportStatus resource
            const exportStatusResource = await this.exportManager.generateExportStatusResourceAsync({
                parametersResource,
                requestInfo
            });

            // Insert ExportStatus resource in database
            await this.databaseExportManager.insertExportStatusAsync({ exportStatusResource });

            // Trigger k8s job to export data
            await this.k8sClient.createJob(
                'node /srv/src/src/operations/export/script/bulkDataExport.js ' +
                `--exportStatusId ${exportStatusResource.id} ` +
                `--bulkExportS3BucketName ${this.configManager.bulkExportS3BucketName}`
            );

            // Logic to add auditEvent
            this.postRequestProcessor.add({
                requestId,
                fnTask: async () => {
                    await this.auditLogger.logAuditEntryAsync({
                        requestInfo,
                        base_version,
                        resourceType: 'ExportStatus',
                        operation: currentOperationName,
                        args,
                        ids: [parametersResource.id]
                    });
                }
            });

            // log operation
            await this.fhirLoggingManager.logOperationSuccessAsync({
                requestInfo,
                args,
                startTime,
                action: currentOperationName
            });

            return exportStatusResource;
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

module.exports = { ExportOperation };
