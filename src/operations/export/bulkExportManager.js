const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { RethrownError } = require('../../utils/rethrownError');
const { assertTypeEquals, assertIsValid } = require('../../utils/assertType');
const { isUuid } = require('../../utils/uid.util');

class BulkExportManager {
    /**
     * @typedef {Object} ConstructorParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     *
     * @param {ConstructorParams}
     */
    constructor({ databaseQueryFactory }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * @typedef {Object} GetExportStatusResourceWithIdParams
     * @property {string} [exportStatusId]
     *
     * @param {GetExportStatusResourceWithIdParams}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async getExportStatusResourceWithId({ exportStatusId }) {
        assertIsValid(exportStatusId, 'exportStatusId is required');
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            /**
             * @type {import('../../fhir/classes/4_0_0/resources/resource')}
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
}

module.exports = { BulkExportManager };
