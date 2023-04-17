const Readable = require('stream').Readable;
const ObjectId = require('mongodb').ObjectId;

const { assertTypeEquals } = require('../utils/assertType');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');
const { ConfigManager } = require('../utils/configManager');
const Attachment = require('../fhir/classes/4_0_0/complex_types/attachment');

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
     * Checks if GridFs is applicable on the resource and
     * if applicable changes resources based on the create value
     * @param {Resource[]|Resource} resources
    */
    async transformAttachments(resources, create = true) {
        const enabledGridFsResources = this.configManager.enabledGridFsResources;
        if (Array.isArray(resources)) {
            for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
                if (enabledGridFsResources.includes(resources[resourceIndex].resourceType)) {
                    let metadata = {};
                    if (create) {
                        if (resources[resourceIndex]._uuid) {
                            metadata['resource_uuid'] = resources[resourceIndex]._uuid;
                        }
                        if (resources[resourceIndex]._sourceId) {
                            metadata['resource_sourceId'] = resources[resourceIndex]._sourceId;
                        }
                    }
                    resources[resourceIndex] = await this.changeAttachmentWithGridFS({
                        resource: resources[resourceIndex],
                        resourceId: resources[resourceIndex].id,
                        index: resourceIndex,
                        metadata,
                        create
                    });
                }
            }
        }
        else if (enabledGridFsResources.includes(resources.resourceType)) {
            let metadata = {};
            if (create) {
                if (resources._uuid) {
                    metadata['resource_uuid'] = resources._uuid;
                }
                if (resources._sourceId) {
                    metadata['resource_sourceId'] = resources._sourceId;
                }
            }
            resources = await this.changeAttachmentWithGridFS({
                resource: resources,
                resourceId: resources.id,
                metadata,
                create
            });
        }
        return resources;
    }

    /**
     * Changes attachment with gridFs or restores the attachment based on create value passed
     * @param {Object} resource
     * @param {Object} metadata
     * @param {Number} resourceId
     * @param {Boolean} create
     * @param {Number|String} index
    */
    async changeAttachmentWithGridFS({resource, resourceId, metadata, index = 0, create = true}) {
        if (!resource) {
            return resource;
        }
        if (resource instanceof Attachment) {
            const gridFSBucket = await this.mongoDatabaseManager.getGridFsBucket();
            if (create && resource.data) {
                const buffer = Buffer.from(resource.data);
                const stream = new Readable();
                stream.push(buffer);
                stream.push(null);
                const gridFSResult = stream.pipe(gridFSBucket.openUploadStream(
                    `${resourceId}_${index}`
                ));
                resource._file_id = gridFSResult.id.toString();
                delete resource.data;
            }
            if (!create && resource._file_id) {
                const db = await this.mongoDatabaseManager.getClientDbAsync();
                const chunks = await db.collection('fs.chunks').find({
                    files_id: new ObjectId(resource._file_id)
                }).toArray();
                // to get the chunks in order, n represents the nth chunk
                chunks.sort((chunk1, chunk2) => chunk1.n - chunk2.n);
                chunks.forEach((chunk) => {
                    if (resource.data) {
                        resource.data += chunk.data.toString();
                    }
                    else {
                        resource.data = chunk.data.toString();
                    }
                });
                delete resource._file_id;
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
                        create
                    });
                }
            }
        }
        return resource;
    }
}

module.exports = {
    DatabaseAttachmentManager,
};
