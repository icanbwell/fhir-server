const fs = require('fs');
const moment = require('moment-timezone');
const { AdminLogger } = require('../../../admin/adminLogger');
const { BulkExportManager } = require('../bulkExportManager');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { RethrownError } = require('../../../utils/rethrownError');
const { SecurityTagManager } = require('../../common/securityTagManager');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { COLLECTION, GRIDFS } = require('../../../constants');

class BulkDataExportRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {BulkExportManager} bulkExportManager
     * @property {PatientFilterManager} patientFilterManager
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {SecurityTagManager} securityTagManager
     * @property {AdminLogger} adminLogger
     * @property {string} exportStatusId
     *
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        bulkExportManager,
        patientFilterManager,
        databaseAttachmentManager,
        securityTagManager,
        adminLogger,
        exportStatusId
    }) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {BulkExportManager}
         */
        this.bulkExportManager = bulkExportManager;
        assertTypeEquals(bulkExportManager, BulkExportManager);

        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);

        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);

        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {AdminLogger}
         */
        this.adminLogger = adminLogger;
        assertTypeEquals(adminLogger, AdminLogger);

        /**
         * @type {string}
         */
        this.exportStatusId = exportStatusId;
        assertIsValid(exportStatusId, 'exportStatusId is required for running BulkExport');
    }

    /**
     * main process
     */
    async processAsync() {
        try {
            const exportStatusResource =
                await this.bulkExportManager.getExportStatusResourceWithId({
                    exportStatusId: this.exportStatusId
                });

            if (!exportStatusResource) {
                this.adminLogger.logInfo(
                    `ExportStatus resource not found with Id: ${this.exportStatusId}`
                );
                return;
            }

            const { pathname, searchParams } = new URL(exportStatusResource.requestUrl);

            let query = this.getQueryWithAccessTags(exportStatusResource);

            if (searchParams.has('_since')) {
                query = {
                    $and: [
                        query,
                        {
                            'meta.lastUpdated': {
                                $gte: moment.utc(searchParams.get('_since')).toDate()
                            }
                        }
                    ]
                };
            }

            let requestResources = searchParams.get('_type')?.split(',');

            // Create folder for export files
            if (!fs.existsSync(this.exportStatusId)) {
                fs.mkdirSync(this.exportStatusId);
            }

            if (pathname.startsWith('/4_0_0/$export')) {
                // Get all the valid resources to export
                requestResources = Object.values(COLLECTION).filter(
                    (r) => !requestResources || requestResources.includes(r)
                );

                for (const resourceType of requestResources) {
                    await this.processResourceAsync({ resourceType, query });
                }
            }
        } catch (err) {
            this.adminLogger.logError(`ERROR: ${err.message}`, {
                error: err.stack
            });
        }
    }

    getQueryWithAccessTags(resource) {
        const securityTags = resource.meta.security.reduce((tags, securityTag) => {
            if (securityTag.system === SecurityTagSystem.access) {
                tags.push(securityTag.code);
            }
            return tags;
        }, []);

        return this.securityTagManager.getQueryWithSecurityTags({ securityTags, query: {} });
    }

    /**
     * Process export for the provided resource
     * @typedef {Object} ProcessResourceAsyncParams
     * @property {string} resourceType
     * @property {Object} query
     *
     * @param {ProcessResourceAsyncParams}
     */
    async processResourceAsync({ resourceType, query }) {
        try {
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version: '4_0_0'
            });

            const cursor = await databaseQueryManager.findAsync({ query });

            const filePath = `${this.exportStatusId}/${resourceType}.ndjson`;

            const writeStream = fs.createWriteStream(filePath, { flags: 'w' });

            while (await cursor.hasNext()) {
                const resource = await cursor.next();

                await this.databaseAttachmentManager.transformAttachments({
                    resource,
                    operation: GRIDFS.RETRIEVE
                });

                writeStream.write(JSON.stringify(resource) + '\n');
            }

            writeStream.close();
            return new Promise((r) => writeStream.on('close', r));
        } catch (err) {
            this.adminLogger.logError(`Error in processResourceAsync: ${err.message}`, {
                error: err.stack,
                resourceType,
                query
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.processResourceAsync',
                error: err,
                args: {
                    resourceType,
                    query
                }
            });
        }
    }
}

module.exports = { BulkDataExportRunner };
