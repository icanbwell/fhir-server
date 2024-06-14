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
const { logError } = require('../operations/common/logging');

class AdminExportManager {
    /**
     * @property {PostRequestProcessor} postRequestProcessor
     * @property {RequestSpecificCache} requestSpecificCache
     * @property {FhirOperationsManager} fhirOperationsManager
     * @property {DatabaseExportManager} databaseExportManager
     * @property {ResourceMerger} resourceMerger
     * @property {K8sClient} k8sClient
     * @property {AdminLogger} adminLogger
     * @property {configManager} configManager
     */
    constructor({
        postRequestProcessor, requestSpecificCache, fhirOperationsManager, databaseExportManager, resourceMerger, k8sClient, configManager
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
    }

    /**
     * Get Export Status
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
    */
    async getExportStatus({ req, res }) {
        const exportStatusId = req.query.id
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);

        try {
            let args = {
                base_version: VERSIONS['4_0_0']
            }

            if (exportStatusId) {
                const exportStatusResource = await this.fhirOperationsManager.searchById(
                    args,
                    {
                        req,
                        res
                    },
                    'ExportStatus');
                if (exportStatusResource)
                    return res.status(200).json(exportStatusResource);
            }
            else {
                const bundle = await this.fhirOperationsManager.search(
                    args,
                    {
                        req,
                        res
                    },
                    'ExportStatus');

                return res.status(200).json(bundle);
            }
        }
        catch (error) {
            return res.json({ message: error })
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
\     */
    async updateExportStatus({ req, res }) {
        const exportStatusId = req.query.id
        req.id = req.id || req.header(`${REQUEST_ID_HEADER}`) || generateUUID();
        httpContext.set('requestId', req.id);
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req)

        try {
            let args = {
                base_version: VERSIONS['4_0_0']
            }
            if (exportStatusId) {


                const exportStatusResource = await this.fhirOperationsManager.searchById(
                    args,
                    {
                        req,
                        res
                    },
                    'ExportStatus');
                if (exportStatusResource) {

                    const exportResource = FhirResourceCreator.createByResourceType(req.body, 'ExportStatus');

                    let { updatedResource } = await this.resourceMerger.mergeResourceAsync({
                        base_version: '4_0_0',
                        requestInfo: requestInfo,
                        currentResource: exportStatusResource,
                        resourceToMerge: exportResource,
                        smartMerge: false,
                        incrementVersion: false
                    });
                    if (updatedResource) {
                        await this.databaseExportManager.updateExportStatusAsync({
                            exportStatusResource: exportResource
                        });
                    }
                    return res.status(200).json(exportResource)
                }
            }
            else {
                return res.status(400).json({ message: `No ExportStatus id provided` });
            }
        }
        catch (error) {
            return res.json({ message: error });
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
\    */
    async triggerExportJob({ req, res }) {
        const exportStatusId = req.query.id
        if (exportStatusId) {
            try {
                await this.k8sClient.createJob(
                    'node /srv/src/src/operations/export/script/bulkDataExport.js ' +
                    `--exportStatusId ${exportStatusId} ` +
                    `--bulkExportS3BucketName ${this.configManager.bulkExportS3BucketName} ` +
                    `--awsRegion ${this.configManager.awsRegion}`
                );
                return res.status(200).json({
                    message: `Successfully triggered k8 Job for ExportStatus ${exportStatusId}`
                })
            }
            catch (error) {
                logError(error);
                return res.json({message: error})
            }
        } else {
            return res.status(400).json({
                message: "No id: provided"
            })
        }
    }
}


module.exports = {
    AdminExportManager
};
