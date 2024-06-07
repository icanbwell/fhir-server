const { DatabaseExportManager } = require("../../dataLayer/databaseExportManager");
const { FhirLoggingManager } = require("../common/fhirLoggingManager");
const { ForbiddenError, NotFoundError } = require("../../utils/httpErrors");
const { ScopesManager } = require("../security/scopesManager");
const { assertTypeEquals, assertIsValid } = require("../../utils/assertType");

class ExportByIdOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {DatabaseExportManager} databaseExportManager
     *
     * @param {ConstructorParams}
     */
    constructor({ scopesManager, fhirLoggingManager, databaseExportManager }) {
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
            scope
        } = requestInfo;

        const { id } = args;

        assertIsValid(requestId, 'requestId is null');

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError('Bulk export status can not be accessed via patient scopes');
        }

        try {
            const exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                exportStatusId: id
            });

            if (!exportStatusResource) {
                throw new NotFoundError(`ExportStatus resoure with id ${id} doesn't exists`);
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
