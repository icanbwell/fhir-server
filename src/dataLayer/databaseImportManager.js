const moment = require('moment-timezone');
const ImportStatus = require('../fhir/classes/4_0_0/custom_resources/importStatus');
const { DatabaseQueryFactory } = require('./databaseQueryFactory');
const { RethrownError } = require('../utils/rethrownError');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { isUuid } = require('../utils/uid.util');
const { DatabaseUpdateFactory } = require('./databaseUpdateFactory');
const { PostSaveProcessor } = require('./postSaveProcessor');

class DatabaseImportManager {
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
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);
    }

    /**
     * @typedef {Object} GetImportStatusResourceWithIdParams
     * @property {string} [importStatusId]
     *
     * @param {GetImportStatusResourceWithIdParams}
     * @returns {Promise<import('../fhir/classes/4_0_0/custom_resources/importStatus')|null>}
     */
    async getImportStatusResourceWithId({ importStatusId }) {
        assertIsValid(importStatusId, 'importStatusId is required');
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'ImportStatus',
                base_version: '4_0_0'
            });

            const resource = await databaseQueryManager.findOneAsync({
                query: { [isUuid(importStatusId) ? '_uuid' : '_sourceId']: importStatusId }
            });

            return resource;
        } catch (err) {
            throw new RethrownError({
                message: `Error in getImportStatusResourceWithId: ${err.message}`,
                error: err,
                args: { importStatusId }
            });
        }
    }

    /**
     * @typedef {Object} InsertImportStatusAsyncParams
     * @property {import('../fhir/classes/4_0_0/custom_resources/importStatus')} importStatusResource
     * @property {string} requestId
     *
     * @param {InsertImportStatusAsyncParams}
     */
    async insertImportStatusAsync({ importStatusResource, requestId }) {
        assertTypeEquals(importStatusResource, ImportStatus);
        try {
            importStatusResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
            importStatusResource.meta.versionId = '1';

            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'ImportStatus',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.insertOneAsync({ doc: importStatusResource });
            await this.postSaveProcessor.afterSaveAsync({
                requestId,
                eventType: 'C',
                resourceType: 'ImportStatus',
                doc: importStatusResource
            });
        } catch (err) {
            throw new RethrownError({
                message: `Error in insertImportStatusAsync: ${err.message}`,
                error: err,
                args: { importStatusId: importStatusResource.id }
            });
        }
    }

    /**
     * @typedef {Object} UpdateImportStatusAsyncParams
     * @property {import('../fhir/classes/4_0_0/custom_resources/importStatus')} importStatusResource
     *
     * @param {UpdateImportStatusAsyncParams}
     */
    async updateImportStatusAsync({ importStatusResource }) {
        assertTypeEquals(importStatusResource, ImportStatus);
        try {
            importStatusResource.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
            importStatusResource.meta.versionId = `${parseInt(importStatusResource.meta.versionId) + 1}`;

            const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
                resourceType: 'ImportStatus',
                base_version: '4_0_0'
            });

            await databaseUpdateManager.updateOneAsync({ doc: importStatusResource });
        } catch (err) {
            throw new RethrownError({
                message: `Error in updateImportStatusAsync: ${err.message}`,
                error: err,
                args: { importStatusId: importStatusResource.id }
            });
        }
    }
}

module.exports = { DatabaseImportManager };
