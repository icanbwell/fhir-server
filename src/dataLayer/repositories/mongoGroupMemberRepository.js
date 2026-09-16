const { assertTypeEquals } = require('../../utils/assertType');
const { DatabaseQueryFactory } = require('../databaseQueryFactory');
const { DatabaseBulkInserter } = require('../databaseBulkInserter');
const GroupMember = require('../../fhir/classes/4_0_0/custom_resources/groupMember');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { GROUP_MEMBER_RESOURCE_TYPE } = require('../../constants');
const { resolveMemberWrite } = require('../../operations/common/resolveMemberWrite');

/**
 * Repository for the MongoDB-native, large-Group member storage introduced by DCON-5527:
 * GroupMember rows written through the shared DatabaseBulkInserter / MongoBulkWriteExecutor
 * pipeline (resourceType 'GroupMember'; not a real FHIR resource, but registered as a custom
 * resource class under src/fhir/classes/4_0_0/custom_resources/ so the write pipeline's
 * internal FhirResourceCreator lookups -- e.g. MongoBulkWriteExecutor's one-by-one fallback --
 * can construct it. Reads still go through the raw-document path, not toObjectArrayAsync()).
 */
class MongoGroupMemberRepository {
    /**
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseBulkInserter} databaseBulkInserter
     */
    constructor({ databaseQueryFactory, databaseBulkInserter }) {
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /** @type {DatabaseQueryFactory} */
        this.databaseQueryFactory = databaseQueryFactory;

        assertTypeEquals(databaseBulkInserter, DatabaseBulkInserter);
        /** @type {DatabaseBulkInserter} */
        this.databaseBulkInserter = databaseBulkInserter;
    }

    /**
     * Derives a membership row's id deterministically from the owning Group and the member
     * reference, so repeated calls for the same pair always target the same row.
     * @param {string} groupUuid
     * @param {string} reference
     * @returns {string}
     */
    static memberRowUuid(groupUuid, reference) {
        return generateUUIDv5(`${groupUuid}|${reference}`);
    }

    /**
     * Queues a batch of $member-add / $member-remove events against the live roster; each
     * membership is targeted directly by its own deterministic row id -- the incoming set is
     * never diffed against the whole roster.
     *
     * @param {Object} params
     * @param {FhirRequestInfo} params.requestInfo
     * @param {string} params.base_version
     * @param {string} params.groupUuid
     * @param {number} params.groupVersionId - parent Group's meta.versionId at time of write
     * @param {string} params.sourceAssigningAuthority - copied from the owning Group; required by ReferenceGlobalIdHandler
     * @param {Coding[]|undefined} params.securityTags - copied from the owning Group's meta.security; ResourceMerger's
     *     one-by-one concurrency fallback (hit on every fresh upsert, since a new row's modifiedCount reads as 0)
     *     unconditionally reads currentResource.meta.security, so every row needs this populated like a real resource.
     * @param {Array<{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}>} params.events
     * @returns {Promise<Array<{reference:string, operation:'create'|'reactivate'|'update'|'deactivate'|'none'}>>}
     */
    async applyMemberEventsAsync({ requestInfo, base_version, groupUuid, groupVersionId, sourceAssigningAuthority, securityTags, events }) {
        if (!events || events.length === 0) {
            return [];
        }

        // De-dupe by row id within one call -- last event for a given reference wins.
        const eventsByRowUuid = new Map();
        for (const event of events) {
            const memberRowUuid = MongoGroupMemberRepository.memberRowUuid(groupUuid, event.entity.reference);
            eventsByRowUuid.set(memberRowUuid, { ...event, memberRowUuid });
        }

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: GROUP_MEMBER_RESOURCE_TYPE,
            base_version
        });
        const cursor = await databaseQueryManager.findAsync({
            query: { groupUuid, memberRowUuid: { $in: [...eventsByRowUuid.keys()] } }
        });
        // Raw documents, not toObjectArrayAsync(): 'GroupMember' isn't registered with
        // FhirResourceCreator, so only the write path (which needs a Resource instance) uses
        // the GroupMember class -- reads only need the plain field values.
        const existingRows = await cursor.toArrayAsync();
        const existingByRowUuid = new Map(existingRows.map((r) => [r.memberRowUuid, r]));

        const now = new Date();
        const outcomes = [];

        for (const [memberRowUuid, event] of eventsByRowUuid) {
            const existingRow = existingByRowUuid.get(memberRowUuid);
            const { classification, member } = resolveMemberWrite(existingRow?.member, event);

            outcomes.push({ reference: event.entity.reference, operation: classification });

            if (classification === 'none') {
                continue;
            }

            const previousVersionId = parseInt(existingRow?.meta?.versionId, 10);
            const doc = new GroupMember({
                id: memberRowUuid,
                meta: new Meta({
                    versionId: `${Number.isNaN(previousVersionId) ? 1 : previousVersionId + 1}`,
                    lastUpdated: now,
                    security: securityTags
                }),
                _sourceAssigningAuthority: sourceAssigningAuthority,
                groupUuid,
                memberRowUuid,
                groupVersionId,
                member,
                operation: classification
            });

            if (classification === 'create') {
                await this.databaseBulkInserter.insertOneAsync({
                    requestInfo,
                    base_version,
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    doc
                });
            } else {
                await this.databaseBulkInserter.replaceOneAsync({
                    requestInfo,
                    resourceType: GROUP_MEMBER_RESOURCE_TYPE,
                    uuid: memberRowUuid,
                    doc,
                    patches: null
                });
            }
        }

        return outcomes;
    }
}

module.exports = { MongoGroupMemberRepository };
