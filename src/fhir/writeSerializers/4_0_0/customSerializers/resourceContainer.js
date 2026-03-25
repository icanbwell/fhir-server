const BaseSerializer = require('./baseSerializer.js');

/** @type {import('../complexTypes/meta.js')} */
let MetaSerializer;

class ResourceContainerSerializer extends BaseSerializer {
    // Private cache for lazy-loaded property configs
    #configCache = {};

    fhirPropertyToSerializerMap = {
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
        resourceType: null
    };
}

module.exports = new ResourceContainerSerializer();
