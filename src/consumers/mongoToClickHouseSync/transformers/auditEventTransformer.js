const { DateTimeFormatter } = require('../../../utils/clickHouse/dateTimeFormatter');
const { logError } = require('../../../operations/common/logging');

class AuditEventTransformer {
    /**
     * Transforms a flat AuditEvent MongoDB document into a ClickHouse row
     * @param {Object} doc - MongoDB AuditEvent document (flat FHIR resource)
     * @returns {Object|null} ClickHouse row object or null if doc is malformed
     */
    transform(doc) {
        if (!doc || !doc.resourceType) {
            logError('AuditEventTransformer: skipping malformed document', {
                args: { mongoId: doc?._id?.toString() }
            });
            return null;
        }

        const recorded = doc.recorded;
        let recordedStr;
        if (recorded instanceof Date) {
            recordedStr = recorded.toISOString();
        } else if (typeof recorded === 'string') {
            recordedStr = recorded;
        } else {
            logError('AuditEventTransformer: missing recorded', {
                args: { mongoId: doc._id?.toString() }
            });
            return null;
        }

        if (!doc._uuid && !doc.id) {
            logError('AuditEventTransformer: missing _uuid and id', {
                args: { mongoId: doc._id?.toString() }
            });
            return null;
        }

        // Extract security tags
        const security = doc.meta?.security || [];
        const accessTag = security.find(s => s.system === 'https://www.icanbwell.com/access')?.code || '';
        const ownerTag = security.find(s => s.system === 'https://www.icanbwell.com/owner')?.code || '';

        // Strip _id from raw to avoid storing MongoDB internal field
        const { _id, ...docWithoutId } = doc;

        return {
            mongo_id: doc._id.toString(),
            resource_id: doc.id || doc._uuid,
            recorded: DateTimeFormatter.toClickHouseDateTime(recordedStr),
            type_code: doc.type?.coding?.[0]?.code || doc.type?.code || '',
            action: doc.action || '',
            outcome: doc.outcome || '',
            agent_who: doc.agent?.[0]?.who?.reference || '',
            source_observer: doc.source?.observer?.reference || '',
            entity_what: doc.entity?.[0]?.what?.reference || '',
            access_tag: accessTag,
            owner_tag: ownerTag,
            raw: JSON.stringify(docWithoutId)
        };
    }
}

module.exports = { AuditEventTransformer };
