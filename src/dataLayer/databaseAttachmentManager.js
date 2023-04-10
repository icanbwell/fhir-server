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
                const resource = resources[parseInt(resourceIndex)];
                if (enabledGridFsResources.includes(resource.resourceType)) {
                    resources[parseInt(resourceIndex)] =
                        await this.changeAttachmentWithGridFS(
                            resource,
                            resource.id,
                            resourceIndex
                        );
                }
            }
        }
        else if (enabledGridFsResources.includes(resources.resourceType)) {
            resources = await this.changeAttachmentWithGridFS(resources, resources.id);
        }
        return resources;
    }

    /**
     * Converts the data field in attachments to _file_id returned by GridFS
     * @param {Object} resource
    */
    async changeAttachmentWithGridFS(resource, resourceId, index = 0) {
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
                    `${resourceId}_${index}`,
                    {
                        metadata: { resourceId: resourceId }
                    }
                ));
                resource._file_id = gridFSResult.id.toString();
                delete resource.data;
            }
            return resource;
        }
        let newResource = resource;
        if (resource instanceof Object || Array.isArray(resource)) {
            newResource = Array.isArray(resource) ? [] : {};
            for (const key in resource) {
                if (resource[String(key)]) {
                    newResource[String(key)] =
                        await this.changeAttachmentWithGridFS(resource[String(key)], resourceId, index);
                }
            }
        }
        return newResource;
    }

    /**
     * @TODO Will be implemented when fetching the resource
    */
    restoreAttachment(resource) {
        return resource;
    }
}

module.exports = {
    DatabaseAttachmentManager,
};
