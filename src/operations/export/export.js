const moment = require('moment-timezone');
const { AuditLogger } = require('../../utils/auditLogger');
const { BadRequestError, ForbiddenError, NotValidatedError } = require('../../utils/httpErrors');
const { BulkDataExportRunner } = require('./script/bulkDataExportRunner');
const { DatabaseExportManager } = require('../../dataLayer/databaseExportManager');
const { ExportManager } = require('./exportManager');
const { FhirLoggingManager } = require('../common/fhirLoggingManager');
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { PostRequestProcessor } = require('../../utils/postRequestProcessor');
const { PreSaveManager } = require('../../preSaveHandlers/preSave');
const { ResourceValidator } = require('../common/resourceValidator');
const { ScopesManager } = require('../security/scopesManager');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { generateUUID } = require('../../utils/uid.util');
const { AdminLogger } = require('../../admin/adminLogger');


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
        databaseQueryFactory,
        patientFilterManager,
        databaseAttachmentManager,
        securityTagManager,
        r4SearchQueryCreator,
        patientQueryCreator
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

        this.databaseQueryFactory = databaseQueryFactory;
        this.patientFilterManager = patientFilterManager;
        this.databaseAttachmentManager = databaseAttachmentManager;
        this.securityTagManager = securityTagManager;
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        this.patientQueryCreator = patientQueryCreator;
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

            const parameterResource = FhirResourceCreator.create(incomingResource);

            // validate parameter resource in body
            const validationOperationOutcome =
                this.resourceValidator.validateResourceMetaSync(parameterResource) ||
                (await this.resourceValidator.validateResourceAsync({
                    base_version,
                    requestInfo,
                    id: parameterResource.id,
                    resourceType: parameterResource.resourceType,
                    resourceToValidate: incomingResource,
                    path,
                    currentDate
                }));

            if (validationOperationOutcome) {
                throw new NotValidatedError(validationOperationOutcome);
            }
            await this.preSaveManager.preSaveAsync({ resource: parameterResource });

            // Create ExportStatus resource
            const exportStatusResource = await this.exportManager.generateExportStatusResourceAsync({
                parameterResource,
                requestInfo
            });

            // Insert ExportStatus resource in database
            await this.databaseExportManager.insertExportStatusAsync({ exportStatusResource });

            // TODO: trigger eks job from here
            const bulkDataExportRunner = new BulkDataExportRunner({
                databaseQueryFactory: this.databaseQueryFactory,
                adminLogger: new AdminLogger(),
                patientFilterManager: this.patientFilterManager,
                databaseExportManager: this.databaseExportManager,
                databaseAttachmentManager: this.databaseAttachmentManager,
                securityTagManager: this.securityTagManager,
                r4SearchQueryCreator: this.r4SearchQueryCreator,
                patientQueryCreator: this.patientQueryCreator,
                exportStatusId: exportStatusResource.id,
                batchSize: 100
            });

            await bulkDataExportRunner.processAsync();

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
                        ids: [parameterResource.id]
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
