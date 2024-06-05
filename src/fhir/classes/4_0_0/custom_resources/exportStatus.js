const Resource = require('../resources/resource.js');

class ExportStatus extends Resource {
    /**
     * @typedef {Object} ConstructorParams
     * @property {String} [id]
     * @property {import('../complex_types/meta.js')} [meta]
     * @property {import('../complex_types/identifier.js')} [identifier]
     * @property {code} status
     * @property {url} request
     * @property {boolean} requiresAccessToken
     * @property {string} scope
     * @property {string} user
     * @property {date} transactionTime
     * @property {import('./exportStatusEntry.js')[]} [output]
     * @property {import('./exportStatusEntry.js')[]} [errors]
     *
     * @param {ConstructorParams}
     */
    constructor({
        id,
        meta,
        identifier,
        status,
        request,
        requiresAccessToken,
        scope,
        user,
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
         * @description The metadata about the resource. This is content that is maintained by the
         * infrastructure. Changes to the content might not always be associated with
         * version changes to the resource.
         * @property {import('../complex_types/identifier')|undefined}
         */
        Object.defineProperty(this, 'identifier', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.identifier,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || !Array.isArray(valueProvided)) {
                    this.__data.identifier = undefined;
                    return;
                }
                const Identifier = require('../complex_types/identifier.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.identifier = FhirResourceCreator.createArray(valueProvided, Identifier);
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
         * @property {url}
         */
        Object.defineProperty(this, 'request', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.request,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.request = undefined;
                    return;
                }
                this.__data.request = valueProvided;
            }
        });

        /**
         * @description None
         * @property {boolean}
         */
        Object.defineProperty(this, 'requiresAccessToken', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.requiresAccessToken,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.requiresAccessToken = undefined;
                    return;
                }
                this.__data.requiresAccessToken = valueProvided;
            }
        });

        /**
         * @description The scopes used to trigger the export
         * @property {string}
         */
        Object.defineProperty(this, 'scope', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.scope,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.scope = undefined;
                    return;
                }
                this.__data.scope = valueProvided;
            }
        });

        /**
         * @description The user who trigger the export
         * @property {string}
         */
        Object.defineProperty(this, 'user', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.user,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.user = undefined;
                    return;
                }
                this.__data.user = valueProvided;
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
                if (valueProvided === undefined || valueProvided === null || !Array.isArray(valueProvided)) {
                    this.__data.output = undefined;
                    return;
                }
                const ExportStatusEntry = require('./exportStatusEntry.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.output = FhirResourceCreator.createArray(valueProvided, ExportStatusEntry);
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
            get: () => this.__data.errors,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || !Array.isArray(valueProvided)) {
                    this.__data.errors = undefined;
                    return;
                }
                const ExportStatusEntry = require('./exportStatusEntry.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator.js');
                this.__data.errors = FhirResourceCreator.createArray(valueProvided, ExportStatusEntry);
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
            identifier,
            status,
            request,
            requiresAccessToken,
            scope,
            user,
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
            resourceType: this.resourceType,
            meta: this.meta && this.meta.toJSON(),
            identifier: this.identifier && this.identifier.map(o => o && o.toJSON()),
            status: this.status,
            requestUrl: this.requestUrl,
            requiresAccessToken: this.requiresAccessToken,
            scope: this.scope,
            user: this.user,
            transactionTime: this.transactionTime,
            output: this.output && this.output.map(o => o && o.toJSON()),
            errors: this.errors && this.errors.map(o => o && o.toJSON())
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
            identifier: this.identifier && this.identifier.map(o => o && o.toJSONInternal()),
            status: this.status,
            request: this.request,
            requiresAccessToken: this.requiresAccessToken,
            scope: this.scope,
            user: this.user,
            transactionTime: this.transactionTime,
            output: this.output && this.output.map(o => o && o.toJSONInternal()),
            errors: this.errors && this.errors.map(o => o && o.toJSONInternal())
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
