const Resource = require('../resources/resource.js');

class ImportStatus extends Resource {
    /**
     * @typedef {Object} ConstructorParams
     * @property {String} [id]
     * @property {import('../complex_types/meta.js')} [meta]
     * @property {import('../complex_types/identifier.js')} [identifier]
     * @property {Extension[]|undefined} [extension]
     * @property {code} status
     * @property {url} request
     * @property {string} scope
     * @property {string} user
     * @property {string} filepath
     * @property {Object} [range]
     * @property {date} transactionTime
     * @property {Object[]} [outcome]
     * @property {string} [error]
     * @property {number} [resourcesProcessed]
     * @property {number} [resourcesFailed]
     * @property {number} [totalResources]
     *
     * @param {ConstructorParams}
     */
    constructor({
        id,
        meta,
        identifier,
        extension,
        status,
        request,
        scope,
        user,
        filepath,
        range,
        transactionTime,
        outcome,
        error,
        resourcesProcessed,
        resourcesFailed,
        totalResources,
        _access,
        _sourceAssigningAuthority,
        _sourceId,
        _uuid
    }) {
        super({});

        Object.defineProperty(this, 'id', {
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

        Object.defineProperty(this, 'meta', {
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

        Object.defineProperty(this, 'identifier', {
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

        Object.defineProperty(this, 'extension', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.extension,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.extension = undefined;
                    return;
                }
                const Extension = require('../complex_types/extension.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.extension = FhirResourceCreator.createArray(valueProvided, Extension);
            }
        });

        Object.defineProperty(this, 'status', {
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

        Object.defineProperty(this, 'request', {
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

        Object.defineProperty(this, 'scope', {
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

        Object.defineProperty(this, 'user', {
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

        Object.defineProperty(this, 'filepath', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.filepath,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.filepath = undefined;
                    return;
                }
                this.__data.filepath = valueProvided;
            }
        });

        Object.defineProperty(this, 'range', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.range,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null) {
                    this.__data.range = undefined;
                    return;
                }
                this.__data.range = valueProvided;
            }
        });

        Object.defineProperty(this, 'transactionTime', {
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

        Object.defineProperty(this, 'outcome', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.outcome,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || !Array.isArray(valueProvided)) {
                    this.__data.outcome = undefined;
                    return;
                }
                this.__data.outcome = valueProvided;
            }
        });

        Object.defineProperty(this, 'error', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.error,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.error = undefined;
                    return;
                }
                this.__data.error = valueProvided;
            }
        });

        Object.defineProperty(this, 'resourcesProcessed', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.resourcesProcessed,
            set: valueProvided => {
                this.__data.resourcesProcessed = valueProvided;
            }
        });

        Object.defineProperty(this, 'resourcesFailed', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.resourcesFailed,
            set: valueProvided => {
                this.__data.resourcesFailed = valueProvided;
            }
        });

        Object.defineProperty(this, 'totalResources', {
            enumerable: true,
            configurable: true,
            get: () => this.__data.totalResources,
            set: valueProvided => {
                this.__data.totalResources = valueProvided;
            }
        });

        Object.defineProperty(this, '_access', {
            enumerable: true,
            configurable: true,
            get: () => this.__data._access,
            set: valueProvided => {
                this.__data._access = valueProvided;
            }
        });

        Object.defineProperty(this, '_sourceAssigningAuthority', {
            enumerable: true,
            configurable: true,
            get: () => this.__data._sourceAssigningAuthority,
            set: valueProvided => {
                this.__data._sourceAssigningAuthority = valueProvided;
            }
        });

        Object.defineProperty(this, '_uuid', {
            enumerable: true,
            configurable: true,
            get: () => this.__data._uuid,
            set: valueProvided => {
                this.__data._uuid = valueProvided;
            }
        });

        Object.defineProperty(this, '_sourceId', {
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
            extension,
            status,
            request,
            scope,
            user,
            filepath,
            range,
            transactionTime,
            outcome,
            error,
            resourcesProcessed,
            resourcesFailed,
            totalResources,
            _access,
            _sourceAssigningAuthority,
            _sourceId,
            _uuid
        });

        Object.defineProperty(this, 'resourceType', {
            value: 'ImportStatus',
            enumerable: true,
            writable: false,
            configurable: true
        });
    }

    toJSON() {
        const { removeNull } = require('../../../../utils/nullRemover.js');

        return removeNull({
            id: this.id,
            resourceType: this.resourceType,
            meta: this.meta && this.meta.toJSON(),
            identifier: this.identifier && this.identifier.map(o => o && o.toJSON()),
            extension: this.extension && this.extension.map(v => v.toJSON()),
            status: this.status,
            request: this.request,
            scope: this.scope,
            user: this.user,
            filepath: this.filepath,
            range: this.range,
            transactionTime: this.transactionTime,
            outcome: this.outcome,
            error: this.error,
            resourcesProcessed: this.resourcesProcessed,
            resourcesFailed: this.resourcesFailed,
            totalResources: this.totalResources
        });
    }

    create({
        id,
        meta,
        identifier,
        extension,
        status,
        request,
        scope,
        user,
        filepath,
        range,
        transactionTime,
        outcome,
        error,
        resourcesProcessed,
        resourcesFailed,
        totalResources
    }) {
        return new ImportStatus({
            id,
            meta,
            identifier,
            extension,
            status,
            request,
            scope,
            user,
            filepath,
            range,
            transactionTime,
            outcome,
            error,
            resourcesProcessed,
            resourcesFailed,
            totalResources
        });
    }

    toJSONInternal() {
        const { removeNull } = require('../../../../utils/nullRemover.js');

        const json = removeNull({
            id: this.id,
            resourceType: this.resourceType,
            meta: this.meta && this.meta.toJSONInternal(),
            identifier: this.identifier && this.identifier.map(o => o && o.toJSONInternal()),
            extension: this.extension && this.extension.map(v => v.toJSONInternal()),
            status: this.status,
            request: this.request,
            scope: this.scope,
            user: this.user,
            filepath: this.filepath,
            range: this.range,
            transactionTime: this.transactionTime,
            outcome: this.outcome,
            error: this.error,
            resourcesProcessed: this.resourcesProcessed,
            resourcesFailed: this.resourcesFailed,
            totalResources: this.totalResources
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

module.exports = ImportStatus;
