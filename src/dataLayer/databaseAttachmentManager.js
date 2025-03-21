const { Readable, pipeline } = require('stream');
const ObjectId = require('mongodb').ObjectId;
const { GridFSBucket, ReadPreferenceMode } = require('mongodb');

const { assertTypeEquals } = require('../utils/assertType');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');
const { ConfigManager } = require('../utils/configManager');
const Attachment = require('../fhir/classes/4_0_0/complex_types/attachment');
const { NotFoundError } = require('../utils/httpErrors');
const { logInfo } = require('../operations/common/logging');
const { INSERT, RETRIEVE, DELETE } = require('../constants').GRIDFS;

/**
 * @classdesc This class handles attachments with Mongodb GridFS i.e. converts attachment.data
 * @classdesc to attachment._file_id and restores the attachment._file_id to attachment.data
*/
class DatabaseAttachmentManager {
    /**
     * constructor
     * @param {MongoDatabaseManager} mongoDatabaseManager
     * @param {ConfigManager} configManager
    */
    constructor ({ mongoDatabaseManager, configManager }) {
        /**
         * @type {MongoDatabaseManager}
        */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);

        /**
         * @type {ConfigManager}
        */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * creates metadata for the file if apply operation is to be performed
     * @param {Resource} resource
     * @param {String} operation
     * @returns {Object}
    */
    getMetadata (resource, operation) {
        const metadata = {};
        if (operation === INSERT || operation === DELETE) {
            if (resource._uuid) {
                metadata.resource_uuid = resource._uuid;
            }
            if (resource._sourceId) {
                metadata.resource_sourceId = resource._sourceId;
            }
            metadata.active = true;
        }
        return metadata;
    }

    /**
     * checks if any patch is applied to the path provided
     * @param {String} path
     * @param {Object} patchContent
     * @returns {Boolean}
    */
    isUpdated (path, patchContent) {
        const pathArray = path.split('/');
        return patchContent.some(patch => {
            path = '';
            for (const pathEle of pathArray) {
                if (pathEle) {
                    path += `/${pathEle}`;
                    if (path === patch.path) {
                        return true;
                    }
                }
            }
            return false;
        });
    }

    /**
     * Checks if GridFs is applicable on the resource and
     * if applicable changes resources based on the create value
     * @param {Resource[]|Resource} resources
     * @param {String} operation
     * @param {Object} patchContent
    */
    async transformAttachments (resources, operation = INSERT, patchContent = null) {
        const enabledGridFsResources = this.configManager.enabledGridFsResources;
        if (Array.isArray(resources)) {
            for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
                if (enabledGridFsResources.includes(resources[parseInt(resourceIndex)].resourceType)) {
                    if (resources[parseInt(resourceIndex)]._id) {
                        delete resources[parseInt(resourceIndex)]._id;
                    }
                    resources[parseInt(resourceIndex)] = await this.changeAttachmentWithGridFS({
                        resource: resources[parseInt(resourceIndex)],
                        resourceId: resources[parseInt(resourceIndex)].id,
                        index: resourceIndex,
                        metadata: this.getMetadata(resources[parseInt(resourceIndex)], operation),
                        operation,
                        patchContent
                    });
                }
            }
        } else if (enabledGridFsResources.includes(resources.resourceType)) {
            if (resources._id) {
                delete resources._id;
            }
            resources = await this.changeAttachmentWithGridFS({
                resource: resources,
                resourceId: resources.id,
                metadata: this.getMetadata(resources, operation),
                operation,
                patchContent
            });
        }
        return resources;
    }

    /**
     * finds the attachment in the resource and applies the operation specified
     * @param {Object} resource
     * @param {Object} metadata
     * @param {Number} resourceId
     * @param {String} operation
     * @param {Number|String} index
     * @param {Object} patchContent
     * @param {String} path
     * @param {Number} retryCount
    */
    async changeAttachmentWithGridFS({
        resource,
        resourceId,
        metadata,
        index = 0,
        operation = null,
        patchContent = null,
        path = '',
        retryCount = 0
    }) {
        if (!resource) {
            return resource;
        }
        if (resource instanceof Attachment || (resource instanceof Object && resource._file_id)) {
            let gridFSBucket = await this.mongoDatabaseManager.getGridFsBucket();
            if (retryCount >= 2) {
                gridFSBucket = new GridFSBucket(
                    await this.mongoDatabaseManager.getClientDbAsync(),
                    { readPreference: ReadPreferenceMode.primary }
                );
                logInfo(
                    `Retrying read with primary readPreference for attachment: ${resource._file_id}`, {
                        source: 'DatabaseAttachmentManager changeAttachmentWithGridFS'
                    }
                );
            }
            if (!patchContent || this.isUpdated(`${path}/data`, patchContent)) {
                switch (operation) {
                    case INSERT:
                        return await this.convertDataToFileId(
                            resource, `${resourceId}_${index}`, gridFSBucket, metadata
                        );

                    case RETRIEVE:
                        try {
                            return await this.convertFileIdToData(resource, gridFSBucket);
                        } catch (error) {
                            if (retryCount < 2) {
                                logInfo(
                                    `Retrying attachment file download with id: ${resource._file_id}`, {
                                        source: 'DatabaseAttachmentManager changeAttachmentWithGridFS'
                                    }
                                );
                                return await this.changeAttachmentWithGridFS({
                                    resource,
                                    resourceId,
                                    metadata,
                                    index,
                                    operation,
                                    patchContent,
                                    path,
                                    retryCount: retryCount + 1
                                });
                            } else {
                                throw new NotFoundError('Unable to fetch the attachment or not found');
                            }
                        }

                    case DELETE:
                        await this.deleteFile(resource, metadata);
                        return resource;

                    default:
                        return resource;
                }
            }
            return resource;
        }
        if (resource instanceof Object || Array.isArray(resource)) {
            for (const key in resource) {
                if (Object.getOwnPropertyDescriptor(resource, key).writable !== false) {
                    resource[String(key)] = await this.changeAttachmentWithGridFS({
                        resource: resource[String(key)],
                        metadata,
                        resourceId,
                        index: Array.isArray(resource) ? key : index,
                        operation,
                        patchContent,
                        path: `${path}/${key}`
                    });
                }
            }
        }
        return resource;
    }

    /**
     * changes the attachment.data to attachment._file_id if attachment.data is present
     * @param {Resource} resource
     * @param {String} filename
     * @param {import('mongodb').GridFSBucket} gridFSBucket
     * @param {Object} metadata
    */
    async convertDataToFileId (resource, filename, gridFSBucket, metadata) {
        return new Promise((resolve, reject) => {
            if (resource.data) {
                try {
                    const buffer = Buffer.from(resource.data);
                    const stream = new Readable();
                    stream.push(buffer);
                    stream.push(null);
                    const gridFSResult = pipeline(
                        stream,
                        gridFSBucket.openUploadStream(filename, { metadata }),
                        (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resource._file_id = gridFSResult.id.toString();
                                delete resource.data;
                                resolve(resource);
                            }
                        }
                    );
                } catch (err) {
                    reject(err);
                }
            } else {
                resolve(resource);
            }
        });
    }

    /**
     * changes the attachment._file_id to attachment.data if attachment._file_id is present
     * @param {Resource} resource
     * @param {import('mongodb').GridFSBucket} gridFSBucket
     * @returns {Promise<Resource>}
    */
    async convertFileIdToData (resource, gridFSBucket) {
        return new Promise((resolve, reject) => {
            if (resource._file_id) {
                try {
                    const downloadStream = gridFSBucket.openDownloadStream(new ObjectId(resource._file_id));

                    downloadStream.on('error', (err) => {
                        logInfo(
                            `Error occurred in downloading attachment file with id: ${resource._file_id}`, {
                                message: err.message,
                                stack: err.stack,
                                source: 'DatabaseAttachmentManager convertFileIdToData'
                            }
                        );
                        reject(err);
                    });

                    downloadStream.on('data', (chunk) => {
                        resource.data = (resource.data) ? resource.data + chunk.toString() : chunk.toString();
                    });

                    downloadStream.on('end', () => {
                        delete resource._file_id;
                        resolve(resource);
                    });
                } catch (err) {
                    reject(err);
                }
            } else {
                resolve(resource);
            }
        });
    }

    /**
     * does a soft delete for the file present in attachment
     * @param {Resource} resource
     * @param {Object} metadata
    */
    async deleteFile (resource, metadata) {
        if (resource._file_id) {
            const db = await this.mongoDatabaseManager.getClientDbAsync();
            try {
                await db.collection('fs.files').updateOne(
                    { _id: new ObjectId(resource._file_id) },
                    { $set: { metadata: { ...metadata, active: false } } }
                );
            } catch {
                throw new NotFoundError('Resource not found');
            }
        }
    }
}

module.exports = {
    DatabaseAttachmentManager
};
