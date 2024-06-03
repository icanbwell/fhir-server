const env = require('var');
const fs = require('fs');
const deepcopy = require('deepcopy');
const moment = require('moment-timezone');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { AdminLogger } = require('../../../admin/adminLogger');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { PatientQueryCreator } = require('../../common/patientQueryCreator');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { RethrownError } = require('../../../utils/rethrownError');
const { R4SearchQueryCreator } = require('../../query/r4');
const { SecurityTagManager } = require('../../common/securityTagManager');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');
const { isUuid } = require('../../../utils/uid.util');
const { COLLECTION, GRIDFS } = require('../../../constants');
const ExportStatusEntry = require('../../../fhir/classes/4_0_0/custom_resources/exportStatusEntry');

class BulkDataExportRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseExportManager} databaseExportManager
     * @property {PatientFilterManager} patientFilterManager
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {SecurityTagManager} securityTagManager
     * @property {R4SearchQueryCreator} r4SearchQueryCreator
     * @property {PatientQueryCreator} patientQueryCreator
     * @property {AdminLogger} adminLogger
     * @property {string} exportStatusId
     * @property {number} batchSize
     *
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        databaseExportManager,
        patientFilterManager,
        databaseAttachmentManager,
        securityTagManager,
        r4SearchQueryCreator,
        patientQueryCreator,
        adminLogger,
        exportStatusId,
        batchSize
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
         * @type {PatientQueryCreator}
         */
        this.patientQueryCreator = patientQueryCreator;
        assertTypeEquals(patientQueryCreator, PatientQueryCreator);

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

        /**
         * @type {number}
         */
        this.batchSize = batchSize;

        /**
         * @type {import('../../../fhir/classes/4_0_0/custom_resources/exportStatus')|null}
         */
        this.exportStatusResource = null;
    }

    /**
     * main process
     */
    async processAsync() {
        try {
            this.exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                exportStatusId: this.exportStatusId
            });

            if (!this.exportStatusResource) {
                this.adminLogger.logInfo(
                    `ExportStatus resource not found with Id: ${this.exportStatusId}`
                );
                return;
            }

            // Update status of ExportStatus resource to in-progress
            this.exportStatusResource.status = 'in-progress';
            await this.databaseExportManager.updateExportStatusAsync({
                exportStatusResource: this.exportStatusResource
            });

            const { pathname, searchParams } = new URL(this.exportStatusResource.request);

            let query = this.getQueryForExport({
                scope: this.exportStatusResource.scope,
                user: this.exportStatusResource.user,
                searchParams
            });

            // Create folder for export files
            if (fs.existsSync(this.exportStatusId)) {
                fs.rmSync(this.exportStatusId, { recursive: true });
            }
            fs.mkdirSync(this.exportStatusId);

            if (pathname.startsWith('/4_0_0/$export')) {
                // Get all the requested resources to export
                const requestResources = this.getRequestedResource({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources: Object.values(COLLECTION)
                });

                for (const resourceType of requestResources) {
                    await this.processResourceAsync({ resourceType, query });
                }
            } else {
                const requestedResources = this.getRequestedResource({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources: Object.keys(this.patientFilterManager.patientFilterMapping)
                });

                if (pathname.startsWith('/4_0_0/Patient/$export')) {
                    await this.handlePatientExportAsync({
                        searchParams,
                        query,
                        requestedResources
                    });
                }
            }

            // Upload the files to s3 and add to output field of ExportStatus resource
            await this.uploadExportedFilesToS3Async();

            // Update status of ExportStatus resource to completed and add output and error
            this.exportStatusResource.status = 'completed';
            await this.databaseExportManager.updateExportStatusAsync({
                exportStatusResource: this.exportStatusResource
            });
        } catch (err) {
            // Update status of ExportStatus resource to failed if ExportStatus resource exists
            this.exportStatusResource.status = 'failed';
            await this.databaseExportManager.updateExportStatusAsync({
                exportStatusResource: this.exportStatusResource
            });
            this.adminLogger.logError(`ERROR: ${err.message}`, {
                error: err.stack
            });
        }
    }

    /**
     * Uploads the folder with name exportStatusId to s3
     */
    async uploadExportedFilesToS3Async() {
        try {
            const files = fs.readdirSync(this.exportStatusId);
            this.exportStatusResource.output = [];

            const s3Client = new S3Client({ region: 'us-east-1' });

            for (const file of files) {
                const filePath = `${this.exportStatusId}/${file}`;

                await s3Client.send(
                    new PutObjectCommand({
                        Bucket: env.AWS_EXPORT_BUCKET_NAME,
                        Key: filePath,
                        Body: fs.createReadStream(filePath)
                    })
                );

                this.exportStatusResource.output.push(
                    new ExportStatusEntry({
                        type: file.split('.')[0],
                        url: filePath
                    })
                );
                this.adminLogger.logInfo(`File uploaded to S3: ${filePath}`);
            }
        } catch (err) {
            this.adminLogger.logError(`Error in uploadExportedFilesToS3Async: ${err.message}`, {
                error: err.stack
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.uploadExportedFilesToS3Async',
                error: err
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
                    if (accessType === '*' || accessType === 'read') {
                        if (resource === '*') {
                            allowedResourcesByScopes = null;
                            break;
                        }
                        allowedResourcesByScopes.push(resource);
                    }
                }
            }

            if (allowedResourcesByScopes) {
                allowedResources = allowedResources.filter((resource) =>
                    allowedResourcesByScopes.includes(resource)
                );
            }
        }

        if (searchParams.has('_type')) {
            const requestResources = searchParams.get('_type').split(',');

            allowedResources = requestResources.filter((resource) =>
                allowedResources.includes(resource)
            );
        }

        return allowedResources;
    }

    /**
     * Adds patient related filters to the query
     * @typedef {Object} AddPatientFiltersToQueryParams
     * @property {string[]} patientReferences
     * @property {Object} query
     * @property {string} resourceType
     *
     * @param {AddPatientFiltersToQueryParams}
     */
    addPatientFiltersToQuery({ patientReferences, query, resourceType }) {
        if (patientReferences && patientReferences.length > 0) {
            const uuidReferences = patientReferences.filter((r) => isUuid(r));

            const nonUuidReferences = patientReferences.filter((r) => !isUuid(r));

            let andQuery;
            if (resourceType === 'Patient') {
                andQuery = {
                    $or: [
                        {
                            _uuid: {
                                $in: uuidReferences.map(
                                    (r) => ReferenceParser.parseReference(r).id
                                )
                            }
                        },
                        {
                            _sourceId: {
                                $in: nonUuidReferences.map(
                                    (r) => ReferenceParser.parseReference(r).id
                                )
                            }
                        }
                    ]
                };
            } else {
                const patientField = this.patientFilterManager.getPatientPropertyForResource({
                    resourceType
                });

                andQuery = {
                    [patientField.replace('.reference', '._uuid')]: {
                        $in: patientReferences
                    }
                };
            }

            query = this.r4SearchQueryCreator.appendAndSimplifyQuery({ query, andQuery });
        }

        return query;
    }

    /**
     * @typedef {Object} HandlePatientExportAsyncParams
     * @property {URLSearchParams} searchParams
     * @property {Object} query
     * @property {string[]} requestedResources
     *
     * @param {HandlePatientExportAsyncParams}
     */
    async handlePatientExportAsync({ searchParams, query, requestedResources }) {
        try {
            // Create patient query and get cursor to process patients batchwise
            const patientQuery = this.addPatientFiltersToQuery({
                patientReferences: searchParams.get('patient')?.split(','),
                query: deepcopy(query),
                resourceType: 'Patient'
            });

            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            const patientCursor = await databaseQueryManager.findAsync({
                query: patientQuery,
                options: { projection: { _uuid: 1 } }
            });

            let patientReferences = [];
            while (await patientCursor.hasNext()) {
                const data = await patientCursor.nextRaw();
                patientReferences.push(`Patient/${data._uuid}`);

                if (patientReferences.length === this.batchSize) {
                    await this.exportPatientDataAsync({ requestedResources, query, patientReferences });
                    patientReferences = [];
                }
            }

            if (patientReferences.length > 0) {
                await this.exportPatientDataAsync({ requestedResources, query, patientReferences });
            }
        } catch (err) {
            this.adminLogger.logError(`Error in handlePatientExportAsync: ${err.message}`, {
                error: err.stack,
                query
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.handlePatientExportAsync',
                error: err,
                args: {
                    query
                }
            });
        }
    }

    /**
     * @typedef {Object} ExportPatientDataAsyncParams
     * @property {string[]} requestedResources
     * @property {Object} query
     * @property {string[]} patientReferences
     *
     * @param {ExportPatientDataAsyncParams}
     */
    async exportPatientDataAsync({ requestedResources, query, patientReferences }) {
        try {
            for (const resourceType of requestedResources) {
                const resourceQuery = this.addPatientFiltersToQuery({
                    patientReferences,
                    query: deepcopy(query),
                    resourceType
                });

                await this.processResourceAsync({ resourceType, query: resourceQuery });
            }
        } catch (err) {
            this.adminLogger.logError(`Error in exportPatientDataAsync: ${err.message}`, {
                error: err.stack,
                query
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.exportPatientDataAsync',
                error: err,
                args: {
                    query
                }
            });
        }
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
            this.adminLogger.logInfo(`Exporting ${resourceType} resource with query: ${JSON.stringify(query)}`);
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version: '4_0_0'
            });

            const cursor = await databaseQueryManager.findAsync({ query });

            const filePath = `${this.exportStatusId}/${resourceType}.ndjson`;

            const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

            while (await cursor.hasNext()) {
                const resource = await cursor.next();

                await this.databaseAttachmentManager.transformAttachments({
                    resource,
                    operation: GRIDFS.RETRIEVE
                });

                writeStream.write(JSON.stringify(resource) + '\n');
            }
            this.adminLogger.logInfo(`Finished exporting ${resourceType} resource`);
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
