const { DatabaseExportManager } = require("../../dataLayer/databaseExportManager");
const { FhirLoggingManager } = require("../common/fhirLoggingManager");
const { ForbiddenError, NotFoundError } = require("../../utils/httpErrors");
const { ResourceMerger } = require('../common/resourceMerger');
const { ScopesManager } = require("../security/scopesManager");
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');
const { assertTypeEquals, assertIsValid } = require("../../utils/assertType");

class UpdateExportStatusOperation {
    /**
     * @typedef {Object} ConstructorParams
     * @property {ScopesManager} scopesManager
     * @property {FhirLoggingManager} fhirLoggingManager
     * @property {DatabaseExportManager} databaseExportManager
     * @property {ResourceMerger} resourceMerger
     * @param {ConstructorParams}
     */
    constructor({ scopesManager, fhirLoggingManager, databaseExportManager, resourceMerger }) {
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
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
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
            const { id, base_version } = args
            const exportResource = FhirResourceCreator.createByResourceType(body, 'ExportStatus');

            const fetchExportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                exportStatusId: id
            });

            if (!fetchExportStatusResource) {
                throw new NotFoundError(`ExportStatus resoure with id ${id} doesn't exists`);
            }

            let { updatedResource, patches } = await this.resourceMerger.mergeResourceAsync({
                base_version: base_version,
                requestInfo: requestInfo,
                currentResource: fetchExportStatusResource,
                resourceToMerge: exportResource,
                smartMerge: false,
                incrementVersion: false
            });

            if (updatedResource) {
                await this.databaseExportManager.updateExportStatusAsync({
                    exportStatusResource: exportResource
                });

                // log operation
                await this.fhirLoggingManager.logOperationSuccessAsync({
                    requestInfo,
                    args,
                    startTime,
                    action: currentOperationName
                });
            }

            return exportResource;
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
