

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Measure.Group
    The Measure resource provides the definition of a quality measure.
*/
class MeasureGroup extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {CodeableConcept|undefined} [code],
     * @param {String|undefined} [description],
     * @param {MeasurePopulation[]|undefined} [population],
     * @param {MeasureStratifier[]|undefined} [stratifier],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            code,
            description,
            population,
            stratifier
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
         * @description Indicates a meaning for the group. This can be as simple as a unique
    identifier, or it can establish meaning in a broader context by drawing from a
    terminology, allowing groups to be correlated across measures.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'code', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.code,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.code = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.code = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The human readable description of this population group.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'description', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.description,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.description = undefined;
                    return;
                }
                this.__data.description = valueProvided;
            }
        });

        /**
         * @description A population criteria for the measure.
         * @property {MeasurePopulation[]|undefined}
        */
        Object.defineProperty(this, 'population', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.population,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.population = undefined;
                    return;
                }
                const MeasurePopulation = require('../backbone_elements/measurePopulation.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.population = FhirResourceCreator.createArray(valueProvided, MeasurePopulation);
            }
        });

        /**
         * @description The stratifier criteria for the measure report, specified as either the name
    of a valid CQL expression defined within a referenced library or a valid FHIR
    Resource Path.
         * @property {MeasureStratifier[]|undefined}
        */
        Object.defineProperty(this, 'stratifier', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.stratifier,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.stratifier = undefined;
                    return;
                }
                const MeasureStratifier = require('../backbone_elements/measureStratifier.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.stratifier = FhirResourceCreator.createArray(valueProvided, MeasureStratifier);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            code,
            description,
            population,
            stratifier
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
            code: this.code && this.code.toJSON(),
            description: this.description,
            population: this.population && this.population.map(v => v.toJSON()),
            stratifier: this.stratifier && this.stratifier.map(v => v.toJSON())
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
            if (this.code) { await this.code.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.population) { await async.each(this.population, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.stratifier) { await async.each(this.stratifier, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            code: this.code && this.code.toJSONInternal(),
            description: this.description,
            population: this.population && this.population.map(v => v.toJSONInternal()),
            stratifier: this.stratifier && this.stratifier.map(v => v.toJSONInternal())
        };

        return removeNull(json);
    }
}

module.exports = MeasureGroup;
