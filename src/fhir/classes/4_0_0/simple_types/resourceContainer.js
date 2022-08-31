const {removeNull} = require('../../../../utils/nullRemover');

class ResourceContainer {
    constructor(opts) {
        // Create an object to store all props
        Object.defineProperty(this, '__data', {
            value: {},
        });

        // Define getters and setters as enumerable

        /**
         * @description None
         * @property {String|undefined}
         */
        Object.defineProperty(this, 'id', {
            configurable: true,
            enumerable: true,
            get: () => this.__data.id,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                this.__data.id = value;
            },
        });

        /**
         * @description None
         * @property {Meta|undefined}
         */
        Object.defineProperty(this, 'meta', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.meta,
            set: (value) => {
                if (value === undefined || value === null) {
                    return;
                }

                let Meta = require('../complex_types/meta.js');

                this.__data.meta = new Meta(value);
            },
        });

        Object.assign(this, opts);
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON() {
        return removeNull({
            resourceType: this.resourceType,
            id: this.id,
            meta: this.meta && this.meta.toJSON(),
        });
    }
}

module.exports = ResourceContainer;

