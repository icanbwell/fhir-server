const BaseSerializer = require('./baseSerializer.js');

/** @type {import('../complexTypes/meta.js')} */
let MetaSerializer;
/** @type {import('../complexTypes/identifier.js')} */
let IdentifierSerializer;
/** @type {import('../complexTypes/extension.js')} */
let ExtensionSerializer;
/** @type {import('./exportStatusEntry.js')} */
let ExportStatusEntrySerializer;

class ExportStatusSerializer extends BaseSerializer {
    // Private cache for lazy-loaded property configs
    #configCache = {};

    fhirPropertyToSerializerMap = {
        id: null,
        resourceType: null,
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
        identifier: () => {
            // Lazy load serializer only when first accessed (with caching)
            if (!this.#configCache['identifier']) {
                if (!IdentifierSerializer) {
                    IdentifierSerializer = require('../complexTypes/identifier.js');
                }
                this.#configCache['identifier'] = {
                    serializeFunction: 'serializeArray',
                    serializerClass: IdentifierSerializer
                };
            }
            return this.#configCache['identifier'];
        },
        extension: () => {
            // Lazy load serializer only when first accessed (with caching)
            if (!this.#configCache['extension']) {
                if (!ExtensionSerializer) {
                    ExtensionSerializer = require('../complexTypes/extension.js');
                }
                this.#configCache['extension'] = {
                    serializeFunction: 'serializeArray',
                    serializerClass: ExtensionSerializer
                };
            }
            return this.#configCache['extension'];
        },
        status: null,
        requestUrl: null,
        requiresAccessToken: null,
        scope: null,
        user: null,
        transactionTime: null,
        output: () => {
            // Lazy load serializer only when first accessed (with caching)
            if (!this.#configCache['output']) {
                if (!ExportStatusEntrySerializer) {
                    ExportStatusEntrySerializer = require('./exportStatusEntry.js');
                }
                this.#configCache['output'] = {
                    serializeFunction: 'serializeArray',
                    serializerClass: ExportStatusEntrySerializer
                };
            }
            return this.#configCache['output'];
        },
        errors: () => {
            // Lazy load serializer only when first accessed (with caching)
            if (!this.#configCache['errors']) {
                if (!ExportStatusEntrySerializer) {
                    ExportStatusEntrySerializer = require('./exportStatusEntry.js');
                }
                this.#configCache['errors'] = {
                    serializeFunction: 'serializeArray',
                    serializerClass: ExportStatusEntrySerializer
                };
            }
            return this.#configCache['errors'];
        }
    };
}

module.exports = new ExportStatusSerializer();
