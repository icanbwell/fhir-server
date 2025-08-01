const httpContext = require('express-http-context');
const { assertTypeEquals } = require('../utils/assertType');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { REQUEST_ID_TYPE, REQUEST_ID_HEADER } = require('../constants');
const { generateUUID } = require('../utils/uid.util');
const { VERSIONS } = require('../middleware/fhir/utils/constants');
const { FhirResourceCreator } = require('../fhir/fhirResourceCreator');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { DatabaseExportManager } = require('../dataLayer/databaseExportManager');
const { ConfigManager } = require('../utils/configManager');
const { K8sClient } = require('../utils/k8sClient');
const { get_all_args } = require('../../src/operations/common/get_all_args');
const { ExportManager } = require('../operations/export/exportManager');
const { ScopesValidator } = require('../operations/security/scopesValidator');
const { NotFoundError } = require("../utils/httpErrors");
const { WRITE } = require('../constants').OPERATIONS;
const { logError } = require('../operations/common/logging');
const { PostSaveProcessor } = require('../dataLayer/postSaveProcessor');
const { BulkExportEventProducer } = require('../utils/bulkExportEventProducer');
const { FhirResourceSerializer } = require('../fhir/fhirResourceSerializer');

class AdminExportManager {
    /**
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {RequestSpecificCache} requestSpecificCache
     * @property {FhirOperationsManager} fhirOperationsManager
     * @property {DatabaseExportManager} databaseExportManager
     * @property {ResourceMerger} resourceMerger
     * @property {K8sClient} k8sClient
     * @property {configManager} configManager
     * @property {ExportManager} exportManager
     * @property {ScopesValidator} scopesValidator
     * @property {PostSaveProcessor} postSaveProcessor
     * @property {BulkExportEventProducer} bulkExportEventProducer
     */
    constructor({
        postRequestProcessor,
        requestSpecificCache,
        fhirOperationsManager,
        databaseExportManager,
        resourceMerger,
        k8sClient,
        configManager,
        exportManager,
        scopesValidator,
        postSaveProcessor,
        bulkExportEventProducer
    }) {
        /**
        *  @type {PostRequestProcessor}
        */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {DatabaseExportManager}
         */
        this.databaseExportManager = databaseExportManager;
        assertTypeEquals(databaseExportManager, DatabaseExportManager);
        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {K8sClient}
         */
        this.k8sClient = k8sClient;
        assertTypeEquals(k8sClient, K8sClient);
        /**
         * @type {ExportManager}
         */
        this.exportManager = exportManager;
        assertTypeEquals(exportManager, ExportManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);

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
    }

    /**
     * Get Export Status
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     */
    async getExportStatus({ req, res }) {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);

        try {
            let args = {
                base_version: VERSIONS['4_0_0']
            }

            if (req.params.id) {
                args['id'] = req.params.id;
                const exportStatusResource = await this.fhirOperationsManager.searchById(
                    args,
                    {
                        req,
                        res
                    },
                    'ExportStatus');
                FhirResourceSerializer.serialize(exportStatusResource)
                return exportStatusResource;
            }
            else {
                const bundle = await this.fhirOperationsManager.search(
                    args,
                    {
                        req,
                        res
                    },
                    'ExportStatus');
                FhirResourceSerializer.serialize(bundle)
                return bundle;
            }
        }
        catch (error) {
            logError(`Error in getExportStatus`, {
                message: error.message,
                stack: error.stack,
                source: 'AdminExportManager getExportStatus'
            });
            throw error;
        }
        finally {
            const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
            await this.postRequestProcessor.executeAsync({ requestId });
            await this.requestSpecificCache.clearAsync({ requestId });
        }
    }

    /**
     * Update Export Status
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     */
    async updateExportStatus({ req, res }) {
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);

        const exportStatusId = req.params.id;
        const resourceType = 'ExportStatus'
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req)
        const args = {
            base_version: VERSIONS['4_0_0']
        };

        const combined_args = get_all_args(req, args);

        const parsedArgs = await this.fhirOperationsManager.getParsedArgsAsync({
            args: combined_args, resourceType: resourceType, headers: req.headers, operation: WRITE
        });

        try {
            await this.scopesValidator.verifyHasValidScopesAsync({
                requestInfo: requestInfo,
                parsedArgs: parsedArgs,
                resourceType: resourceType,
                startTime: Date.now(),
                action: 'updateExportStatus',
                accessRequested: 'write'
            });

            const exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                exportStatusId: exportStatusId
            });

            if (!exportStatusResource) {
                throw new NotFoundError(`ExportStatus resoure with id ${exportStatusId} doesn't exists`);
            }

            const exportResource = FhirResourceCreator.createByResourceType(req.body, resourceType);

            let { updatedResource } = await this.resourceMerger.mergeResourceAsync({
                base_version: VERSIONS['4_0_0'],
                requestInfo: requestInfo,
                currentResource: exportStatusResource,
                resourceToMerge: exportResource,
                smartMerge: false,
                incrementVersion: false
            });

            if (updatedResource) {
                await this.databaseExportManager.updateExportStatusAsync({
                    exportStatusResource: updatedResource
                });
                this.postRequestProcessor.add({
                    requestId: req.id,
                    fnTask: async () => await this.postSaveProcessor.afterSaveAsync({
                        requestId: req.id,
                        eventType: 'U',
                        resourceType: 'ExportStatus',
                        doc: updatedResource
                    })
                });
                await this.bulkExportEventProducer.produce({
                    resource: updatedResource,
                    requestId: req.id
                });
                return updatedResource;
            }
            return exportResource
        }
        catch (error) {
            logError(`Error in updateExportStatus`, {
                message: error.message,
                stack: error.stack,
                source: 'AdminExportManager updateExportStatus'
            });
            throw error;
        }
        finally {
            const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
            await this.postRequestProcessor.executeAsync({ requestId });
            await this.requestSpecificCache.clearAsync({ requestId });
        }
    }

    /**
     * Trigger Export Job
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     */
    async triggerExportJob({ req, res }) {
        const args = {
            base_version: VERSIONS['4_0_0']
        };
        const exportStatusId = req.params.id;
        const resourceType = 'ExportStatus';
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req)

        const combined_args = get_all_args(req, args);

        const parsedArgs = await this.fhirOperationsManager.getParsedArgsAsync({
            args: combined_args, resourceType: resourceType, headers: req.headers, operation: WRITE
        });

        try {
            await this.scopesValidator.verifyHasValidScopesAsync({
                requestInfo: requestInfo,
                parsedArgs: parsedArgs,
                resourceType: resourceType,
                startTime: Date.now(),
                action: 'triggerExportJob',
                accessRequested: 'write'
            });
            const exportStatusResource = await this.databaseExportManager.getExportStatusResourceWithId({
                exportStatusId: exportStatusId
            });

            if (!exportStatusResource) {
                throw new NotFoundError(`ExportStatus resoure with id ${exportStatusId} doesn't exists`);
            }

            return await this.exportManager.triggerExportJob({ exportStatusResource, requestId: requestInfo.requestId })
        } catch (error) {
            logError(`Error in triggerExportJob`, {
                message: error.message,
                stack: error.stack,
                source: 'AdminExportManager triggerExportJob'
            });
            throw error;
        }
    }
}


module.exports = {
    AdminExportManager
};
