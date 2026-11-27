const { DatabaseExportManager } = require("../../dataLayer/databaseExportManager");
const { FhirLoggingManager } = require("../common/fhirLoggingManager");
const { ForbiddenError, NotFoundError } = require("../../utils/httpErrors");
const { ScopesManager } = require("../security/scopesManager");
const { AuditLogger } = require("../../utils/auditLogger");
const { PostRequestProcessor } = require("../../utils/postRequestProcessor");
const { assertTypeEquals, assertIsValid } = require("../../utils/assertType");

class ExportByIdOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {DatabaseExportManager} databaseExportManager
     * @property {AuditLogger} auditLogger
     * @property {PostRequestProcessor} postRequestProcessor
     *
     * @param {ConstructorParams}
     */
    constructor({ scopesManager, fhirLoggingManager, databaseExportManager, auditLogger, postRequestProcessor }) {
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
         * @type {DatabaseExportManager}
         */
        this.databaseExportManager = databaseExportManager;
        assertTypeEquals(databaseExportManager, DatabaseExportManager);

        /**
         * @type {AuditLogger}
         */
        this.auditLogger = auditLogger;
        assertTypeEquals(auditLogger, AuditLogger);

        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
    }

    async exportByIdAsync({ requestInfo, args }) {
        assertIsValid(requestInfo !== undefined);
        const currentOperationName = 'exportById';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string} */
            requestId,
            /** @type {string} */
            scope,
            /** @type {string} */
            user
        } = requestInfo;

        const { id } = args;

        assertIsValid(requestId, 'requestId is null');

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError('Bulk export status can not be accessed via patient scopes');
        }

        try {
            const exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                exportStatusId: id,
                scope,
                user
            });

            // ExportStatus carries no tenant/access security tag (every job is tagged owner=bwell
            // regardless of requester) — the only record of who may check on it is the `user` who
            // started it, so ownership is checked against that instead. A mismatch returns the
            // same not-found response as a truly nonexistent id, rather than confirming that a
            // guessed/enumerated export id belongs to someone else.
            if (!exportStatusResource || exportStatusResource.user !== user) {
                throw new NotFoundError(`ExportStatus resoure with id ${id} doesn't exists`);
            }

            // ExportStatus is always created with a platform-level owner tag (see
            // ExportManager.generateExportStatusResourceAsync) regardless of the triggering
            // tenant, so access is gated on the access tag only. Denied access is reported the
            // same way as a missing resource to avoid leaking existence via status code.
            if (!this.scopesManager.isAccessToResourceAllowedByAccessTagOnly({
                resource: exportStatusResource,
                user,
                scope,
                accessRequested: 'r'
            })) {
                throw new NotFoundError(`ExportStatus resoure with id ${id} doesn't exists`);
            }

            // Only a completed export returns its output (the file list whose contents hold PHI), so
            // only that response is audited. In-progress polls return no data and are not audited.
            if (exportStatusResource.status === 'completed') {
                this.postRequestProcessor.add({
                    requestId,
                    fnTask: async () => {
                        await this.auditLogger.logAuditEntryAsync({
                            requestInfo,
                            base_version: '4_0_0',
                            resourceType: 'ExportStatus',
                            operation: 'read',
                            args,
                            ids: [exportStatusResource._uuid]
                        });
                    }
                });
            }

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

module.exports = { ExportByIdOperation };
