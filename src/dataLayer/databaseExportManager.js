const moment = require('moment-timezone');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../fhir/fhirResourceWriteSerializer');
const { DatabaseQueryFactory } = require('./databaseQueryFactory');
const { RethrownError } = require('../utils/rethrownError');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { isUuid } = require('../utils/uid.util');
const { DatabaseUpdateFactory } = require('./databaseUpdateFactory');
const { PostSaveProcessor } = require('./postSaveProcessor');

class DatabaseExportManager {
    /**
     * @typedef {Object} ConstructorParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseUpdateFactory} databaseUpdateFactory
     * @property {PostSaveProcessor} postSaveProcessor
     *
     * @param {ConstructorParams}
     */
    constructor({ databaseQueryFactory, databaseUpdateFactory, postSaveProcessor }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
    }

    /**
     * @typedef {Object} GetExportStatusResourceWithIdParams
     * @property {string} [exportStatusId]
     *
     * @param {GetExportStatusResourceWithIdParams}
     * @returns {Promise<Object|null>}
     */
    async getExportStatusResourceWithId({ exportStatusId }) {
        assertIsValid(exportStatusId, 'exportStatusId is required');
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            /**
             * @type {Object|null}
             */
            const resource = await databaseQueryManager.fastFindOneAsync({
                query: { [isUuid(exportStatusId) ? '_uuid' : '_sourceId']: exportStatusId }
            });

            return resource;
        } catch (err) {
            throw new RethrownError({
                message: `Error in getExportStatusResourceWithId: ${err.message}`,
                error: err,
                args: { exportStatusId }
            });
        }
    }

    /**
     * @typedef {Object} InsertExportStatusAsyncParams
     * @property {Object} exportStatusResource
     * @property {string} requestId
     *
     * @param {InsertExportStatusAsyncParams}
     */
    async insertExportStatusAsync({ exportStatusResource, requestId }) {
        try {
            exportStatusResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));

            const databaseUpdateManager = this.databaseUpdateFactory.createFastDatabaseUpdateManager({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.insertOneAsync({
                doc: FhirResourceWriteSerializer.serialize({ obj: deepcopy(exportStatusResource) })
            });
            await this.postSaveProcessor.afterSaveAsync({
                requestId,
                eventType: 'C',
                resourceType: 'ExportStatus',
                doc: exportStatusResource
            });
        } catch (err) {
            throw new RethrownError({
                message: `Error in insertExportStatusAsync: ${err.message}`,
                error: err,
                args: { exportStatusId: exportStatusResource.id }
            });
        }
    }

    /**
     * @typedef {Object} UpdateExportStatusAsyncParams
     * @property {Object} exportStatusResource
     *
     * @param {UpdateExportStatusAsyncParams}
     */
    async updateExportStatusAsync({ exportStatusResource }) {
        try {
            exportStatusResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
            exportStatusResource.meta.versionId = `${parseInt(exportStatusResource.meta.versionId) + 1}`;

            const databaseUpdateManager = this.databaseUpdateFactory.createFastDatabaseUpdateManager({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.updateOneAsync({
                doc: FhirResourceWriteSerializer.serialize({ obj: deepcopy(exportStatusResource) })
            });
        } catch (err) {
            throw new RethrownError({
                message: `Error in updateExportStatusAsync: ${err.message}`,
                error: err,
                args: { exportStatusId: exportStatusResource.id }
            });
        }
    }
}

module.exports = { DatabaseExportManager };
