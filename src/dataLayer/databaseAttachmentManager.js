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
            resources.forEach(async (resource, index) => {
                if (enabledGridFsResources.includes(resource.resourceType)) {
                    resources = await this.changeAttachmentWithGridFS(
                        resource,
                        {resource_uuid: resource._uuid, resource_sourceId: resource._sourceId},
                        index
                    );
                }
            });
        }
        else if (enabledGridFsResources.includes(resources.resourceType)) {
            resources = await this.changeAttachmentWithGridFS(
                resources,
                {resource_uuid: resources._uuid, resource_sourceId: resources._sourceId}
            );
        }
        return resources;
    }

    /**
     * Converts the data field in attachments to _file_id returned by GridFS
     * @param {Object} resource
     * @param {Object} metadata
     * @param {number|string} index
    */
    async changeAttachmentWithGridFS(resource, metadata, index = 0) {
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
                    `${metadata.resource_sourceId}_${index}`, { metadata }
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
                        await this.changeAttachmentWithGridFS(
                            resource[String(key)], metadata, Array.isArray(resource) ? key : index
                        );
                }
            }
        }
        return newResource;
    }
}

module.exports = {
    DatabaseAttachmentManager,
};
