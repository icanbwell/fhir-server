const { COLLECTIONS } = require('../../constants/mongoGroupMemberConstants');
const { EVENT_TYPES } = require('../../constants/clickHouseConstants');
const { PERSON_PROXY_PREFIX, PATIENT_REFERENCE_PREFIX } = require('../../constants');
const { FhirReferenceParser } = require('../../utils/fhir/referenceParser');
const { RethrownError } = require('../../utils/rethrownError');
const { BadRequestError } = require('../../utils/httpErrors');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const { logInfo } = require('../../operations/common/logging');
const { ReferenceParser } = require('../../utils/referenceParser');

const PROXY_PATIENT_MEMBER_TYPE = 'ProxyPatient';
const PATIENT_PERSON_PREFIX = `${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}`;

/**
 * Repository for Group member data access via MongoDB
 *
 * Same interface as GroupMemberRepository (ClickHouse) — appendEvents + getActiveMembers.
 * Transforms flat events from GroupMemberEventBuilder into FHIR-native documents
 * with denormalized ObjectId fields for compact, efficient indexes.
 *
 * Document schema (Group_4_0_0_MemberEvent):
 *   _id: ObjectId (monotonic ordering, replaces ClickHouse event_id UUID)
 *   group_id: ObjectId (Group resource _id — 12 bytes for compact indexes)
 *   group_uuid: String (Group _uuid for FHIR reference resolution)
 *   member_type: String (denormalized entity type — "Patient", "Practitioner", etc.)
 *   member_object_id: ObjectId (referenced resource _id for compact indexes)
 *   event_type: "added" | "removed"
 *   event_time: ISODate
 *   entity: { _uuid, _sourceId, reference } (FHIR-native member reference)
 *   period: { start, end }
 *   inactive: Boolean
 *
 * Current state is computed by the Group_4_0_0_MemberCurrent MongoDB view
 * ($sort + $group + $first pipeline over the event collection).
 */
class MongoGroupMemberRepository {
    /**
     * @param {Object} params
     * @param {import('../../utils/mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     */
    constructor({ mongoDatabaseManager }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
    }

    /**
     * Gets the event collection handle
     * @returns {Promise<import('mongodb').Collection>}
     * @private
     */
    async _getEventCollection() {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        return db.collection(COLLECTIONS.GROUP_MEMBER_EVENTS);
    }

    /**
     * Gets the current-state view handle
     * @returns {Promise<import('mongodb').Collection>}
     * @private
     */
    async _getCurrentView() {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        return db.collection(COLLECTIONS.GROUP_MEMBER_CURRENT);
    }

    /**
     * Resolves a Group _uuid string to its MongoDB ObjectId
     * @param {string} groupUuid - Group _uuid (e.g. "Group/group-123")
     * @returns {Promise<import('mongodb').ObjectId|null>}
     * @private
     */
    async _resolveGroupObjectId(groupUuid) {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const doc = await db.collection('Group_4_0_0').findOne(
            { _uuid: groupUuid },
            { projection: { _id: 1 } }
        );
        return doc ? doc._id : null;
    }

    /**
     * Resolves a Group string id to its MongoDB ObjectId
     * @param {string} groupId - Group id (e.g. "group-123")
     * @returns {Promise<import('mongodb').ObjectId|null>}
     * @private
     */
    async _resolveGroupObjectIdById(groupId) {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const doc = await db.collection('Group_4_0_0').findOne(
            { id: groupId },
            { projection: { _id: 1, _uuid: 1 } }
        );
        return doc ? { _id: doc._id, _uuid: doc._uuid } : null;
    }

    /**
     * Detects if an entity reference is a proxy patient (Patient/person.<uuid>)
     *
     * @param {string} entityReference - FHIR reference string
     * @returns {boolean}
     * @private
     */
    _isProxyPatientReference(entityReference) {
        return entityReference &&
            entityReference.startsWith(PATIENT_PERSON_PREFIX);
    }

    /**
     * Extracts the Person UUID from a proxy patient reference
     * e.g. "Patient/person.abc-123" → "abc-123"
     *
     * @param {string} entityReference
     * @returns {string} Person UUID
     * @private
     */
    _extractPersonUuid(entityReference) {
        return entityReference.replace(PATIENT_PERSON_PREFIX, '');
    }

    /**
     * Returns the correct member_type for an entity reference.
     * Proxy patient references (Patient/person.<uuid>) get type "ProxyPatient",
     * all others use the standard entity type from FhirReferenceParser.
     *
     * @param {string} entityReference
     * @param {string} fallbackType - entity_type from the event builder
     * @returns {string}
     * @private
     */
    _getMemberType(entityReference, fallbackType) {
        if (this._isProxyPatientReference(entityReference)) {
            return PROXY_PATIENT_MEMBER_TYPE;
        }
        return fallbackType;
    }

    /**
     * Batch-resolves entity references to their MongoDB ObjectIds
     *
     * Groups references by entity type, then does a single $in query per type.
     * Uses entity_uuid_ref (set by pre-save handler) for _uuid lookups.
     * Proxy patient references (Patient/person.<uuid>) are resolved from Person_4_0_0.
     *
     * @param {Array<{entity_reference: string, entity_uuid_ref: string, entity_type: string}>} events
     * @returns {Promise<Map<string, import('mongodb').ObjectId>>} Map of entity_reference → ObjectId
     * @private
     */
    async _resolveEntityObjectIds(events) {
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const objectIdMap = new Map();

        // Separate proxy patient refs from normal refs
        const proxyPersonUuids = new Map(); // personUuid → entity_uuid_ref
        // entityType → Map<uuid (id only), { uuidRef, entityReference }>
        const byType = new Map();
        // Events without entity_uuid_ref (e.g., removals from diff computer) — resolve by id
        // entityType → Map<entityId, entityReference>
        const byTypeById = new Map();

        for (const event of events) {
            const uuidRef = event.entity_uuid_ref;

            if (!uuidRef) {
                // Fallback: resolve by entity_reference (e.g., "Patient/123" → lookup by id)
                // This happens for removal events from GroupMemberDiffComputer
                const entityType = event.entity_type;
                const entityId = FhirReferenceParser.extractId(event.entity_reference);
                if (entityType && entityId) {
                    if (!byTypeById.has(entityType)) {
                        byTypeById.set(entityType, new Map());
                    }
                    byTypeById.get(entityType).set(entityId, event.entity_reference);
                }
                continue;
            }

            if (this._isProxyPatientReference(event.entity_reference)) {
                const personUuid = this._extractPersonUuid(event.entity_reference);
                proxyPersonUuids.set(personUuid, uuidRef);
            } else {
                const type = event.entity_type;
                if (!byType.has(type)) {
                    byType.set(type, new Map());
                }
                // Extract just the UUID from "ResourceType/<uuid>" for _uuid field lookup
                const { id: uuid } = ReferenceParser.parseReference(uuidRef);
                byType.get(type).set(uuid, { uuidRef, entityReference: event.entity_reference });
            }
        }

        const missingReferences = [];

        // Resolve proxy patient refs from Person_4_0_0
        if (proxyPersonUuids.size > 0) {
            const personUuidArray = [...proxyPersonUuids.keys()];
            const docs = await db.collection('Person_4_0_0')
                .find({ _uuid: { $in: personUuidArray } })
                .project({ _id: 1, _uuid: 1 })
                .toArray();

            const foundPersonUuids = new Set(docs.map(d => d._uuid));
            for (const doc of docs) {
                const uuidRef = proxyPersonUuids.get(doc._uuid);
                if (uuidRef) {
                    objectIdMap.set(uuidRef, doc._id);
                }
            }

            for (const [personUuid, uuidRef] of proxyPersonUuids) {
                if (!foundPersonUuids.has(personUuid)) {
                    missingReferences.push(uuidRef);
                }
            }
        }

        // Batch resolve normal refs per type — _uuid stores just the UUID, not the full reference
        for (const [entityType, uuidMap] of byType) {
            const collectionName = `${entityType}_4_0_0`;
            const uuidsArray = [...uuidMap.keys()];
            const docs = await db.collection(collectionName)
                .find({ _uuid: { $in: uuidsArray } })
                .project({ _id: 1, _uuid: 1 })
                .toArray();

            const foundUuids = new Set();
            for (const doc of docs) {
                const entry = uuidMap.get(doc._uuid);
                if (entry) {
                    objectIdMap.set(entry.uuidRef, doc._id);
                    foundUuids.add(doc._uuid);
                }
            }

            // Collect missing references
            for (const [uuid, entry] of uuidMap) {
                if (!foundUuids.has(uuid)) {
                    missingReferences.push(entry.entityReference);
                }
            }
        }

        // Resolve events that only have entity_reference (no _uuid) — e.g., removal events
        for (const [entityType, idMap] of byTypeById) {
            const collectionName = `${entityType}_4_0_0`;
            const idsArray = [...idMap.keys()];
            const docs = await db.collection(collectionName)
                .find({ id: { $in: idsArray } })
                .project({ _id: 1, id: 1 })
                .toArray();

            const foundIds = new Set();
            for (const doc of docs) {
                const entityReference = idMap.get(doc.id);
                if (entityReference) {
                    // Key by entity_reference for events without _uuid
                    objectIdMap.set(entityReference, doc._id);
                    foundIds.add(doc.id);
                }
            }

            for (const [entityId, entityReference] of idMap) {
                if (!foundIds.has(entityId)) {
                    missingReferences.push(entityReference);
                }
            }
        }

        if (missingReferences.length > 0) {
            const message = `Group member references not found in database: ${missingReferences.join(', ')}`;
            throw new BadRequestError({
                message,
                toString: function () { return message; }
            }, {
                issue: [new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'not-found',
                    diagnostics: message
                })]
            });
        }

        return objectIdMap;
    }

    /**
     * Transforms a flat event from GroupMemberEventBuilder into a MongoDB document
     *
     * @param {Object} event - Flat event from builder
     * @param {import('mongodb').ObjectId} groupObjectId - Resolved Group ObjectId
     * @param {string} groupUuid - Group _uuid string
     * @param {Map<string, import('mongodb').ObjectId>} entityObjectIdMap - entity_reference → ObjectId
     * @returns {Object} MongoDB document for insertion
     * @private
     */
    _transformEventToDocument(event, groupObjectId, groupUuid, entityObjectIdMap) {
        // Try entity_uuid_ref first (CREATE path), fall back to entity_reference (removal events)
        const memberObjectId = entityObjectIdMap.get(event.entity_uuid_ref) ||
            entityObjectIdMap.get(event.entity_reference) || null;

        return {
            group_id: groupObjectId,
            group_uuid: groupUuid,
            member_type: this._getMemberType(event.entity_reference, event.entity_type),
            member_object_id: memberObjectId,
            event_type: event.event_type,
            event_time: event.event_time ? new Date(event.event_time) : new Date(),
            entity: {
                _uuid: event.entity_uuid_ref || event.entity_reference,
                _sourceId: event.entity_reference,
                reference: event.entity_reference
            },
            period: {
                start: event.period_start ? new Date(event.period_start) : null,
                end: event.period_end ? new Date(event.period_end) : null
            },
            inactive: event.inactive === 1 || event.inactive === true
        };
    }

    /**
     * Appends member events to the MongoDB event collection
     *
     * Transforms flat events from GroupMemberEventBuilder → FHIR-native documents
     * with denormalized ObjectId fields, then inserts via insertMany.
     *
     * @param {Array<Object>} events - Array of flat event objects from GroupMemberEventBuilder
     * @returns {Promise<void>}
     */
    async appendEvents(events) {
        try {
            if (!events || events.length === 0) {
                return;
            }

            const firstEvent = events[0];
            const groupId = firstEvent.group_id;

            // Resolve Group ObjectId
            const groupLookup = await this._resolveGroupObjectIdById(groupId);
            if (!groupLookup) {
                throw new Error(`Group not found for id: ${groupId}`);
            }
            const { _id: groupObjectId, _uuid: groupUuid } = groupLookup;

            // Batch resolve entity ObjectIds
            const entityObjectIdMap = await this._resolveEntityObjectIds(events);

            // Transform all events to MongoDB documents
            const documents = events.map(event =>
                this._transformEventToDocument(event, groupObjectId, groupUuid, entityObjectIdMap)
            );

            // Insert into event collection
            const collection = await this._getEventCollection();
            await collection.insertMany(documents, { ordered: false });

            logInfo('Appended member events to MongoDB', {
                groupId,
                count: documents.length
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error appending events to MongoDB group member repository',
                error,
                args: { eventCount: events?.length || 0 }
            });
        }
    }

    /**
     * Retrieves all currently active member references for a Group
     *
     * Queries the Group_4_0_0_MemberCurrent view which computes current state
     * via $sort + $group + $first over the event log.
     *
     * @param {string} groupId - Group resource ID
     * @returns {Promise<string[]>} Array of member reference strings (e.g. ["Patient/1", "Patient/2"])
     */
    async getActiveMembers(groupId) {
        try {
            // Resolve Group ObjectId for view query
            const groupLookup = await this._resolveGroupObjectIdById(groupId);
            if (!groupLookup) {
                return [];
            }

            const view = await this._getCurrentView();
            const docs = await view.find({
                group_id: groupLookup._id,
                event_type: EVENT_TYPES.MEMBER_ADDED,
                $or: [{ inactive: false }, { inactive: { $exists: false } }]
            }).project({
                'entity.reference': 1
            }).toArray();

            return docs.map(d => d.entity.reference);
        } catch (error) {
            throw new RethrownError({
                message: 'Error retrieving active members from MongoDB repository',
                error,
                args: { groupId }
            });
        }
    }

    /**
     * Gets the count of active members for a Group
     *
     * @param {string} groupId - Group resource ID
     * @returns {Promise<number>} Count of active members
     */
    async getActiveMemberCount(groupId) {
        try {
            const groupLookup = await this._resolveGroupObjectIdById(groupId);
            if (!groupLookup) {
                return 0;
            }

            const view = await this._getCurrentView();
            return await view.countDocuments({
                group_id: groupLookup._id,
                event_type: EVENT_TYPES.MEMBER_ADDED,
                $or: [{ inactive: false }, { inactive: { $exists: false } }]
            });
        } catch (error) {
            throw new RethrownError({
                message: 'Error counting active members from MongoDB repository',
                error,
                args: { groupId }
            });
        }
    }

    /**
     * Resolves a FHIR entity reference to its MongoDB ObjectId and member type.
     * Used by search queries to leverage indexed ObjectId fields instead of string-based lookups.
     *
     * - Normal refs (e.g., "Patient/123"): looks up by id in {EntityType}_4_0_0
     * - Proxy patient refs (e.g., "Patient/person.abc-123"): looks up by _uuid in Person_4_0_0
     *
     * @param {string} entityReference - FHIR reference (e.g., "Patient/123")
     * @returns {Promise<{objectId: import('mongodb').ObjectId, memberType: string}|null>}
     * @private
     */
    async _resolveMemberObjectId(entityReference) {
        const db = await this.mongoDatabaseManager.getClientDbAsync();

        if (this._isProxyPatientReference(entityReference)) {
            const personUuid = this._extractPersonUuid(entityReference);
            const doc = await db.collection('Person_4_0_0').findOne(
                { _uuid: personUuid },
                { projection: { _id: 1 } }
            );
            return doc ? { objectId: doc._id, memberType: PROXY_PATIENT_MEMBER_TYPE } : null;
        }

        const entityType = FhirReferenceParser.extractEntityType(entityReference);
        const entityId = FhirReferenceParser.extractId(entityReference);
        if (!entityType || entityType === 'unknown' || !entityId) {
            return null;
        }

        const collectionName = `${entityType}_4_0_0`;
        const doc = await db.collection(collectionName).findOne(
            { id: entityId },
            { projection: { _id: 1 } }
        );
        return doc ? { objectId: doc._id, memberType: entityType } : null;
    }

    /**
     * Resolves a member _uuid (e.g., "Patient/some-uuid" or bare "some-uuid") to its ObjectId.
     * Searches across known FHIR resource collections by _uuid field.
     *
     * @param {string} memberUuid - _uuid value from query
     * @returns {Promise<{objectId: import('mongodb').ObjectId, memberType: string}|null>}
     * @private
     */
    async _resolveMemberByUuid(memberUuid) {
        const db = await this.mongoDatabaseManager.getClientDbAsync();

        // If it looks like "ResourceType/uuid", parse it
        const entityType = FhirReferenceParser.extractEntityType(memberUuid);
        if (entityType && entityType !== 'unknown') {
            const uuid = FhirReferenceParser.extractId(memberUuid);
            const collectionName = `${entityType}_4_0_0`;
            const doc = await db.collection(collectionName).findOne(
                { _uuid: uuid },
                { projection: { _id: 1 } }
            );
            return doc ? { objectId: doc._id, memberType: entityType } : null;
        }

        // Bare UUID — search common member resource types
        const candidateTypes = ['Patient', 'Practitioner', 'Device', 'Medication', 'Substance'];
        for (const type of candidateTypes) {
            const doc = await db.collection(`${type}_4_0_0`).findOne(
                { _uuid: memberUuid },
                { projection: { _id: 1 } }
            );
            if (doc) {
                return { objectId: doc._id, memberType: type };
            }
        }
        return null;
    }

    /**
     * Resolves a member _sourceId to its ObjectId.
     *
     * @param {string} memberSourceId - _sourceId value from query
     * @returns {Promise<{objectId: import('mongodb').ObjectId, memberType: string}|null>}
     * @private
     */
    async _resolveMemberBySourceId(memberSourceId) {
        const db = await this.mongoDatabaseManager.getClientDbAsync();

        // If it looks like "ResourceType/id", parse it
        const entityType = FhirReferenceParser.extractEntityType(memberSourceId);
        if (entityType && entityType !== 'unknown') {
            const sourceId = FhirReferenceParser.extractId(memberSourceId);
            const collectionName = `${entityType}_4_0_0`;
            const doc = await db.collection(collectionName).findOne(
                { _sourceId: sourceId },
                { projection: { _id: 1 } }
            );
            return doc ? { objectId: doc._id, memberType: entityType } : null;
        }

        // Bare sourceId — search common member resource types
        const candidateTypes = ['Patient', 'Practitioner', 'Device', 'Medication', 'Substance'];
        for (const type of candidateTypes) {
            const doc = await db.collection(`${type}_4_0_0`).findOne(
                { _sourceId: memberSourceId },
                { projection: { _id: 1 } }
            );
            if (doc) {
                return { objectId: doc._id, memberType: type };
            }
        }
        return null;
    }

    /**
     * Finds Group IDs by member using any available criteria (reference, uuid, or sourceId).
     * Unlike ClickHouse, MongoDB can resolve any identifier to an ObjectId.
     *
     * @param {Object} criteria - Extracted member criteria from QueryParser
     * @param {string|null} criteria.memberReference - Direct entity reference
     * @param {string|null} criteria.memberSourceId - _sourceId value
     * @param {string|null} criteria.memberUuid - _uuid value
     * @returns {Promise<string[]>} Array of Group _uuid strings
     */
    async findGroupsByMemberCriteria({ memberReference, memberSourceId, memberUuid }) {
        try {
            let resolved = null;

            // Priority: reference > sourceId > uuid
            if (memberReference) {
                resolved = await this._resolveMemberObjectId(memberReference);
            } else if (memberSourceId) {
                resolved = await this._resolveMemberBySourceId(memberSourceId);
            } else if (memberUuid) {
                resolved = await this._resolveMemberByUuid(memberUuid);
            }

            if (!resolved) {
                return [];
            }

            const view = await this._getCurrentView();
            const filter = this._buildMemberFilter(resolved.memberType, resolved.objectId);
            const docs = await view.find(filter).project({
                group_uuid: 1
            }).toArray();

            return docs.map(d => d.group_uuid);
        } catch (error) {
            throw new RethrownError({
                message: 'Error finding groups by member criteria from MongoDB repository',
                error,
                args: { memberReference, memberSourceId, memberUuid }
            });
        }
    }

    /**
     * Finds Group IDs that contain a given member entity
     *
     * Resolves the entity reference to its ObjectId, then queries the MongoDB view
     * using indexed fields (member_type + member_object_id) for efficient lookup.
     *
     * @param {string} entityReference - FHIR entity reference (e.g. "Patient/123")
     * @returns {Promise<string[]>} Array of Group _uuid strings
     */
    async findGroupsByMember(entityReference) {
        try {
            const resolved = await this._resolveMemberObjectId(entityReference);
            if (!resolved) {
                return [];
            }

            const view = await this._getCurrentView();
            const filter = this._buildMemberFilter(resolved.memberType, resolved.objectId);
            const docs = await view.find(filter).project({
                group_uuid: 1
            }).toArray();

            return docs.map(d => d.group_uuid);
        } catch (error) {
            throw new RethrownError({
                message: 'Error finding groups by member from MongoDB repository',
                error,
                args: { entityReference }
            });
        }
    }

    /**
     * Counts Group IDs that contain a given member entity
     *
     * @param {string} entityReference - FHIR entity reference (e.g. "Patient/123")
     * @returns {Promise<number>} Count of groups
     */
    async countGroupsByMember(entityReference) {
        try {
            const resolved = await this._resolveMemberObjectId(entityReference);
            if (!resolved) {
                return 0;
            }

            const view = await this._getCurrentView();
            const filter = this._buildMemberFilter(resolved.memberType, resolved.objectId);
            return await view.countDocuments(filter);
        } catch (error) {
            throw new RethrownError({
                message: 'Error counting groups by member from MongoDB repository',
                error,
                args: { entityReference }
            });
        }
    }

    /**
     * Builds a MongoDB filter for querying by member using indexed ObjectId fields.
     * Matches index: { member_type: 1, member_object_id: 1, group_id: 1, _id: -1 }
     *
     * @param {string} memberType - Member type (e.g., "Patient", "ProxyPatient")
     * @param {import('mongodb').ObjectId} memberObjectId - Resolved member ObjectId
     * @returns {Object} MongoDB filter
     * @private
     */
    _buildMemberFilter(memberType, memberObjectId) {
        return {
            member_type: memberType,
            member_object_id: memberObjectId,
            event_type: EVENT_TYPES.MEMBER_ADDED,
            $or: [{ inactive: false }, { inactive: { $exists: false } }]
        };
    }

    /**
     * Validates that all member entity references point to resources that exist in the database.
     * Proxy patient references (Patient/person.<uuid>) are checked against Person_4_0_0.
     *
     * @param {Array<Object>} members - FHIR Group.member array (each has entity.reference)
     * @returns {Promise<{valid: boolean, missingReferences: string[]}>}
     */
    async validateMembersExistAsync(members) {
        if (!members || members.length === 0) {
            return { valid: true, missingReferences: [] };
        }

        const db = await this.mongoDatabaseManager.getClientDbAsync();

        // Separate proxy patient refs from normal refs, grouped by collection
        const proxyPersonUuids = new Map(); // personUuid → original reference string
        const byType = new Map(); // entityType → Set<reference>

        for (const member of members) {
            const ref = member?.entity?.reference;
            const uuidRef = member?.entity?._uuid;
            if (!ref || !uuidRef) {
                throw new Error(`Member is missing entity reference or UUID: ${JSON.stringify(member)}`);
            }
            const { id: uuid } = ReferenceParser.parseReference(uuidRef);
            if (this._isProxyPatientReference(ref)) {
                const personUuid = this._extractPersonUuid(ref);
                proxyPersonUuids.set(personUuid, ref);
            } else {
                const entityType = FhirReferenceParser.extractEntityType(ref);
                if (!byType.has(entityType)) {
                    byType.set(entityType, new Map());
                }
                // Map uuid → original reference (for error reporting)
                byType.get(entityType).set(uuid, ref);
            }
        }

        const missingReferences = [];

        // Check proxy patient references against Person_4_0_0
        if (proxyPersonUuids.size > 0) {
            const personUuidArray = [...proxyPersonUuids.keys()];
            const foundDocs = await db.collection('Person_4_0_0')
                .find({ _uuid: { $in: personUuidArray } })
                .project({ _uuid: 1 })
                .toArray();

            const foundUuids = new Set(foundDocs.map(d => d._uuid));
            for (const [personUuid, originalRef] of proxyPersonUuids) {
                if (!foundUuids.has(personUuid)) {
                    missingReferences.push(originalRef);
                }
            }
        }

        // Check normal references per resource type using _uuid lookups
        for (const [entityType, uuidToRefMap] of byType) {
            const collectionName = `${entityType}_4_0_0`;
            const uuidsArray = [...uuidToRefMap.keys()];
            const foundDocs = await db.collection(collectionName)
                .find({ _uuid: { $in: uuidsArray } })
                .project({ _uuid: 1 })
                .toArray();

            const foundUuids = new Set(foundDocs.map(d => d._uuid));
            for (const [uuid, originalRef] of uuidToRefMap) {
                if (!foundUuids.has(uuid)) {
                    missingReferences.push(originalRef);
                }
            }
        }

        return {
            valid: missingReferences.length === 0,
            missingReferences
        };
    }
}

module.exports = { MongoGroupMemberRepository };
