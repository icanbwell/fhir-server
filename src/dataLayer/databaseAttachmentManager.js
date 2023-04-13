const Readable = require('stream').Readable;

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
     * Checks if GridFs is applicable on the resource and if applicable applies GridFs
     * @param {Resource[]|Resource} resources
    */
    async transformAttachments(resources) {
        const enabledGridFsResources = this.configManager.enabledGridFsResources;
        if (Array.isArray(resources)) {
            for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
                if (enabledGridFsResources.includes(resources[resourceIndex].resourceType)) {
                    let metadata = {};
                    if (resources[resourceIndex]._uuid) {
                        metadata['resource_uuid'] = resources[resourceIndex]._uuid;
                    }
                    if (resources[resourceIndex]._sourceId) {
                        metadata['resource_sourceId'] = resources[resourceIndex]._sourceId;
                    }
                    resources[resourceIndex] = await this.changeAttachmentWithGridFS(
                        resources[resourceIndex],
                        metadata,
                        resources[resourceIndex].id,
                        resourceIndex
                    );
                }
            }
        }
        else if (enabledGridFsResources.includes(resources.resourceType)) {
            let metadata = {};
            if (resources._uuid) {
                metadata['resource_uuid'] = resources._uuid;
            }
            if (resources._sourceId) {
                metadata['resource_sourceId'] = resources._sourceId;
            }
            resources = await this.changeAttachmentWithGridFS(resources, metadata, resources.id);
        }
        return resources;
    }

    /**
     * Converts the data field in attachments to _file_id returned by GridFS
     * @param {Object} resource
     * @param {Object} metadata
     * @param {number|string} index
    */
    async changeAttachmentWithGridFS(resource, metadata, resourceId, index = 0) {
        if (!resource) {
            return resource;
        }
        if (resource instanceof Attachment) {
            const gridFSBucket = await this.mongoDatabaseManager.getGridFsBucket();
            if (resource.data) {
                const buffer = Buffer.from(resource.data);
                const stream = new Readable();
                stream.push(buffer);
                stream.push(null);
                const gridFSResult = stream.pipe(gridFSBucket.openUploadStream(
                    `${resourceId}_${index}`, { metadata }
                ));
                resource._file_id = gridFSResult.id.toString();
                delete resource.data;
            }
            return resource;
        }
        if (resource instanceof Object || Array.isArray(resource)) {
            for (const key in resource) {
                if (Object.getOwnPropertyDescriptor(resource, key).writable !== false) {
                    resource[String(key)] = await this.changeAttachmentWithGridFS(
                        resource[String(key)],
                        metadata,
                        resourceId,
                        Array.isArray(resource) ? key : index
                    );
                }
            }
        }
        return resource;
    }
}

module.exports = {
    DatabaseAttachmentManager,
};
