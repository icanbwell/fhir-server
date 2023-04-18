const Readable = require('stream').Readable;
const ObjectId = require('mongodb').ObjectId;

const { assertTypeEquals } = require('../utils/assertType');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');
const { ConfigManager } = require('../utils/configManager');
const Attachment = require('../fhir/classes/4_0_0/complex_types/attachment');
const { INSERT, RETRIEVE } = require('../constants').GRIDFS;

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
    constructor({mongoDatabaseManager, configManager}) {
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
    getMetadata(resource, operation) {
        let metadata = {};
        if (operation === INSERT) {
            if (resource._uuid) {
                metadata['resource_uuid'] = resource._uuid;
            }
            if (resource._sourceId) {
                metadata['resource_sourceId'] = resource._sourceId;
            }
            metadata.active = true;
        }
        return metadata;
    }

    /**
     * Checks if GridFs is applicable on the resource and
     * if applicable changes resources based on the create value
     * @param {Resource[]|Resource} resources
     * @param {String} operation
    */
    async transformAttachments(resources, operation = INSERT) {
        const enabledGridFsResources = this.configManager.enabledGridFsResources;
        if (Array.isArray(resources)) {
            for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
                if (enabledGridFsResources.includes(resources[parseInt(resourceIndex)].resourceType)) {
                    resources[parseInt(resourceIndex)] = await this.changeAttachmentWithGridFS({
                        resource: resources[parseInt(resourceIndex)],
                        resourceId: resources[parseInt(resourceIndex)].id,
                        index: resourceIndex,
                        metadata: this.getMetadata(resources[parseInt(resourceIndex)], operation),
                        operation
                    });
                }
            }
        }
        else if (enabledGridFsResources.includes(resources.resourceType)) {
            resources = await this.changeAttachmentWithGridFS({
                resource: resources,
                resourceId: resources.id,
                metadata: this.getMetadata(resources, operation),
                operation
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
    */
    async changeAttachmentWithGridFS({resource, resourceId, metadata, index = 0, operation = null}) {
        if (!resource) {
            return resource;
        }
        if (resource instanceof Attachment) {
            const gridFSBucket = await this.mongoDatabaseManager.getGridFsBucket();
            switch (operation) {
                case INSERT:
                    return await this.convertDataToFileId(
                        resource, `${resourceId}_${index}`, gridFSBucket
                    );

                case RETRIEVE:
                    return await this.convertFileIdToData(resource, gridFSBucket);

                default:
                    return resource;
            }
        }
        if (resource instanceof Object || Array.isArray(resource)) {
            for (const key in resource) {
                if (Object.getOwnPropertyDescriptor(resource, key).writable !== false) {
                    resource[String(key)] = await this.changeAttachmentWithGridFS({
                        resource: resource[String(key)],
                        metadata,
                        resourceId,
                        index: Array.isArray(resource) ? key : index,
                        operation
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
    */
    async convertDataToFileId(resource, filename, gridFSBucket) {
        if (resource.data) {
            const buffer = Buffer.from(resource.data);
            const stream = new Readable();
            stream.push(buffer);
            stream.push(null);
            const gridFSResult = stream.pipe(gridFSBucket.openUploadStream(filename));
            resource._file_id = gridFSResult.id.toString();
            delete resource.data;
        }
        return resource;
    }

    /**
     * changes the attachment._file_id to attachment.data if attachment._file_id is present
     * @param {Resource} resource
     * @param {import('mongodb').GridFSBucket} gridFSBucket
     * @returns {Promise<Resource>}
    */
    async convertFileIdToData(resource, gridFSBucket) {
        return new Promise((resolve) => {
            if (resource._file_id) {
                const downloadStream = gridFSBucket.openDownloadStream(new ObjectId(resource._file_id));

                downloadStream.on('data', (chunk) => {
                    resource.data = (resource.data) ? resource.data + chunk.toString() : chunk.toString();
                });

                downloadStream.on('end', () => {
                    delete resource._file_id;
                    resolve(resource);
                });
            } else {
                resolve(resource);
            }
        });
    }
}

module.exports = {
    DatabaseAttachmentManager,
};
