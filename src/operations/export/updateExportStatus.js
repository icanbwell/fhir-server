const { DatabaseExportManager } = require("../../dataLayer/databaseExportManager");
const { FhirLoggingManager } = require("../common/fhirLoggingManager");
const { ForbiddenError, NotFoundError } = require("../../utils/httpErrors");
const { ScopesManager } = require("../security/scopesManager");
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { assertTypeEquals, assertIsValid } = require("../../utils/assertType");

class UpdateExportStatusOperation {
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

    async updateExportStatusAsync({ requestInfo, args }) {

        assertIsValid(requestInfo !== undefined);
        const currentOperationName = 'updateExportStatus';
        /**
         * @type {number}
         */
        const startTime = Date.now();
        const {
            /** @type {string} */
            scope,
            /** @type {Object | Object[] | null} */
            body
        } = requestInfo;

        if (this.scopesManager.hasPatientScope({ scope })) {
            throw new ForbiddenError('Bulk export status can not be accessed via patient scopes');
        }

        try {
            const {id} = args
            const exportResource = FhirResourceCreator.createByResourceType(body, 'ExportStatus');

            const exportStatusResource = await this.databaseExportManager.updateExportStatusAsync({
                exportStatusResource: exportResource
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

module.exports = { UpdateExportStatusOperation };
