const fs = require('fs');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { ReferenceParser } = require('../../utils/referenceParser');
const { RethrownError } = require('../../utils/rethrownError');
const { assertTypeEquals } = require('../../utils/assertType');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { IdentifierSystem } = require('../../utils/identifierSystem');

class GetMasterPatientUsageDataRunner extends BaseBulkOperationRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {string[]} collections
     * @property {string} csvFileName
     * @property {Object} args
     *
     * @param {ConstructorProps}
     */
    constructor ({
        databaseQueryFactory,
        collections,
        csvFileName,
        ...args
    }) {
        super(args);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {string[]}
         */
        this.collections = collections;

        /**
         * @type {string}
         */
        this.csvFileName = csvFileName;

        /**
         * @type {Set<string>}
         */
        this.masterPatientUuids = new Set();

        /**
         * @type {Map<string, { minLastUpdated: Date, minUuid: string, maxlastUpdated: Date, count: number, maxUuid: string }>}
         */
        this.usageData = new Map();
    }

    /**
     * Gets master patient uuids into masterPatientUuids set
     * @returns {Promise<void>}
     */
    async getMasterPatientUuids () {
        const query = {
            'meta.security': {
                $elemMatch: {
                    system: SecurityTagSystem.owner,
                    code: 'bwell'
                }
            }
        };

        const options = {
            projection: {
                _uuid: 1,
                _id: 0
            }
        };

        try {
            this.adminLogger.logInfo('Fetching master patient uuids');
            /**
             * @type {import('../../dataLayer/databaseQueryManager').DatabaseQueryManager}
             */
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const cursor = await databaseQueryManager.findAsync({
                query,
                options
            });

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                this.masterPatientUuids.add(doc._uuid);
            }
            this.adminLogger.logInfo('Master patient uuids fetched');
        } catch (error) {
            throw new RethrownError({
                message: `Error fetching master patient uuids: ${error.message}`,
                error,
                source: 'GetMasterPatientUsageDataRunner.getMasterPatientUuids'
            });
        }
    }

    /**
     * Checks if the reference has masterPatient uuid
     * @typedef {Object} HasUsageProps
     * @property {import('../../fhir/classes/4_0_0/complex_types/reference')} reference
     *
     * @param {HasUsageProps}
     * @returns {Boolean}
     */
    hasUsage ({ reference }) {
        // get uuids from reference
        const referenceUuid = reference.extension?.find(
            (s) => s.url === IdentifierSystem.uuid
        )?.valueString;
        // skip invalid uuids
        if (!referenceUuid) {
            return false;
        }
        const { id, resourceType } = ReferenceParser.parseReference(referenceUuid);
        if (resourceType === 'Patient' && this.masterPatientUuids.has(id)) {
            return true;
        }
        return false;
    }

    /**
     * Checks if the reference has masterPatient uuid or not
     * @typedef {Object} ProcessReferenceProps
     * @property {import('../../fhir/classes/4_0_0/complex_types/reference')} reference
     * @property {string} resourceType
     * @property {Date} lastUpdated
     * @property {string} uuid
     *
     * @param {ProcessReferenceProps}
     * @return {void}
     */
    processReference ({ reference, resourceType, lastUpdated, uuid }) {
        // skill invalid references
        if (!reference) {
            return false;
        }
        // Check if this reference has master patient usage
        if (this.hasUsage({ reference })) {
            if (!this.usageData.has(resourceType)) {
                this.usageData.set(resourceType, {
                    count: 1,
                    maxUuid: uuid,
                    maxlastUpdated: lastUpdated,
                    minUuid: uuid,
                    minLastUpdated: lastUpdated
                });
            } else {
                const currentData = this.usageData.get(resourceType);
                currentData.count++;
                if (currentData.maxlastUpdated < lastUpdated) {
                    currentData.maxlastUpdated = lastUpdated;
                    currentData.maxUuid = uuid;
                }
                if (currentData.minLastUpdated > lastUpdated) {
                    currentData.minLastUpdated = lastUpdated;
                    currentData.minUuid = uuid;
                }
            }
        }
    }

    /**
     * Gets MasterPatient usage data from the collection
     * @typedef {Object} ProcessCollectionAsyncProps
     * @property {string} collectionName
     *
     * @param {ProcessCollectionAsyncProps}
     * @returns {Promise<void>}
     */
    async processCollectionAsync ({ collectionName }) {
        /**
         * @type {string}
         */
        const resourceType = collectionName.replace('_4_0_0', '');

        try {
            this.adminLogger.logInfo(`Processing ${resourceType} resource`);
            /**
             * @type {import('../../dataLayer/databaseQueryManager').DatabaseQueryManager}
             */
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version: '4_0_0'
            });

            const cursor = await databaseQueryManager.findAsync({ query: {} });

            while (await cursor.hasNext()) {
                /**
                 * @type {import('../../fhir/classes/4_0_0/resources/resource')}
                 */
                const resource = await cursor.nextObject();

                await resource.updateReferencesAsync({
                    fnUpdateReferenceAsync: (reference) =>
                        this.processReference({
                            reference,
                            resourceType,
                            lastUpdated: resource.meta?.lastUpdated,
                            uuid: resource._uuid
                        })
                });
            }

            this.adminLogger.logInfo(`Finished Processing ${resourceType} resource`);
        } catch (error) {
            throw new RethrownError({
                message: `Error Processing resource ${resourceType}: ${error.message}`,
                error,
                source: 'GetMasterPatientUsageDataRunner.processCollectionAsync'
            });
        }
    }

    /**
     * Adds usage data into csv
     * @returns {Promise<void>}
     */
    async addUsageDataToCsv () {
        this.adminLogger.logInfo(`Exporting data to csv ${this.csvFileName}`);
        const writeStream = fs.createWriteStream(this.csvFileName);

        writeStream.write('Resource| Count| Uuid with min lastUpdated| Min LastUpdated| Uuid with max lastUpdated| Max LastUpdated|\n');
        for (const [resourceType, { count, minUuid, minLastUpdated, maxUuid, maxlastUpdated }] of this.usageData) {
            writeStream.write(
                `${resourceType}| ${count}| ${minUuid}| ${minLastUpdated.toISOString()}| ${maxUuid}| ${maxlastUpdated.toISOString()}|\n`
            );
        }
        writeStream.end();

        return new Promise((resolve) => writeStream.on('close', resolve));
    }

    /**
     * Main process
     * @returns {Promise<void>}
     */
    async processAsync () {
        try {
            await this.getMasterPatientUuids();

            if (this.collections.length === 1 && this.collections[0] === 'all') {
                this.collections = await this.getAllCollectionNamesAsync({});
            }
            for (const collectionName of this.collections) {
                await this.processCollectionAsync({ collectionName });
            }

            await this.addUsageDataToCsv();
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { error: e });
        }
    }
}

module.exports = { GetMasterPatientUsageDataRunner };
