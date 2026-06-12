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
     */
    constructor (
        {
            rawReference,
            rawSize
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

        Object.assign(this, {
            rawReference,
            rawSize
        });
    }

    /**
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            rawReference: this.rawReference,
            rawSize: this.rawSize
        });
    }

    /**
     * @return {Object}
     */
    toJSONInternal () {
        return removeNull({
            rawReference: this.rawReference,
            rawSize: this.rawSize
        });
    }
}

module.exports = BlobMeta;
