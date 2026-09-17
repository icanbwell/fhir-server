const Resource = require('../resources/resource');

/**
 * Hand-authored pseudo-FHIR-resource for a single Group_Member row (DCON-5527).
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
     * @param {string} id - memberRowUuid; must be a valid UUID so UuidColumnHandler sets _uuid = id
     * @param {Meta} meta
     * @param {Object} [_access]
     * @param {string} _sourceAssigningAuthority - copied from the owning Group, required by ReferenceGlobalIdHandler
     * @param {string} _uuid
     * @param {string} [_sourceId]
     * @param {string} groupUuid
     * @param {string} memberRowUuid
     * @param {number} groupVersionId - owning Group's meta.versionId at the time of this write
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
        memberRowUuid,
        groupVersionId,
        member
    }) {
        super({ id, meta, _access, _sourceAssigningAuthority, _uuid, _sourceId });

        Object.defineProperty(this, 'groupUuid', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.groupUuid,
            set: (value) => { this.__data.groupUuid = value; }
        });
        Object.defineProperty(this, 'memberRowUuid', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.memberRowUuid,
            set: (value) => { this.__data.memberRowUuid = value; }
        });
        Object.defineProperty(this, 'groupVersionId', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.groupVersionId,
            set: (value) => { this.__data.groupVersionId = value; }
        });
        Object.defineProperty(this, 'member', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.member,
            set: (value) => { this.__data.member = value; }
        });

        Object.assign(this, { groupUuid, memberRowUuid, groupVersionId, member });

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
            memberRowUuid,
            groupVersionId,
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
            memberRowUuid,
            groupVersionId,
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
            memberRowUuid: this.memberRowUuid,
            groupVersionId: this.groupVersionId,
            member: this.member
        };
    }
}

module.exports = GroupMember;
