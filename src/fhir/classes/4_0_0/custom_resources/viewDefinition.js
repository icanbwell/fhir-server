const Resource = require('../resources/resource.js');

/**
 * ViewDefinition
 *    Custom (non-standard-R4) resource used by the SQL-on-FHIR v2 $run operation for
 *    typing/validation only. It is never persisted. `select`, `constant`, and `where`
 *    are stored as plain pass-through data (FHIRPath payloads), not typed FHIR elements.
 */
class ViewDefinition extends Resource {
    /**
     * @typedef {Object} ConstructorParams
     * @property {String} [id]
     * @property {import('../complex_types/meta.js')} [meta]
     * @property {string} [url]
     * @property {string} [name]
     * @property {string} [title]
     * @property {code} [status]
     * @property {string} [resource]
     * @property {Object[]} [constant]
     * @property {Object[]} [select]
     * @property {Object[]} [where]
     *
     * @param {ConstructorParams}
     */
    constructor({
        id,
        meta,
        url,
        name,
        title,
        status,
        resource,
        constant,
        select,
        where,
        _access,
        _sourceAssigningAuthority,
        _sourceId,
        _uuid
    }) {
        super({});

        /**
         * @description The logical id of the resource, as used in the URL for the resource. Once
         * assigned, this value never changes.
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
         * @description The metadata about the resource. This is content that is maintained by the
         * infrastructure. Changes to the content might not always be associated with
         * version changes to the resource.
         * @property {import('../complex_types/meta')|undefined}
         */
        Object.defineProperty(this, 'meta', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.meta,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.meta = undefined;
                    return;
                }
                const Meta = require('../complex_types/meta.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.meta = FhirResourceCreator.create(valueProvided, Meta);
            }
        });

        /**
         * @description An absolute base URL for the definition.
         * @property {string|undefined}
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

        /**
         * @description A machine-friendly name for the view definition.
         * @property {string|undefined}
         */
        Object.defineProperty(this, 'name', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.name,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.name = undefined;
                    return;
                }
                this.__data.name = valueProvided;
            }
        });

        /**
         * @description A human-friendly title for the view definition.
         * @property {string|undefined}
         */
        Object.defineProperty(this, 'title', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.title,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.title = undefined;
                    return;
                }
                this.__data.title = valueProvided;
            }
        });

        /**
         * @description The status of the view definition.
         * @property {code|undefined}
         */
        Object.defineProperty(this, 'status', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.status,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.status = undefined;
                    return;
                }
                this.__data.status = valueProvided;
            }
        });

        /**
         * @description The FHIR resource type this view is based on (e.g. 'Patient').
         * @property {string|undefined}
         */
        Object.defineProperty(this, 'resource', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.resource,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.resource = undefined;
                    return;
                }
                this.__data.resource = valueProvided;
            }
        });

        /**
         * @description Constant definitions usable as %variables in FHIRPath expressions. Stored
         * as plain pass-through data (not typed FHIR elements).
         * @property {Object[]|undefined}
         */
        Object.defineProperty(this, 'constant', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.constant,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.constant = undefined;
                    return;
                }
                this.__data.constant = valueProvided;
            }
        });

        /**
         * @description The column/select structure of the view. Stored as plain pass-through data
         * (not typed FHIR elements) since it is a FHIRPath payload evaluated by the SQL-on-FHIR
         * engine.
         * @property {Object[]|undefined}
         */
        Object.defineProperty(this, 'select', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.select,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.select = undefined;
                    return;
                }
                this.__data.select = valueProvided;
            }
        });

        /**
         * @description FHIRPath-based filter conditions applied to the resource. Stored as plain
         * pass-through data (not typed FHIR elements).
         * @property {Object[]|undefined}
         */
        Object.defineProperty(this, 'where', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.where,
            set: (valueProvided) => {
                if (
                    valueProvided === undefined ||
                    valueProvided === null ||
                    (Array.isArray(valueProvided) && valueProvided.length === 0)
                ) {
                    this.__data.where = undefined;
                    return;
                }
                this.__data.where = valueProvided;
            }
        });

        /**
         * @description _access
         * @property {Object|undefined}
         */
        Object.defineProperty(this, '_access', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._access,
            set: (valueProvided) => {
                this.__data._access = valueProvided;
            }
        });

        /**
         * @description _sourceAssigningAuthority
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_sourceAssigningAuthority', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._sourceAssigningAuthority,
            set: (valueProvided) => {
                this.__data._sourceAssigningAuthority = valueProvided;
            }
        });

        /**
         * @description _uuid
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_uuid', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._uuid,
            set: (valueProvided) => {
                this.__data._uuid = valueProvided;
            }
        });

        /**
         * @description _sourceId
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_sourceId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._sourceId,
            set: (valueProvided) => {
                this.__data._sourceId = valueProvided;
            }
        });

        Object.assign(this, {
            id,
            meta,
            url,
            name,
            title,
            status,
            resource,
            constant,
            select,
            where,
            _access,
            _sourceAssigningAuthority,
            _sourceId,
            _uuid
        });

        /**
         * @description Define a default non-writable resourceType property
         * @property {string}
         */
        Object.defineProperty(this, 'resourceType', {
            value: 'ViewDefinition',
            enumerable: true,
            writable: false,
            configurable: true
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON() {
        const { removeNull } = require('../../../../utils/nullRemover.js');

        const json = removeNull({
            id: this.id,
            resourceType: this.resourceType,
            meta: this.meta && this.meta.toJSON(),
            url: this.url,
            name: this.name,
            title: this.title,
            status: this.status,
            resource: this.resource
        });

        // constant/select/where are opaque FHIRPath pass-through payloads (the same
        // object references held by the caller/validator/FHIRPath engine). Attach them
        // as-is instead of running them through the mutating removeNull().
        if (this.constant !== undefined) {
            json.constant = this.constant;
        }
        if (this.select !== undefined) {
            json.select = this.select;
        }
        if (this.where !== undefined) {
            json.where = this.where;
        }

        return json;
    }

    /**
     * @description Create a blank new resource
     * @param {String} [id]
     * @param {import('../complex_types/meta.js')} [meta]
     * @param {string} [url]
     * @param {string} [name]
     * @param {string} [title]
     * @param {code} [status]
     * @param {string} [resource]
     * @param {Object[]} [constant]
     * @param {Object[]} [select]
     * @param {Object[]} [where]
     */
    create({ id, meta, url, name, title, status, resource, constant, select, where }) {
        return new ViewDefinition({
            id,
            meta,
            url,
            name,
            title,
            status,
            resource,
            constant,
            select,
            where
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal() {
        const { removeNull } = require('../../../../utils/nullRemover.js');

        const json = removeNull({
            id: this.id,
            resourceType: this.resourceType,
            meta: this.meta && this.meta.toJSONInternal(),
            url: this.url,
            name: this.name,
            title: this.title,
            status: this.status,
            resource: this.resource
        });

        // constant/select/where are opaque FHIRPath pass-through payloads (the same
        // object references held by the caller/validator/FHIRPath engine). Attach them
        // as-is instead of running them through the mutating removeNull().
        if (this.constant !== undefined) {
            json.constant = this.constant;
        }
        if (this.select !== undefined) {
            json.select = this.select;
        }
        if (this.where !== undefined) {
            json.where = this.where;
        }

        if (this._access) {
            json._access = this._access;
        }
        if (this._sourceAssigningAuthority) {
            json._sourceAssigningAuthority = this._sourceAssigningAuthority;
        }
        if (this._uuid) {
            json._uuid = this._uuid;
        }
        if (this._sourceId) {
            json._sourceId = this._sourceId;
        }

        return json;
    }
}

module.exports = ViewDefinition;
