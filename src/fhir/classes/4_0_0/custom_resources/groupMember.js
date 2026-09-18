const Resource = require('../resources/resource');

/**
 * Hand-authored pseudo-FHIR-resource for a single Group_Member row.
 *
 * Not a real FHIR resource type -- it exists only so Group roster rows can flow through the
 * shared DatabaseBulkInserter / MongoBulkWriteExecutor write pipeline instead of a bespoke
 * writer. The resourceType 'GroupMember' drives collection naming via ResourceLocator
 * (`${resourceType}_${base_version}`), giving GroupMember_4_0_0 / GroupMember_4_0_0_History.
 *
 * Registered under src/fhir/classes/4_0_0/custom_resources/index.js so FhirResourceCreator can
 * resolve 'GroupMember' -- required because MongoBulkWriteExecutor's one-by-one concurrency
 * fallback (hit on every fresh upsert, since a new row's modifiedCount reads as 0) reconstructs
 * the found document via FhirResourceCreator.createByResourceType. Reads still use the
 * raw-document path (cursor.toArrayAsync(), not toObjectArrayAsync()) since the repository only
 * needs plain field values.
 */
class GroupMember extends Resource {
    /**
     * @param {string} id - equal to _uuid; must be a valid UUID so UuidColumnHandler sets _uuid = id
     * @param {Meta} meta
     * @param {Object} [_access]
     * @param {string} _sourceAssigningAuthority - copied from the owning Group, required by ReferenceGlobalIdHandler
     * @param {string} _uuid - this row's stable identity; there is no separate memberRowUuid field (design doc §3.2)
     * @param {string} [_sourceId] - not set by this design's own write path; populated automatically by the
     *   universal SourceIdColumnHandler pre-save handler (same as _access/AccessColumnHandler), equal to
     *   `id` (itself equal to `_uuid`) the same way it is for every other resource type -- standard
     *   cross-cutting infra, not GroupMember-specific, kept for consistency with the rest of the write
     *   pipeline's invariants rather than because anything in this design queries or reads it back
     * @param {string} groupUuid
     * @param {{entity: Object, period: Object|undefined, inactive: boolean}} member
     */
    constructor ({
        id,
        meta,
        _access,
        _sourceAssigningAuthority,
        _uuid,
        _sourceId,
        groupUuid,
        member
    }) {
        super({ id, meta, _access, _sourceAssigningAuthority, _uuid, _sourceId });

        Object.defineProperty(this, 'groupUuid', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.groupUuid,
            set: (value) => { this.__data.groupUuid = value; }
        });
        Object.defineProperty(this, 'member', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.member,
            set: (value) => { this.__data.member = value; }
        });

        Object.assign(this, { groupUuid, member });

        Object.defineProperty(this, 'resourceType', {
            value: 'GroupMember',
            enumerable: true,
            writable: false,
            configurable: true
        });
    }

    static get resourceType () {
        return 'GroupMember';
    }

    /**
     * @description creates a new resource from a plain object, e.g. after a JSON patch is
     * applied against this instance's own fields (see ResourceMerger.applyPatch)
     * @param {Object} data
     * @returns {GroupMember}
     */
    create (
        {
            id,
            meta,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId,
            groupUuid,
            member
        }
    ) {
        return new GroupMember({
            id,
            meta,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId,
            groupUuid,
            member
        });
    }

    /**
     * @description creates a copy of this resource
     * @returns {GroupMember}
     */
    clone () {
        return new GroupMember(this.toJSONInternal());
    }

    toJSON () {
        return this.toJSONInternal();
    }

    toJSONInternal () {
        return {
            ...super.toJSONInternal(),
            groupUuid: this.groupUuid,
            member: this.member
        };
    }
}

module.exports = GroupMember;
