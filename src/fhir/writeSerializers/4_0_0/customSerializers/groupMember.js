const BaseSerializer = require('./baseSerializer.js');

/** @type {import('../complexTypes/meta.js')} */
let MetaSerializer;
/** @type {import('../backboneElements/groupMember.js')} */
let GroupMemberBackboneSerializer;

// `member` reuses the generated Group.member backbone serializer instead of duplicating it here.
class GroupMemberSerializer extends BaseSerializer {
    // Private cache for lazy-loaded property configs
    #configCache = {};

    fhirPropertyToSerializerMap = {
        resourceType: null,
        id: null,
        meta: () => {
            // Lazy load serializer only when first accessed (with caching)
            if (!this.#configCache['meta']) {
                if (!MetaSerializer) {
                    MetaSerializer = require('../complexTypes/meta.js');
                }
                this.#configCache['meta'] = {
                    serializeFunction: 'serialize',
                    serializerClass: MetaSerializer
                };
            }
            return this.#configCache['meta'];
        },
        groupUuid: null,
        groupVersionId: null,
        member: () => {
            // Lazy load serializer only when first accessed (with caching)
            if (!this.#configCache['member']) {
                if (!GroupMemberBackboneSerializer) {
                    GroupMemberBackboneSerializer = require('../backboneElements/groupMember.js');
                }
                this.#configCache['member'] = {
                    serializeFunction: 'serialize',
                    serializerClass: GroupMemberBackboneSerializer
                };
            }
            return this.#configCache['member'];
        }
    };

    allPropertyToSerializerMap = {
        ...this.fhirPropertyToSerializerMap,
        _access: null,
        _sourceAssigningAuthority: null,
        _uuid: null,
        _sourceId: null
    };
}

module.exports = new GroupMemberSerializer();
