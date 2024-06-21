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
const { logInfo, logError } = require('../../common/logging');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { COLLECTION, GRIDFS } = require('../../../constants');
const { SearchManager } = require('../../search/searchManager');

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
     * @property {R4ArgsParser} r4ArgsParser
     * @property {SearchManager} searchManager
     * @property {string} exportStatusId
     * @property {number} batchSize
     * @property {S3Client} s3Client
     * @property {number} uploadPartSize
     * @property {number} minUploadBatchSize
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
        r4ArgsParser,
        searchManager,
        exportStatusId,
        batchSize,
        s3Client,
        uploadPartSize,
        minUploadBatchSize
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
        this.batchSize = batchSize;

        /**
         * @type {import('../../../fhir/classes/4_0_0/custom_resources/exportStatus')|null}
         */
        this.exportStatusResource = null;

        /**
         * @type {number}
         */
        this.uploadPartSize = uploadPartSize;

        /**
         * @type {number}
         */
        this.minUploadBatchSize = minUploadBatchSize;

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
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
                logInfo(
                    `ExportStatus resource not found with Id: ${this.exportStatusId}`
                );
                return;
            }

            // Update status of ExportStatus resource to in-progress
            this.exportStatusResource.status = 'in-progress';
            await this.databaseExportManager.updateExportStatusAsync({
                exportStatusResource: this.exportStatusResource
            });

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
            searchParams.append('base_version', pathname.split('/')[1])

            let query = await this.getQueryForExport({
                user: this.exportStatusResource.user,
                scope: this.exportStatusResource.scope,
                searchParams
            });

            if (pathname.startsWith('/4_0_0/$export')) {
                // Get all the requested resources to export
                const requestResources = await this.getRequestedResourceAsync({
                    scope: this.exportStatusResource.scope,
                    searchParams,
                    allowedResources: Object.values(COLLECTION)
                });

                for (const resourceType of requestResources) {
                    await this.processResourceAsync({ resourceType, query });
                }
            } else {
                const requestedResources = await this.getRequestedResourceAsync({
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

            // Update status of ExportStatus resource to completed and add output and error
            this.exportStatusResource.status = 'completed';
            await this.databaseExportManager.updateExportStatusAsync({
                exportStatusResource: this.exportStatusResource
            });
        } catch (err) {
            if (this.exportStatusResource) {
                // Update status of ExportStatus resource to failed if ExportStatus resource exists
                this.exportStatusResource.status = 'entered-in-error';
                await this.databaseExportManager.updateExportStatusAsync({
                    exportStatusResource: this.exportStatusResource
                });
            }
            logError(`ERROR: ${err.message}`, {
                error: err.stack
            });
        }
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

        // do not allow auditEvent exoprt
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
                })
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
            let batchNumber = 1;
            while (await patientCursor.hasNext()) {
                const data = await patientCursor.nextRaw();
                patientReferences.push(`Patient/${data._uuid}`);

                if (patientReferences.length === this.batchSize) {
                    await this.exportPatientDataAsync({ requestedResources, query, patientReferences, batchNumber });
                    batchNumber++;
                    patientReferences = [];
                }
            }

            if (patientReferences.length > 0) {
                await this.exportPatientDataAsync({ requestedResources, query, patientReferences });
            }
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
     * @property {string[]} requestedResources
     * @property {Object} query
     * @property {string[]} patientReferences
     * @property {number} batchNumber
     *
     * @param {ExportPatientDataAsyncParams}
     */
    async exportPatientDataAsync({ requestedResources, query, patientReferences, batchNumber }) {
        try {
            for (const resourceType of requestedResources) {
                const resourceQuery = this.addPatientFiltersToQuery({
                    patientReferences,
                    query: deepcopy(query),
                    resourceType
                });

                await this.processResourceAsync({ resourceType, query: resourceQuery, batchNumber });
            }
        } catch (err) {
            logError(`Error in exportPatientDataAsync: ${err.message}`, {
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
     * @property {number} [batchNumber]
     *
     * @param {ProcessResourceAsyncParams}
     */
    async processResourceAsync({ resourceType, query, batchNumber }) {
        const filePath = `${this.baseS3Folder}/${resourceType}${batchNumber ? `_${batchNumber}` : ''}.ndjson`;
        let uploadId;
        try {
            logInfo(`Exporting ${resourceType} resource with query: ${JSON.stringify(query)}`);
            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version: '4_0_0'
            });

            // generate parsed args for enriching the resource
            const parsedArgs = this.r4ArgsParser.parseArgs({
                resourceType,
                args: {
                    base_version: '4_0_0'
                }
            });
            parsedArgs.headers = {};

            const totalCount = await databaseQueryManager.exactDocumentCountAsync({ query });
            logInfo(`Exporting ${totalCount} resources for ${resourceType} resource`);

            if (totalCount === 0) {
                // Upload an empty file as we cannot upload empty file using multipart upload
                await this.s3Client.uploadAsync({ filePath, data: '' });
            } else {
                // start multipart upload
                uploadId = await this.s3Client.createMultiPartUploadAsync({ filePath });
                if (!uploadId) {
                    return;
                }
                logInfo(`Starting multipart upload for ${resourceType} with uploadId ${uploadId}`);
                const multipartUploadParts = [];

                // TODO: add logic to use toArray from cursor and use batchSize to load batches
                const cursor = await databaseQueryManager.findAsync({
                    query
                });

                let buffer = '', readCount = 0, currentPartNumber = 1, fileSize = 0;
                while(await cursor.hasNext()) {
                    const currentBatch = [];

                    while(await cursor.hasNext() && currentBatch.length < this.minUploadBatchSize) {
                        currentBatch.push(await cursor.next());
                    }

                    await this.enrichmentManager.enrichAsync({
                        resources: currentBatch,
                        parsedArgs
                    });
                    for (const resource of currentBatch) {
                        readCount++;

                        await this.databaseAttachmentManager.transformAttachments({
                            resource,
                            operation: GRIDFS.RETRIEVE
                        });

                        const resourceString = `${JSON.stringify(resource)}\n`;
                        buffer += resourceString;
                        fileSize += resourceString.length * 2;
                    }
                    logInfo(`${resourceType} resource read: ${readCount}/${totalCount}`);

                    if (fileSize > this.uploadPartSize || readCount >= totalCount) {
                        // Upload the file to s3
                        logInfo(`Uploading part to S3 for ${resourceType} using uploadId: ${uploadId}`);
                        multipartUploadParts.push(
                            await this.s3Client.uploadPartAsync({
                                data: buffer,
                                partNumber: currentPartNumber,
                                uploadId,
                                filePath
                            })
                        );
                        logInfo(`Uploaded part to S3 for ${resourceType} using uploadId: ${uploadId}`);

                        currentPartNumber++;
                        buffer = '';
                        fileSize = 0;
                    }
                }

                // finish multipart upload
                await this.s3Client.completeMultiPartUploadAsync({
                    filePath, uploadId, multipartUploadParts
                });
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
