class ExportStatusEntry {
    /**
     * @typedef {Object} ConstructorParams
     * @property {string} [id]
     * @property {string} type
     * @property {url} url
     *
     * @param {ConstructorParams}
     */
    constructor({ id, type, url }) {
        /**
         * @description None
         * @property {String|undefined}
         */
        Object.defineProperty(this, 'id', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.id,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.id = undefined;
                    return;
                }
                this.__data.id = valueProvided;
            }
        });

        /**
         * @description None
         * @property {string}
         */
        Object.defineProperty(this, 'type', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.type,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.type = undefined;
                    return;
                }
                this.__data.type = valueProvided;
            }
        });

        /**
         * @description None
         * @property {url}
         */
        Object.defineProperty(this, 'url', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.url,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.url = undefined;
                    return;
                }
                this.__data.url = valueProvided;
            }
        });

        Object.assign(this, {
            id,
            type,
            url
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON() {
        const { removeNull } = require('../../../../utils/nullRemover');

        return removeNull({
            id: this.id,
            type: this.type,
            url: this.url
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal() {
        const { removeNull } = require('../../../../utils/nullRemover');

        return removeNull({
            id: this.id,
            type: this.type,
            url: this.url
        });
    }
}

module.exports = ExportStatusEntry;
