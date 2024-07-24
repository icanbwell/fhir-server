const moment = require('moment-timezone');
const ExportStatus = require('../fhir/classes/4_0_0/custom_resources/exportStatus');
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
     * @returns {Promise<import('../fhir/classes/4_0_0/custom_resources/exportStatus')|null>}
     */
    async getExportStatusResourceWithId({ exportStatusId }) {
        assertIsValid(exportStatusId, 'exportStatusId is required');
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            /**
             * @type {import('../fhir/classes/4_0_0/resources/resource')|null}
             */
            const resource = await databaseQueryManager.findOneAsync({
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
     * @property {import('../fhir/classes/4_0_0/custom_resources/exportStatus')} exportStatusResource
     * @property {string} requestId
     *
     * @param {InsertExportStatusAsyncParams}
     */
    async insertExportStatusAsync({ exportStatusResource, requestId }) {
        assertTypeEquals(exportStatusResource, ExportStatus);
        try {
            // Update meta.lastUpdated
            exportStatusResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            exportStatusResource.meta.version = '1';

            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.insertOneAsync({ doc: exportStatusResource });
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
     * @property {import('../fhir/classes/4_0_0/custom_resources/exportStatus')} exportStatusResource
     *
     * @param {UpdateExportStatusAsyncParams}
     */
    async updateExportStatusAsync({ exportStatusResource }) {
        assertTypeEquals(exportStatusResource, ExportStatus);
        try {
            // Update meta.lastUpdated
            exportStatusResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            exportStatusResource.meta.versionId = `${parseInt(exportStatusResource.meta.versionId) + 1}`;

            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.updateOneAsync({ doc: exportStatusResource });
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
