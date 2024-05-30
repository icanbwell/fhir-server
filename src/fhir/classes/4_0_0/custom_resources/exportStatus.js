const Resource = require('../resources/resource.js');

class ExportStatus extends Resource {
    /**
     * @typedef {Object} ConstructorParams
     * @property {String} [id]
     * @property {import('../complex_types/meta.js')} [meta]
     * @property {code} status
     * @property {url} requestUrl
     * @property {date} transactionTime
     * @property {import('./exportStatusEntry.js')[]} [output]
     * @property {import('./exportStatusEntry.js')[]} [errors]
     *
     * @param {ConstructorParams}
     */
    constructor({
        id,
        meta,
        status,
        requestUrl,
        transactionTime,
        output,
        errors,
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
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
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
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.meta = undefined;
                    return;
                }
                const Meta = require('../complex_types/meta.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.meta = FhirResourceCreator.create(valueProvided, Meta);
            }
        });

        /**
         * @description The status of the result value.
         * @property {code}
         */
        Object.defineProperty(this, 'status', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.status,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.status = undefined;
                    return;
                }
                this.__data.status = valueProvided;
            }
        });

        /**
         * @description The url that triggered the export
         * @property {string}
         */
        Object.defineProperty(this, 'requestUrl', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.requestUrl,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.requestUrl = undefined;
                    return;
                }
                this.__data.requestUrl = valueProvided;
            }
        });

        /**
         * @description An absolute base URL for the implementation.  This forms the base for REST
         * interfaces as well as the mailbox and document interfaces.
         * @property {url}
         */
        Object.defineProperty(this, 'url', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.url,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.url = undefined;
                    return;
                }
                this.__data.url = valueProvided;
            }
        });

        /**
         * @description None
         * @property {date}
        */
        Object.defineProperty(this, 'transactionTime', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.transactionTime,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.transactionTime = undefined;
                    return;
                }
                this.__data.transactionTime = valueProvided;
            }
        });

        /**
         * @description None
         * @property {import('./exportStatusEntry')[]}
         */
        Object.defineProperty(this, 'output', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.output,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.output = undefined;
                    return;
                }
                const ExportStatusEntry = require('./exportStatusEntry.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.output = FhirResourceCreator.create(valueProvided, ExportStatusEntry);
            }
        });

        /**
         * @description None
         * @property {import('./exportStatusEntry')[]}
         */
        Object.defineProperty(this, 'errors', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.ererors,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.errors = undefined;
                    return;
                }
                const ExportStatusEntry = require('./exportStatusEntry.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.errors = FhirResourceCreator.create(valueProvided, ExportStatusEntry);
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
            set: valueProvided => {
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
            set: valueProvided => {
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
            set: valueProvided => {
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
            set: valueProvided => {
                this.__data._sourceId = valueProvided;
            }
        });

        Object.assign(this, {
            id,
            meta,
            status,
            requestUrl,
            transactionTime,
            output,
            errors,
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
            value: 'ExportStatus',
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

        return removeNull({
            id: this.id,
            meta: this.meta && this.meta.toJSON(),
            status: this.status,
            requestUrl: this.requestUrl,
            transactionTime: this.transactionTime,
            output: this.output && this.output.map(o => o.toJSON()),
            errors: this.errors && this.errors.map(o => o.toJSON())
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
            meta: this.meta && this.meta.toJSONInternal(),
            status: this.status,
            requestUrl: this.requestUrl,
            transactionTime: this.transactionTime,
            output: this.output && this.output.map(o => o.toJSONInternal()),
            errors: this.errors && this.errors.map(o => o.toJSONInternal())
        });

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

module.exports = ExportStatus;
