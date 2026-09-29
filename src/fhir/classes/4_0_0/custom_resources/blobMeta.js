const { removeNull } = require('../../../../utils/nullRemover');

/**
BlobMeta
    Internal-only sidecar describing where a base64 payload (e.g. Binary.data)
    has been offloaded to external blob storage. Not part of the FHIR R4B
    schema — never appears in public JSON responses.
*/
class BlobMeta {
    /**
     * @param {string|undefined} [hash]
     * @param {number|undefined} [rawSize]
     * @param {Date|undefined} [lastUpdated]
     */
    constructor (
        {
            hash,
            rawSize,
            lastUpdated
        } = {}
    ) {
        Object.defineProperty(this, '__data', {
            value: {}
        });

        /**
         * @description Content hash; used for write-time change detection and as the
         *              history-bucket key `{ResourceType}_4_0_0/{uuid}/{hash}`. The live-bucket key
         *              uses `lastUpdated` instead (see `Base64DataManager`).
         * @property {string|undefined}
         */
        Object.defineProperty(this, 'hash', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.hash,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null) {
                    this.__data.hash = undefined;
                    return;
                }
                this.__data.hash = valueProvided;
            }
        });

        /**
         * @description Size of the offloaded payload in kilobytes.
         * @property {number|undefined}
         */
        Object.defineProperty(this, 'rawSize', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.rawSize,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null) {
                    this.__data.rawSize = undefined;
                    return;
                }
                this.__data.rawSize = valueProvided;
            }
        });

        /**
         * @description Version timestamp of the version where the current content was first
         *              stored. Stored as a BSON Date in Mongo (matching `meta.lastUpdated`).
         *              Distinct from `meta.lastUpdated` (which advances on every version) — this
         *              only advances when the offloaded content itself changes.
         * @property {Date|undefined}
         */
        Object.defineProperty(this, 'lastUpdated', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.lastUpdated,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null) {
                    this.__data.lastUpdated = undefined;
                    return;
                }
                this.__data.lastUpdated = valueProvided;
            }
        });

        Object.assign(this, {
            hash,
            rawSize,
            lastUpdated
        });
    }

    /**
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            hash: this.hash,
            rawSize: this.rawSize,
            lastUpdated: this.lastUpdated
        });
    }

    /**
     * @return {Object}
     */
    toJSONInternal () {
        return removeNull({
            hash: this.hash,
            rawSize: this.rawSize,
            lastUpdated: this.lastUpdated
        });
    }
}

module.exports = BlobMeta;
