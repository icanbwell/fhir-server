const { logInfo, logError } = require('../operations/common/logging');
const { DatabaseExportManager } = require('../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { assertTypeEquals } = require('../utils/assertType');
const { RethrownError } = require('../utils/rethrownError');
const { DatabaseQueryManager } = require('../dataLayer/databaseQueryManager');
const { EXPORTSTATUS_LAST_UPDATED_DEFAULT_TIME } = require('../constants');
const { ExportManager } = require('../operations/export/exportManager');
const { ConfigManager } = require('../utils/configManager');
const { PostSaveProcessor } = require('../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../utils/bulkExportEventProducer');
const { K8sClient } = require('../utils/k8sClient');

class CronJobRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseExportManager} databaseExportManager
     * @property {ExportManager} exportManager
     * @property {ConfigManager} configManager
     * @property {PostSaveProcessor} postSaveProcessor
     * @property {BulkExportEventProducer} bulkExportEventProducer
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        databaseExportManager,
        exportManager,
        configManager,
        postSaveProcessor,
        bulkExportEventProducer,
        k8sClient
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
         * @type {ExportManager}
         */
        this.exportManager = exportManager;
        assertTypeEquals(exportManager, ExportManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {PostSaveProcessor}
         */
        this.postSaveProcessor = postSaveProcessor;
        assertTypeEquals(postSaveProcessor, PostSaveProcessor);

        /**
         * @type {BulkExportEventProducer}
         */
        this.bulkExportEventProducer = bulkExportEventProducer;
        assertTypeEquals(bulkExportEventProducer, BulkExportEventProducer);

        /**
         * @type {K8sClient}
         */
        this.k8sClient = k8sClient;
        assertTypeEquals(k8sClient, K8sClient);
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
            await this.triggerHistoryMigrationJob();
        } catch (err) {
            logError(`Error in processAsync: ${err.message}`, {
                error: err.stack
            });
        }
    }

    async triggerHistoryMigrationJob() {
        for (const collection of this.configManager.cloudStorageHistoryResources) {
            let scriptCommand =
            'node /srv/src/src/operations/history/script/migrateToCloudStorage.js ' +
            `--collection=${collection}_4_0_0_History ` +
            `--limit=${this.configManager.historyResourceCronJobMigrationLimit}`;

            const jobResult = await this.k8sClient.createJob({
                scriptCommand,
                context: {}
            });

            // Break the loop if the job limit is exceeded
            if (!jobResult) {
                logInfo(
                    'Maximum number of active jobs reached in the namespace, stopping History Migration job creation.'
                );
                break;
            }
            logInfo(`Successfully triggered History Migration k8sclient Job for: ${collection}`);
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
                const exportStatusResource = await exportStatusCursor.nextObject();
                logInfo(
                    `Triggering k8 job for ExportStatus resource with id: ${exportStatusResource._uuid}`,
                    { exportStatusId: exportStatusResource._uuid }
                );

                // Trigger k8s job to export data
                const jobResult = await this.exportManager.triggerExportJob({
                    exportStatusResource,
                    requestId: this.configManager.hostnameValue
                });

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
                const exportStatusResource = await exportStatusCursor.nextObject();
                logInfo(
                    `ExportStatus resource marked as entered-in-error with Id: ${exportStatusResource._uuid}`,
                    { exportStatusId: exportStatusResource._uuid }
                );
                exportStatusResource.status = 'entered-in-error';
                await this.databaseExportManager.updateExportStatusAsync({
                    exportStatusResource
                });
                await this.postSaveProcessor.afterSaveAsync({
                    requestId: this.configManager.hostnameValue,
                    eventType: 'U',
                    resourceType: 'ExportStatus',
                    doc: exportStatusResource
                });
                await this.bulkExportEventProducer.produce({
                    resource: exportStatusResource,
                    requestId: this.configManager.hostnameValue
                });
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
