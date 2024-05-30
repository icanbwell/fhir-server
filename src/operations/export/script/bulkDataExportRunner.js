const fs = require('fs');
const moment = require('moment-timezone');
const { AdminLogger } = require('../../../admin/adminLogger');
const { BulkExportManager } = require('../bulkExportManager');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { RethrownError } = require('../../../utils/rethrownError');
const { R4SearchQueryCreator } = require('../../query/r4');
const { SecurityTagManager } = require('../../common/securityTagManager');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');
const { COLLECTION, GRIDFS } = require('../../../constants');

class BulkDataExportRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {BulkExportManager} bulkExportManager
     * @property {PatientFilterManager} patientFilterManager
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {SecurityTagManager} securityTagManager
     * @property {R4SearchQueryCreator} r4SearchQueryCreator
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
        r4SearchQueryCreator,
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
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);

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
            const exportStatusResource = await this.bulkExportManager.getExportStatusResourceWithId(
                {
                    exportStatusId: this.exportStatusId
                }
            );

            if (!exportStatusResource) {
                this.adminLogger.logInfo(
                    `ExportStatus resource not found with Id: ${this.exportStatusId}`
                );
                return;
            }

            const { pathname, searchParams } = new URL(exportStatusResource.requestUrl);

            const query = this.getQueryForExport({
                scope: exportStatusResource.scope,
                user: exportStatusResource.user,
                searchParams
            });

            // Create folder for export files
            if (!fs.existsSync(this.exportStatusId)) {
                fs.mkdirSync(this.exportStatusId);
            }

            if (pathname.startsWith('/4_0_0/$export')) {
                // Get all the valid resources to export
                const requestResources = this.getRequestedResource({
                    scope: exportStatusResource.scope,
                    searchParams,
                    allowedResources: Object.values(COLLECTION)
                });

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

    /**
     * @typedef {Object} GetQueryForExportParams
     * @property {string} scope
     * @property {string} user
     * @property {URLSearchParams} searchParams
     *
     * @param {GetQueryForExportParams}
     */
    getQueryForExport({ scope, user, searchParams }) {
        let query = {};

        query = this.securityTagManager.getQueryWithSecurityTags({
            securityTags: this.securityTagManager.getSecurityTagsFromScope({
                user,
                scope,
                accessRequested: 'read'
            }),
            query
        });

        if (searchParams.has('_since')) {
            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({
                query,
                andQuery: {
                    'meta.lastUpdated': {
                        $gte: moment.utc(searchParams.get('_since')).toDate()
                    }
                }
            });
        }

        return query;
    }

    /**
     * Gets requested resources from allowed resources based on scope and _type param
     * @typedef {Object} GetRequestedResourceParams
     * @property {string} scope
     * @property {URLSearchParams} searchParams
     * @property {string[]} allowedResources
     *
     * @param {GetRequestedResourceParams}
     */
    getRequestedResource({ scope, searchParams, allowedResources }) {
        if (scope) {
            let allowedResourcesByScopes = [];

            // check allowed resource by scope
            for (const scope1 of scope.split(' ')) {
                if (scope1.startsWith('user')) {
                    // ex: user/Patient.*
                    const inner_scope = scope1.replace('user/', '');
                    const [resource, accessType] = inner_scope.split('.');
                    if (resource === '*') {
                        allowedResourcesByScopes = null;
                        break;
                    }
                    if (accessType === '*' || accessType === 'read') {
                        allowedResourcesByScopes.push(resource);
                    }
                }
            }

            if (allowedResourcesByScopes) {
                allowedResources = allowedResources.filter(resource => allowedResourcesByScopes.includes(resource));
            }
        }

        if (searchParams.has('_type')) {
            const requestResources = searchParams.get('_type').split(',');

            allowedResources = requestResources.filter(resource => allowedResources.includes(resource));
        }

        return allowedResources;
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
