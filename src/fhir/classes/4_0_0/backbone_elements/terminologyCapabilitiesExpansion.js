

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
TerminologyCapabilities.Expansion
    A TerminologyCapabilities resource documents a set of capabilities (behaviors)
    of a FHIR Terminology Server that may be used as a statement of actual server
    functionality or a statement of required or desired server implementation.
*/
class TerminologyCapabilitiesExpansion extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Boolean|undefined} [hierarchical],
     * @param {Boolean|undefined} [paging],
     * @param {Boolean|undefined} [incomplete],
     * @param {TerminologyCapabilitiesParameter[]|undefined} [parameter],
     * @param {markdown|undefined} [textFilter],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            hierarchical,
            paging,
            incomplete,
            parameter,
            textFilter
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
         * @description Whether the server can return nested value sets.
         * @property {Boolean|undefined}
        */
        Object.defineProperty(this, 'hierarchical', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.hierarchical,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.hierarchical = undefined;
                    return;
                }
                this.__data.hierarchical = valueProvided;
            }
        });

        /**
         * @description Whether the server supports paging on expansion.
         * @property {Boolean|undefined}
        */
        Object.defineProperty(this, 'paging', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.paging,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.paging = undefined;
                    return;
                }
                this.__data.paging = valueProvided;
            }
        });

        /**
         * @description Allow request for incomplete expansions?
         * @property {Boolean|undefined}
        */
        Object.defineProperty(this, 'incomplete', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.incomplete,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.incomplete = undefined;
                    return;
                }
                this.__data.incomplete = valueProvided;
            }
        });

        /**
         * @description Supported expansion parameter.
         * @property {TerminologyCapabilitiesParameter[]|undefined}
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
                const TerminologyCapabilitiesParameter = require('../backbone_elements/terminologyCapabilitiesParameter.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.parameter = FhirResourceCreator.createArray(valueProvided, TerminologyCapabilitiesParameter);
            }
        });

        /**
         * @description Documentation about text searching works.
         * @property {markdown|undefined}
        */
        Object.defineProperty(this, 'textFilter', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.textFilter,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.textFilter = undefined;
                    return;
                }
                this.__data.textFilter = valueProvided;
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            hierarchical,
            paging,
            incomplete,
            parameter,
            textFilter
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
            hierarchical: this.hierarchical,
            paging: this.paging,
            incomplete: this.incomplete,
            parameter: this.parameter && this.parameter.map(v => v.toJSON()),
            textFilter: this.textFilter
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
            hierarchical: this.hierarchical,
            paging: this.paging,
            incomplete: this.incomplete,
            parameter: this.parameter && this.parameter.map(v => v.toJSONInternal()),
            textFilter: this.textFilter
        };

        return removeNull(json);
    }
}

module.exports = TerminologyCapabilitiesExpansion;
