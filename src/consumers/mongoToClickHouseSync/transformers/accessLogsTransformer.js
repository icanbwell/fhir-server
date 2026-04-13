const { DateTimeFormatter } = require('../../../utils/clickHouse/dateTimeFormatter');
const { logError } = require('../../../operations/common/logging');

class AccessLogsTransformer {
    /**
     * Transforms a MongoDB access log document into a ClickHouse row
     * @param {Object} doc - MongoDB access log document (custom non-FHIR schema)
     * @returns {Object|null} ClickHouse row object or null if doc is malformed
     */
    transform(doc) {
        if (!doc || !doc._id) {
            logError('AccessLogsTransformer: skipping malformed document', {
                args: { mongoId: doc?._id?.toString() }
            });
            return null;
        }

        const timestamp = doc.timestamp;
        let timestampStr;
        if (timestamp instanceof Date) {
            timestampStr = timestamp.toISOString();
        } else if (typeof timestamp === 'string') {
            timestampStr = timestamp;
        } else {
            logError('AccessLogsTransformer: missing timestamp', {
                args: { mongoId: doc._id?.toString() }
            });
            return null;
        }

        return {
            mongo_id: doc._id.toString(),
            timestamp: DateTimeFormatter.toClickHouseDateTime(timestampStr),
            method: doc.request?.method || '',
            url: doc.request?.url || '',
            resource_type: doc.request?.resourceType || '',
            operation: doc.request?.operation || '',
            duration: doc.request?.duration || 0,
            outcome: doc.outcomeDesc || '',
            agent_alt_id: doc.agent?.altId || '',
            network_address: doc.agent?.networkAddress || '',
            request_id: doc.request?.systemGeneratedRequestId || '',
            raw: JSON.stringify(doc)
        };
    }
}

module.exports = { AccessLogsTransformer };
