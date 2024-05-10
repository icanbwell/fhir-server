const { RethrownError } = require('../../utils/rethrownError');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { FixDuplicateOwnerTagsRunner } = require('./fixDuplicateOwnerTagsRunner');

class FixMultipleOwnerTagsRunner extends FixDuplicateOwnerTagsRunner {
    /**
     * Removes Multiple owner tags from the resource and keeps the one with sourceAssigningAuthority
     */
    removeDuplicateOwnerTags (resource) {
        if (resource?.meta?.security) {
            const sourceAssigningAuthority = resource.meta.security.find(
                s => (s.system === SecurityTagSystem.sourceAssigningAuthority)
            )?.code;

            if (!sourceAssigningAuthority) {
                this.adminLogger.logError(`Resource ${resource._uuid} without sourceAssigningAuthority tag`);
                return resource;
            }
            resource.meta.security = resource.meta.security.filter(s => {
                if (s.system !== SecurityTagSystem.owner) {
                    return true;
                }
                return s.code === sourceAssigningAuthority;
            });
        }
        return resource;
    }

    async getResourceUuidsWithMultipleOwnerTagsAsync ({ collectionName }) {
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

        this.adminLogger.logInfo(`Processing ${collectionName} collection`);
        const { collection, client, session } = await this.createSingeConnectionAsync({
            mongoConfig,
            collectionName
        });
        try {
            const cursorMultiple = collection.aggregate([
                { $unwind: '$meta.security' },
                { $match: { 'meta.security.system': SecurityTagSystem.owner } },
                {
                    $group: {
                        _id: '$_uuid',
                        count: { $sum: 1 }
                    }
                },
                { $match: { count: { $gt: 1 } } }
            ]);

            const uuids = [];
            while (await cursorMultiple.hasNext()) {
                const data = await cursorMultiple.next();
                uuids.push(data._id);
            }
            return uuids;
        } catch (err) {
            this.adminLogger.logError(
                `Error in getResourceUuidsWithMultipleOwnerTags: ${err.message}`,
                {
                    stack: err.stack
                }
            );

            throw new RethrownError({
                message: err.message,
                error: err
            });
        } finally {
            await session.endSession();
            await client.close();
        }
    }
}

module.exports = { FixMultipleOwnerTagsRunner };
