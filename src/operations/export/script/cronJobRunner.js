const { logInfo, logError } = require('../../common/logging');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { K8sClient } = require('../../../utils/k8sClient');
const { RethrownError } = require('../../../utils/rethrownError');
const { DatabaseQueryManager } = require('../../../dataLayer/databaseQueryManager');
const { EXPORTSTATUS_LAST_UPDATED_DEFAULT_TIME } = require('../../../constants');

class CronJobRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseExportManager} databaseExportManager
     * @property {K8sClient} k8sClient
     * @property {ConfigManager} configManager
     *
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        databaseExportManager,
        k8sClient,
        configManager
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {DatabaseExportManager}
         */
        this.databaseExportManager = databaseExportManager;
        assertTypeEquals(databaseExportManager, DatabaseExportManager);

        /**
         * @type {K8sClient}
         */
        this.k8sClient = k8sClient;
        assertTypeEquals(k8sClient, K8sClient);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Main function
     */
    async processAsync() {
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'ExportStatus',
                base_version: '4_0_0'
            });

            await this.triggerK8JobForAcceptedResources({ databaseQueryManager });
            await this.updateInProgressResources({ databaseQueryManager });
        } catch (err) {
            logError(`Error in processAsync: ${err.message}`, {
                error: err.stack
            });
        }
    }

    /**
     * Function to fetch and trigger k8 job for all ExportStatus resources with accepted status
     * @typedef {Object} TriggerK8JobForAcceptedResourcesParams
     * @property {DatabaseQueryManager} databaseQueryManager
     *
     * @param {TriggerK8JobForAcceptedResourcesParams}
     */
    async triggerK8JobForAcceptedResources({ databaseQueryManager }) {
        try {
            // Query to fetch ExportStatus resources with accepted status & sorted from oldest to newest
            const query = {
                query: { status: 'accepted' },
                options: {
                    sort: { transactionTime: 1 },
                    projection: { _uuid: 1 }
                }
            };

            logInfo(`Fetching ExportStatus resource with query: ${JSON.stringify(query)}`);
            const exportStatusCursor = await databaseQueryManager.findAsync(query);

            while (await exportStatusCursor.hasNext()) {
                const exportStatusData = await exportStatusCursor.next();
                logInfo(
                    `Triggering k8 job for ExportStatus resource with id: ${exportStatusData._uuid}`
                );

                // Trigger k8s job to export data
                const jobResult = await this.k8sClient.createJob(
                    'node /srv/src/src/operations/export/script/bulkDataExport.js ' +
                        `--exportStatusId ${exportStatusData._uuid} ` +
                        `--bulkExportS3BucketName ${this.configManager.bulkExportS3BucketName} ` +
                        `--awsRegion ${this.configManager.awsRegion}`
                );

                // Break the loop if the job limit is exceeded
                if (!jobResult) {
                    logInfo(
                        'Maximum number of active jobs reached in the namespace, stopping job creation for the remaining resources'
                    );
                    break;
                }
            }
            logInfo(
                'Successfully finished triggering k8 job for the ExportStatus resources with accepted status'
            );
        } catch (err) {
            logError(`Error in triggerK8JobForAcceptedResources: ${err.message}`, {
                error: err.stack
            });
            throw new RethrownError({
                message: err.message,
                source: 'CronJobRunner.triggerK8JobForAcceptedResources',
                error: err
            });
        }
    }

    /**
     * Function to fetch ExportStatus resources with in-progress status & in same state for the specified time
     * @typedef {Object} TriggerK8JobForAcceptedResourcesParams
     * @property {DatabaseQueryManager} databaseQueryManager
     *
     * @param {TriggerK8JobForAcceptedResourcesParams}
     */
    async updateInProgressResources({ databaseQueryManager }) {
        try {
            // Query to fetch ExportStatus resources with in-progress status from the specified time
            const query = {
                status: 'in-progress',
                'meta.lastUpdated': { $lt: new Date(Date.now() - EXPORTSTATUS_LAST_UPDATED_DEFAULT_TIME) }
            };

            logInfo(`Fetching ExportStatus resource with query: ${JSON.stringify(query)}`);
            const exportStatusCursor = await databaseQueryManager.findAsync({ query });

            // Setting status to 'entered-in-error' for the above fetched resources
            while (await exportStatusCursor.hasNext()) {
                const exportStatusResource = await exportStatusCursor.next();
                logInfo(
                    `Updating status to 'entered-in-error' for ExportStatus resource with id: ${exportStatusResource._uuid}`
                );
                exportStatusResource.status = 'entered-in-error';
                await this.databaseExportManager.updateExportStatusAsync({ exportStatusResource });
            }
            logInfo(
                `Successfully finished updating status to 'entered-in-error' for the fetched ExportStatus resources`
            );
        } catch (err) {
            logError(`Error in updateInProgressResources: ${err.message}`, {
                error: err.stack
            });
            throw new RethrownError({
                message: err.message,
                source: 'CronJobRunner.updateInProgressResources',
                error: err
            });
        }
    }
}

module.exports = { CronJobRunner };
