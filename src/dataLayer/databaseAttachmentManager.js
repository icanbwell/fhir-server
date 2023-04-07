const mongodb = require('mongodb');
var Readable = require('stream').Readable;
const env = require('var');

const Attachment = require('../fhir/classes/4_0_0/complex_types/attachment');
const { assertTypeEquals } = require('../utils/assertType');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');


class DatabaseAttachmentManager {
    /**
     * @param {MongoDatabaseManager} mongoDatabaseManager
    */
    constructor({mongoDatabaseManager}) {
        /**
         * @type {MongoDatabaseManager}
        */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    /**
     * Checks if the obj is of type attachment or not
     * @param {any} obj
    */
    isAttachment(obj) {
        return obj instanceof Attachment;
    }

    /**
     * Checks the type of resources and passes them to changeAttachmentWithGridFS
     * to change attachments
     * @param {Resource[]|Resource} resources
    */
    async transformAttachments(resources) {
        const resourceTypeForGridFS = env.GRIDFS_RESOURCES.split(',');
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const gridFSBucket = new mongodb.GridFSBucket(db);
        if (resources instanceof Array) {
            for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex++) {
                for (let resourceType of resourceTypeForGridFS) {
                    if (resources[parseInt(resourceIndex)].resourceType === resourceType) {
                        resources[parseInt(resourceIndex)] = await this.changeAttachmentWithGridFS(
                            resources[parseInt(resourceIndex)], gridFSBucket
                        );
                    }
                }
            }
        }
        else {
            resourceTypeForGridFS.forEach(async resourceType => {
                if (resources.resourceType === resourceType) {
                    resources = await this.changeAttachmentWithGridFS(
                        resources, gridFSBucket
                    );
                }
            });
        }
        return resources;
    }

    /**
     * Converts the data field in attachments to _file_id returned by GridFS
     * @param {Object} resource
     * @param {mongodb.GridFSBucket} gridFSBucket
    */
    async changeAttachmentWithGridFS(resource, gridFSBucket) {
        for (let attachmentIndex = 0; attachmentIndex < resource.content.length; attachmentIndex++) {
            let buffer = Buffer.from(resource.content[parseInt(attachmentIndex)].attachment.data);
            let stream = new Readable();
            stream.push(buffer);
            stream.push(null);
            let gridFSResult = stream.pipe(gridFSBucket.openUploadStream(resource.id));
            resource.content[parseInt(attachmentIndex)].attachment._file_id = gridFSResult.id.toString();
            delete resource.content[parseInt(attachmentIndex)].attachment.data;
        }
        return resource;
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
