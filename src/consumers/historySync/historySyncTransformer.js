const { DateTimeFormatter } = require('../../utils/clickHouse/dateTimeFormatter');
const { logError } = require('../../operations/common/logging');

class HistorySyncTransformer {
    /**
     * Transforms a MongoDB History document into a ClickHouse row
     * @param {Object} doc - MongoDB history document
     * @returns {Object|null} ClickHouse row object or null if doc is malformed
     */
    transform(doc) {
        if (!doc || !doc.resource || !doc.resource.resourceType) {
            logError('HistorySyncTransformer: skipping malformed document', {
                args: { mongoId: doc?._id?.toString() }
            });
            return null;
        }

        const lastUpdated = doc.resource?.meta?.lastUpdated;
        let lastUpdatedStr;
        if (lastUpdated instanceof Date) {
            lastUpdatedStr = lastUpdated.toISOString();
        } else if (typeof lastUpdated === 'string') {
            lastUpdatedStr = lastUpdated;
        } else {
            logError('HistorySyncTransformer: missing lastUpdated', {
                args: { mongoId: doc._id?.toString() }
            });
            return null;
        }

        return {
            resource_type: doc.resource.resourceType,
            resource_uuid: doc.id || doc.resource._uuid,
            mongo_id: doc._id.toString(),
            last_updated: DateTimeFormatter.toClickHouseDateTime(lastUpdatedStr),
            raw: JSON.stringify({
                resource: doc.resource,
                request: doc.request,
                response: doc.response
            })
        };
    }
}

module.exports = { HistorySyncTransformer };
