

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Dosage.DoseAndRate
    Indicates how the medication is/was taken or should be taken by the patient.
    If the element is present, it must have a value for at least one of the
    defined elements, an @id referenced from the Narrative, or extensions
*/
class DosageDoseAndRate extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {CodeableConcept|undefined} [type],
     * @param {Range|undefined} [doseRange],
     * @param {Quantity|undefined} [doseQuantity],
     * @param {Ratio|undefined} [rateRatio],
     * @param {Range|undefined} [rateRange],
     * @param {Quantity|undefined} [rateQuantity],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            type,
            doseRange,
            doseQuantity,
            rateRatio,
            rateRange,
            rateQuantity
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
         * @description The kind of dose or rate specified, for example, ordered or calculated.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'type', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.type,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.type = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.type = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description None
         * @property {Range|undefined}
        */
        Object.defineProperty(this, 'doseRange', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.doseRange,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.doseRange = undefined;
                    return;
                }
                const Range = require('../complex_types/range.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.doseRange = FhirResourceCreator.create(valueProvided, Range);
            }
        });

        /**
         * @description None
         * @property {Quantity|undefined}
        */
        Object.defineProperty(this, 'doseQuantity', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.doseQuantity,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.doseQuantity = undefined;
                    return;
                }
                const Quantity = require('../complex_types/quantity.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.doseQuantity = FhirResourceCreator.create(valueProvided, Quantity);
            }
        });

        /**
         * @description None
         * @property {Ratio|undefined}
        */
        Object.defineProperty(this, 'rateRatio', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.rateRatio,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.rateRatio = undefined;
                    return;
                }
                const Ratio = require('../complex_types/ratio.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.rateRatio = FhirResourceCreator.create(valueProvided, Ratio);
            }
        });

        /**
         * @description None
         * @property {Range|undefined}
        */
        Object.defineProperty(this, 'rateRange', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.rateRange,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.rateRange = undefined;
                    return;
                }
                const Range = require('../complex_types/range.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.rateRange = FhirResourceCreator.create(valueProvided, Range);
            }
        });

        /**
         * @description None
         * @property {Quantity|undefined}
        */
        Object.defineProperty(this, 'rateQuantity', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.rateQuantity,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.rateQuantity = undefined;
                    return;
                }
                const Quantity = require('../complex_types/quantity.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.rateQuantity = FhirResourceCreator.create(valueProvided, Quantity);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            type,
            doseRange,
            doseQuantity,
            rateRatio,
            rateRange,
            rateQuantity
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
            type: this.type && this.type.toJSON(),
            doseRange: this.doseRange && this.doseRange.toJSON(),
            doseQuantity: this.doseQuantity && this.doseQuantity.toJSON(),
            rateRatio: this.rateRatio && this.rateRatio.toJSON(),
            rateRange: this.rateRange && this.rateRange.toJSON(),
            rateQuantity: this.rateQuantity && this.rateQuantity.toJSON()
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
            if (this.type) { await this.type.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.doseRange) { await this.doseRange.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.doseQuantity) { await this.doseQuantity.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.rateRatio) { await this.rateRatio.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.rateRange) { await this.rateRange.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.rateQuantity) { await this.rateQuantity.updateReferencesAsync({ fnUpdateReferenceAsync }); }
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
            type: this.type && this.type.toJSONInternal(),
            doseRange: this.doseRange && this.doseRange.toJSONInternal(),
            doseQuantity: this.doseQuantity && this.doseQuantity.toJSONInternal(),
            rateRatio: this.rateRatio && this.rateRatio.toJSONInternal(),
            rateRange: this.rateRange && this.rateRange.toJSONInternal(),
            rateQuantity: this.rateQuantity && this.rateQuantity.toJSONInternal()
        };

        return removeNull(json);
    }
}

module.exports = DosageDoseAndRate;
