const deepcopy = require('deepcopy');
const moment = require('moment-timezone');

const ExportStatusEntry = require('../../../fhir/classes/4_0_0/custom_resources/exportStatusEntry');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { DatabaseExportManager } = require('../../../dataLayer/databaseExportManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { EnrichmentManager } = require('../../../enrich/enrich');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { PatientQueryCreator } = require('../../common/patientQueryCreator');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { RethrownError } = require('../../../utils/rethrownError');
const { R4ArgsParser } = require('../../query/r4ArgsParser');
const { R4SearchQueryCreator } = require('../../query/r4');
const { S3Client } = require('../../../utils/s3Client');
const { assertTypeEquals, assertIsValid } = require('../../../utils/assertType');
const { isUuid } = require('../../../utils/uid.util');
const { logInfo, logError, logDebug } = require('../../common/logging');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const {
    COLLECTION,
    GRIDFS,
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM,
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP
} = require('../../../constants');
const { SearchManager } = require('../../search/searchManager');
const { ResourceLocatorFactory } = require('../../common/resourceLocatorFactory');
const { FhirResourceCreator } = require('../../../fhir/fhirResourceCreator');
const { ResourceLocator } = require('../../common/resourceLocator');
const { S3MultiPartContext } = require('./s3MultiPartContext');
const { ExportEventProducer } = require('../../../utils/exportEventProducer');

class BulkDataExportRunner {
    /**
     * @typedef {Object} ConstructorParams

     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {DatabaseExportManager} databaseExportManager
     * @property {PatientFilterManager} patientFilterManager
     * @property {DatabaseAttachmentManager} databaseAttachmentManager
     * @property {R4SearchQueryCreator} r4SearchQueryCreator
     * @property {PatientQueryCreator} patientQueryCreator
     * @property {EnrichmentManager} enrichmentManager
     * @property {ResourceLocatorFactory} resourceLocatorFactory
     * @property {R4ArgsParser} r4ArgsParser
     * @property {SearchManager} searchManager
     * @property {ExportEventProducer} exportEventProducer
     * @property {string} exportStatusId
     * @property {number} patientReferenceBatchSize
     * @property {number} fetchResourceBatchSize
     * @property {S3Client} s3Client
     * @property {number} uploadPartSize
     * @property {string} requestId
     *
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        databaseExportManager,
        patientFilterManager,
        databaseAttachmentManager,
        r4SearchQueryCreator,
        patientQueryCreator,
        enrichmentManager,
        resourceLocatorFactory,
        r4ArgsParser,
        searchManager,
        exportEventProducer,
        exportStatusId,
        patientReferenceBatchSize,
        fetchResourceBatchSize,
        s3Client,
        uploadPartSize,
        requestId
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
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);

        /**
         * @type {S3Client}
         */
        this.s3Client = s3Client;
        assertTypeEquals(s3Client, S3Client);

        /**
         * @type {string}
         */
        this.exportStatusId = exportStatusId;
        assertIsValid(exportStatusId, 'exportStatusId is required for running BulkExport');

        /**
         * @type {number}
         */
        this.patientReferenceBatchSize = patientReferenceBatchSize;

        /**
         * @type {number}
         */
        this.fetchResourceBatchSize = fetchResourceBatchSize;

        /**
         * @type {import('../../../fhir/classes/4_0_0/custom_resources/exportStatus')|null}
         */
        this.exportStatusResource = null;

        /**
         * @type {number}
         */
        this.uploadPartSize = uploadPartSize;

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {ExportEventProducer}
         */
        this.exportEventProducer = exportEventProducer;
        assertTypeEquals(exportEventProducer, ExportEventProducer);

        /**
         * @type {string}
         */
        this.requestId = requestId;
        assertIsValid(requestId, 'Invalid request id.');
    }

    /**
     * main process
     */
    async processAsync() {
        try {
            const startTime = Date.now();
            this.exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                    exportStatusId: this.exportStatusId
                });

            if (!this.exportStatusResource) {
                logInfo(
                    `ExportStatus resource not found with Id: ${this.exportStatusId}`
                );
                return;
            }

            // Update status of ExportStatus resource to in-progress
            this.exportStatusResource.status = 'in-progress';
            await this.updateExportStatusResource();
            logInfo(
                `ExportStatus resource marked as in-progress with Id: ${this.exportStatusId}`,
                { exportStatusId: this.exportStatusId }
            );

            // compute base folder where data will be upload in s3
            const accessTags = this.exportStatusResource.meta.security
                .filter(s => s.system === SecurityTagSystem.access)
                .map(s => s.code);
            if (accessTags.length === 0) {
                accessTags.push('bwell');
            }
            this.baseS3Folder = `exports/${accessTags.join('_')}/${this.exportStatusId}`;

            const { pathname, searchParams } = new URL(this.exportStatusResource.request);

            // to be used while making query
            searchParams.append('base_version', pathname.split('/')[1]);

            let query = await this.getQueryForExport({
                user: this.exportStatusResource.user,
                scope: this.exportStatusResource.scope,
                searchParams
            });

            if (pathname.startsWith('/4_0_0/$export')) {
                // Get all the requested resources to export
                const requestedResources = await this.getRequestedResourceAsync({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources: Object.values(COLLECTION)
                });

                for (const resourceType of requestedResources) {
                    await this.processResourceAsync({ resourceType, query });
                }
            } else {
                const requestedResources = await this.getRequestedResourceAsync({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources:
                        this.patientFilterManager.getAllPatientOrPersonRelatedResources()
                });

                if (pathname.startsWith('/4_0_0/Patient/$export')) {
                    for (const resourceType of requestedResources) {
                        await this.handlePatientExportAsync({
                            searchParams,
                            query,
                            resourceType
                        });
                    }
                }
            }

            // Update status of ExportStatus resource to completed and add output and error
            this.exportStatusResource.status = 'completed';
            await this.updateExportStatusResource();

            const endTime = Date.now();
            const elapsedTime = endTime - startTime;
            logInfo(
                `ExportStatus resource marked as completed with Id: ${this.exportStatusId}`,
                { exportStatusId: this.exportStatusId, timeTaken: this.formatTime(elapsedTime) }
            );
        } catch (err) {
            if (this.exportStatusResource) {
                // Update status of ExportStatus resource to failed if ExportStatus resource exists
                this.exportStatusResource.status = 'entered-in-error';
                await this.updateExportStatusResource();
                logInfo(
                    `ExportStatus resource marked as entered-in-error with Id: ${this.exportStatusId}`,
                    { exportStatusId: this.exportStatusId }
                );
            }
            logError(`ERROR: ${err.message}`, {
                error: err.stack
            });
        }
    }

    /**
     * Function to format time in milliseconds to human readable format
     * @param {*} milliseconds number of milliseconds
     * @returns human readable format time
     */
    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        return `${hours} hours, ${minutes % 60} minutes, ${seconds % 60} seconds`;
    }

    /**
     * @typedef {Object} GetQueryForExportParams
     * @param {string} user
     * @param {string} scope
     * @property {URLSearchParams} searchParams
     *
     * @param {GetQueryForExportParams}
     */
    async getQueryForExport({ user, scope, searchParams }) {
        let query = {};

        const parsedArgs = this.r4ArgsParser.parseArgs({
            resourceType: 'ExportStatus',
            args: Object.fromEntries(searchParams)
        });
        ({
            /** @type {import('mongodb').Document}**/
            query
        } = await this.searchManager.constructQueryAsync({
            user,
            scope,
            isUser: false,
            resourceType: 'ExportStatus',
            parsedArgs: parsedArgs
        }));
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
     * Function to update export status resource
     */
    async updateExportStatusResource() {
        await this.databaseExportManager.updateExportStatusAsync({
            exportStatusResource: this.exportStatusResource
        });
        await this.exportEventProducer.produce({
            resource: this.exportStatusResource,
            requestId: this.requestId
        });
    }

    /**
     * Gets requested resources from allowed resources based on scope and _type param
     * @typedef {Object} GetRequestedResourceAsyncParams
     * @property {string} scope
     * @property {URLSearchParams} searchParams
     * @property {string[]} allowedResources
     *
     * @param {GetRequestedResourceAsyncParams}
     */
    async getRequestedResourceAsync({ scope, searchParams, allowedResources }) {
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

        // do not allow auditEvent export
        allowedResources = allowedResources.filter(r => r !== 'AuditEvent');

        if (searchParams.has('_type')) {
            const requestResources = searchParams.get('_type').split(',');

            let errors = '';
            allowedResources = requestResources.filter((resource) => {
                if (allowedResources.includes(resource)) {
                    return true;
                }

                const operationOutcome = new OperationOutcome({
                    resourceType: 'OperationOutcome',
                    issue: [
                        new OperationOutcomeIssue({
                            severity: 'error',
                            code: 'forbidden',
                            details: { text: `Cannot access ${resource} with scope ${scope}` },
                            diagnostics: `Cannot access ${resource} with scope ${scope}`
                        })
                    ]
                });
                errors += `${JSON.stringify(operationOutcome)}\n`;

                return false;
            });

            // if there are errors write to s3
            if (errors) {
                const filePath = `${this.baseS3Folder}/OperationOutcome.ndjson`;

                await this.s3Client.uploadAsync({
                    filePath,
                    data: errors
                });

                // Add errors to ExportStatus resource and update in database
                this.exportStatusResource.errors.push(
                    new ExportStatusEntry({
                        type: 'OperationOutcome',
                        url: this.s3Client.getPublicS3FilePath(filePath)
                    })
                );
            }
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
            } else if (resourceType.startsWith("Subscription")) {
                let patientSubscriptionFilter = {
                    Subscription: 'extension',
                    SubscriptionStatus: 'extension',
                    SubscriptionTopic: 'identifier'
                };

                let patientIds = patientReferences.map(r => ReferenceParser.parseReference(r).id);

                andQuery = {
                    [patientSubscriptionFilter[resourceType]]: {
                        $elemMatch: {
                            [SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[
                                patientSubscriptionFilter[resourceType]
                            ]['key']]: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient,
                            [SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP[
                                patientSubscriptionFilter[resourceType]
                            ]['value']]: {
                                $in: patientIds
                            }
                        }
                    }
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
     * @property {string} resourceType
     *
     * @param {HandlePatientExportAsyncParams}
     */
    async handlePatientExportAsync({ searchParams, query, resourceType }) {
        try {
            logInfo(`Starting export for resource: ${resourceType}`);
            // Create patient query and get cursor to process patients batchwise
            const patientQuery = this.addPatientFiltersToQuery({
                patientReferences: searchParams.get('patient')?.split(','),
                query: deepcopy(query),
                resourceType: 'Patient'
            });

            if (resourceType === 'Patient') {
                await this.processResourceAsync({ resourceType, query: patientQuery });
                return;
            }

            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType: 'Patient',
                base_version: '4_0_0'
            });

            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>[]}
             */
            const collections = await resourceLocator.getOrCreateCollectionsForQueryAsync({
                query: patientQuery
            });

            const options = { projection: { _uuid: 1 }, batchSize: this.fetchResourceBatchSize };
            const patientCursor = collections[0].find(patientQuery, options);

            const multipartContext = new S3MultiPartContext({
                resourceFilePath: `${this.baseS3Folder}/${resourceType}.ndjson`
            });
            let patientReferences = [];
            for await (const result of patientCursor) {
                patientReferences.push(`Patient/${result._uuid}`);

                if (patientReferences.length === this.patientReferenceBatchSize) {
                    await this.exportPatientDataAsync({
                        resourceType,
                        query,
                        patientReferences,
                        multipartContext
                    });
                    patientReferences = [];
                }
            }

            if (patientReferences.length > 0) {
                await this.exportPatientDataAsync({
                    resourceType,
                    query,
                    patientReferences,
                    multipartContext
                });
            }

            if (multipartContext.previousBuffer?.length) {
                logInfo(`${resourceType} resource read: ${multipartContext.readCount}`);
                logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);

                // Upload the file to s3
                multipartContext.multipartUploadParts.push(
                    await this.s3Client.uploadPartAsync({
                        data: multipartContext.previousBuffer.join('\n').trim(),
                        partNumber: multipartContext.multipartUploadParts.length + 1,
                        uploadId: multipartContext.uploadId,
                        filePath: multipartContext.resourceFilePath
                    })
                );

                logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);
            }
            if (multipartContext.uploadId) {
                // finish multipart upload
                await this.s3Client.completeMultiPartUploadAsync({
                    filePath: multipartContext.resourceFilePath,
                    uploadId: multipartContext.uploadId,
                    multipartUploadParts: multipartContext.multipartUploadParts
                });
            } else {
                // Upload an empty file as we cannot upload empty file using multipart upload if no data present to be uploaded
                await this.s3Client.uploadEmptyFileAsync({ filePath: multipartContext.resourceFilePath });
            }

            // add filename to ExportStatus resource
            this.exportStatusResource.output.push(
                new ExportStatusEntry({
                    type: resourceType,
                    url: this.s3Client.getPublicS3FilePath(multipartContext.resourceFilePath)
                })
            );

            logInfo(`Finished exporting ${resourceType} resource`);
        } catch (err) {
            logError(`Error in handlePatientExportAsync: ${err.message}`, {
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
     * @property {string} resourceType
     * @property {Object} query
     * @property {string[]} patientReferences
     * @property {Object} multipartContext
     *
     * @param {ExportPatientDataAsyncParams}
     */
    async exportPatientDataAsync({
        resourceType,
        query,
        patientReferences,
        multipartContext
    }) {
        const resourceQuery = this.addPatientFiltersToQuery({
            patientReferences,
            query: deepcopy(query),
            resourceType
        });
        try {
            logDebug(`Exporting ${resourceType} resources with query: ${JSON.stringify(resourceQuery)}`);

            // generate parsed args for enriching the resource
            const parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: {
                    base_version: '4_0_0'
                }
            });
            parsedArgs.headers = {};

            if (!multipartContext.collection) {
                const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                    resourceType,
                    base_version: '4_0_0'
                });
                const db = await resourceLocator.getDatabaseConnectionAsync();
                multipartContext.collection = db.collection(`${resourceType}_4_0_0`);
                const stats = await db.command({ collStats: `${resourceType}_4_0_0` });
                multipartContext.averageDocumentSize = stats.avgObjSize > 0 ? stats.avgObjSize : 2000;
            }

            const options = { batchSize: this.fetchResourceBatchSize };
            const cursor = multipartContext.collection.find(resourceQuery, options);

            // start multipart upload
            if (!multipartContext.uploadId && await cursor.hasNext()) {
                multipartContext.uploadId = await this.s3Client.createMultiPartUploadAsync({
                    filePath: multipartContext.resourceFilePath
                });
                logInfo(`Starting multipart upload for ${resourceType} with uploadId ${multipartContext.uploadId}`);
            }
            const minUploadBatchSize = Math.floor(this.uploadPartSize / multipartContext.averageDocumentSize);
            while (await cursor.hasNext()) {
                const currentBatch = new Array(minUploadBatchSize);
                let currentBatchSize = 0;
                while (await cursor.hasNext() && currentBatchSize < minUploadBatchSize) {
                    let doc = await cursor.next();
                    doc = FhirResourceCreator.createByResourceType(doc, resourceType);
                    await this.enrichmentManager.enrichAsync({
                        resources: [doc],
                        parsedArgs
                    });
                    await this.databaseAttachmentManager.transformAttachments({
                        resource: doc,
                        operation: GRIDFS.RETRIEVE
                    });
                    currentBatch[currentBatchSize++] = JSON.stringify(doc);
                }

                multipartContext.readCount += currentBatchSize;
                if (multipartContext.previousBuffer?.length) {
                    currentBatch.concat(multipartContext.previousBuffer);
                    currentBatchSize += multipartContext.previousBatchSize;
                }
                if (currentBatchSize >= minUploadBatchSize) {
                    logInfo(`${resourceType} resource read: ${multipartContext.readCount}`);
                    logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);

                    // Upload the file to s3
                    multipartContext.multipartUploadParts.push(
                        await this.s3Client.uploadPartAsync({
                            data: currentBatch.slice(0, currentBatchSize).join('\n'),
                            partNumber: multipartContext.multipartUploadParts.length + 1,
                            uploadId: multipartContext.uploadId,
                            filePath: multipartContext.resourceFilePath
                        })
                    );
                    multipartContext.previousBuffer = null;
                    multipartContext.previousBatchSize = null;

                    logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${multipartContext.uploadId}`);
                } else {
                    multipartContext.previousBuffer = currentBatch;
                    multipartContext.previousBatchSize = currentBatchSize;
                }
            }
        } catch (err) {
            logError(`Error in exportPatientDataAsync: ${err.message}`, {
                error: err.stack,
                resourceQuery
            });
            throw new RethrownError({
                message: err.message,
                source: 'BulkDataExportRunner.exportPatientDataAsync',
                error: err,
                args: {
                    resourceQuery
                }
            });
        }
    }

    /**
     * Process export for the provided resource
     * @typedef {Object} ProcessResourceAsyncParams
     * @property {string} resourceType
     * @property {Object} query
     * @property {number} [batchNumber]
     *
     * @param {ProcessResourceAsyncParams}
     */
    async processResourceAsync({ resourceType, query, batchNumber }) {
        const filePath = `${this.baseS3Folder}/${resourceType}${batchNumber ? `_${batchNumber}` : ''}.ndjson`;
        let uploadId;
        try {
            logDebug(`Exporting ${resourceType} resource with query: ${JSON.stringify(query)}`);

            // generate parsed args for enriching the resource
            const parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: {
                    base_version: '4_0_0'
                }
            });
            parsedArgs.headers = {};

            logInfo(`Exporting resources for ${resourceType} resource`);

            /**
             * @type {ResourceLocator}
             */
            const resourceLocator = this.resourceLocatorFactory.createResourceLocator({
                resourceType,
                base_version: '4_0_0'
            });

            const db = await resourceLocator.getDatabaseConnectionAsync();
            const options = { batchSize: this.fetchResourceBatchSize };
            const cursor = db.collection(`${resourceType}_4_0_0`).find(query, options);

            let readCount = 0;

            // start multipart upload
            if (await cursor.hasNext()) {
                uploadId = await this.s3Client.createMultiPartUploadAsync({ filePath });
                logInfo(`Starting multipart upload for ${resourceType} with uploadId ${uploadId}`);
            }
            const multipartUploadParts = [];

            const stats = await db.command({ collStats: `${resourceType}_4_0_0` });
            const minUploadBatchSize = Math.floor(this.uploadPartSize / stats.avgObjSize);
            while (await cursor.hasNext()) {
                const currentBatch = new Array(minUploadBatchSize);
                let currentBatchSize = 0;

                while (await cursor.hasNext() && currentBatchSize < minUploadBatchSize) {
                    let doc = await cursor.next();
                    doc = FhirResourceCreator.createByResourceType(doc, resourceType);
                    await this.enrichmentManager.enrichAsync({
                        resources: [doc],
                        parsedArgs
                    });
                    await this.databaseAttachmentManager.transformAttachments({
                        resource: doc,
                        operation: GRIDFS.RETRIEVE
                    });
                    currentBatch[currentBatchSize++] = JSON.stringify(doc);
                }

                const buffer = currentBatch.slice(0, currentBatchSize).join('\n');

                readCount += currentBatchSize;
                logInfo(`${resourceType} resource read: ${readCount}`);
                logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${uploadId}`);

                // Upload the file to s3
                multipartUploadParts.push(
                    await this.s3Client.uploadPartAsync({
                        data: buffer,
                        partNumber: multipartUploadParts.length + 1,
                        uploadId,
                        filePath
                    })
                );

                logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${uploadId}`);
            }

            if (uploadId) {
                // finish multipart upload
                await this.s3Client.completeMultiPartUploadAsync({
                    filePath,
                    uploadId,
                    multipartUploadParts
                });
            } else {
                // Upload an empty file as we cannot upload empty file using multipart upload if no data present to be uploaded
                await this.s3Client.uploadEmptyFileAsync({ filePath });
            }

            // add filename to ExportStatus resource
            this.exportStatusResource.output.push(
                new ExportStatusEntry({
                    type: resourceType,
                    url: this.s3Client.getPublicS3FilePath(filePath)
                })
            );

            logInfo(`Finished exporting ${resourceType} resource`);
        } catch (err) {
            if (uploadId) {
                await this.s3Client.abortMultiPartUploadAsync({ filePath, uploadId });
            }
            logError(`Error in processResourceAsync: ${err.message}`, {
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
