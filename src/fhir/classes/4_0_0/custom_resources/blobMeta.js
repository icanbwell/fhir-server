const { removeNull } = require('../../../../utils/nullRemover');

/**
BlobMeta
    Internal-only sidecar describing where a base64 payload (e.g. Binary.data)
    has been offloaded to external blob storage. Not part of the FHIR R4B
    schema — never appears in public JSON responses.
*/
class BlobMeta {
    /**
     * @param {string|undefined} [rawReference]
     * @param {number|undefined} [rawSize]
     * @param {string|undefined} [lastUpdated]
     */
    constructor (
        {
            rawReference,
            rawSize,
            lastUpdated
        } = {}
    ) {
        Object.defineProperty(this, '__data', {
            value: {}
        });

        /**
         * @description Reference path within the blob bucket. For live resources this is
         *              `<_uuid>`; for history entries it is `<_uuid>/<lastUpdated epoch ms>`.
         * @property {string|undefined}
         */
        Object.defineProperty(this, 'rawReference', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.rawReference,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null) {
                    this.__data.rawReference = undefined;
                    return;
                }
                this.__data.rawReference = valueProvided;
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
         * @description Version timestamp (ISO string) of the version where the current
         *              content was first stored. Combined with `rawReference` it forms the
         *              history bucket key `<rawReference>/<epoch ms>`. Distinct from
         *              `meta.lastUpdated` (which advances on every version) — this only
         *              advances when the offloaded content itself changes.
         * @property {string|undefined}
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
            rawReference,
            rawSize,
            lastUpdated
        });
    }

    /**
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            rawReference: this.rawReference,
            rawSize: this.rawSize,
            lastUpdated: this.lastUpdated
        });
    }

    /**
     * @return {Object}
     */
    toJSONInternal () {
        return removeNull({
            rawReference: this.rawReference,
            rawSize: this.rawSize,
            lastUpdated: this.lastUpdated
        });
    }
}

module.exports = BlobMeta;
