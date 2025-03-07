

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
ValueSet.Expansion
    A ValueSet resource instance specifies a set of codes drawn from one or more
    code systems, intended for use in a particular context. Value sets link
    between [CodeSystem](codesystem.html) definitions and their use in [coded
    elements](terminologies.html).
*/
class ValueSetExpansion extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {uri|undefined} [identifier],
     * @param {dateTime} timestamp,
     * @param {Int|undefined} [total],
     * @param {Int|undefined} [offset],
     * @param {ValueSetParameter[]|undefined} [parameter],
     * @param {ValueSetContains[]|undefined} [contains],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            identifier,
            timestamp,
            total,
            offset,
            parameter,
            contains
        }
    ) {
        super({});

        // ---- Define getters and setters as enumerable ---

        /**
         * @description None
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
         * @description May be used to represent additional information that is not part of the basic
    definition of the element. To make the use of extensions safe and manageable,
    there is a strict set of governance  applied to the definition and use of
    extensions. Though any implementer can define an extension, there is a set of
    requirements that SHALL be met as part of the definition of the extension.
         * @property {Extension[]|undefined}
        */
        Object.defineProperty(this, 'extension', {
            // https://www.w3schools.com/js/js_object_es5.asp
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

        /**
         * @description May be used to represent additional information that is not part of the basic
    definition of the element and that modifies the understanding of the element
    in which it is contained and/or the understanding of the containing element's
    descendants. Usually modifier elements provide negation or qualification. To
    make the use of extensions safe and manageable, there is a strict set of
    governance applied to the definition and use of extensions. Though any
    implementer can define an extension, there is a set of requirements that SHALL
    be met as part of the definition of the extension. Applications processing a
    resource are required to check for modifier extensions.

    Modifier extensions SHALL NOT change the meaning of any elements on Resource
    or DomainResource (including cannot change the meaning of modifierExtension
    itself).
         * @property {Extension[]|undefined}
        */
        Object.defineProperty(this, 'modifierExtension', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.modifierExtension,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.modifierExtension = undefined;
                    return;
                }
                const Extension = require('../complex_types/extension.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.modifierExtension = FhirResourceCreator.createArray(valueProvided, Extension);
            }
        });

        /**
         * @description An identifier that uniquely identifies this expansion of the valueset, based
    on a unique combination of the provided parameters, the system default
    parameters, and the underlying system code system versions etc. Systems may
    re-use the same identifier as long as those factors remain the same, and the
    expansion is the same, but are not required to do so. This is a business
    identifier.
         * @property {uri|undefined}
        */
        Object.defineProperty(this, 'identifier', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.identifier,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.identifier = undefined;
                    return;
                }
                this.__data.identifier = valueProvided;
            }
        });

        /**
         * @description The time at which the expansion was produced by the expanding system.
         * @property {dateTime}
        */
        Object.defineProperty(this, 'timestamp', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.timestamp,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.timestamp = undefined;
                    return;
                }
                this.__data.timestamp = valueProvided;
            }
        });

        /**
         * @description The total number of concepts in the expansion. If the number of concept nodes
    in this resource is less than the stated number, then the server can return
    more using the offset parameter.
         * @property {Int|undefined}
        */
        Object.defineProperty(this, 'total', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.total,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.total = undefined;
                    return;
                }
                this.__data.total = valueProvided;
            }
        });

        /**
         * @description If paging is being used, the offset at which this resource starts.  I.e. this
    resource is a partial view into the expansion. If paging is not being used,
    this element SHALL NOT be present.
         * @property {Int|undefined}
        */
        Object.defineProperty(this, 'offset', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.offset,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.offset = undefined;
                    return;
                }
                this.__data.offset = valueProvided;
            }
        });

        /**
         * @description A parameter that controlled the expansion process. These parameters may be
    used by users of expanded value sets to check whether the expansion is
    suitable for a particular purpose, or to pick the correct expansion.
         * @property {ValueSetParameter[]|undefined}
        */
        Object.defineProperty(this, 'parameter', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.parameter,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.parameter = undefined;
                    return;
                }
                const ValueSetParameter = require('../backbone_elements/valueSetParameter.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.parameter = FhirResourceCreator.createArray(valueProvided, ValueSetParameter);
            }
        });

        /**
         * @description The codes that are contained in the value set expansion.
         * @property {ValueSetContains[]|undefined}
        */
        Object.defineProperty(this, 'contains', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.contains,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.contains = undefined;
                    return;
                }
                const ValueSetContains = require('../backbone_elements/valueSetContains.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.contains = FhirResourceCreator.createArray(valueProvided, ValueSetContains);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            identifier,
            timestamp,
            total,
            offset,
            parameter,
            contains
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSON()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSON()),
            identifier: this.identifier,
            timestamp: this.timestamp,
            total: this.total,
            offset: this.offset,
            parameter: this.parameter && this.parameter.map(v => v.toJSON()),
            contains: this.contains && this.contains.map(v => v.toJSON())
        });
    }

    /**
     * Returns JSON representation of entity
     * @param {function(Reference): Promise<Reference>} fnUpdateReferenceAsync
     * @return {void}
     */
    async updateReferencesAsync ({ fnUpdateReferenceAsync }) {
            if (this.extension) { await async.each(this.extension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.modifierExtension) { await async.each(this.modifierExtension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.parameter) { await async.each(this.parameter, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.contains) { await async.each(this.contains, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal () {
        const json = {
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSONInternal()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSONInternal()),
            identifier: this.identifier,
            timestamp: this.timestamp,
            total: this.total,
            offset: this.offset,
            parameter: this.parameter && this.parameter.map(v => v.toJSONInternal()),
            contains: this.contains && this.contains.map(v => v.toJSONInternal())
        };

        return removeNull(json);
    }
}

module.exports = ValueSetExpansion;
