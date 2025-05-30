

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
MedicationAdministration.Dosage
    Describes the event of a patient consuming or otherwise being administered a
    medication.  This may be as simple as swallowing a tablet or it may be a long
    running infusion.  Related resources tie this event to the authorizing
    prescription, and the specific encounter between patient and health care
    practitioner.
*/
class MedicationAdministrationDosage extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {String|undefined} [text],
     * @param {CodeableConcept|undefined} [site],
     * @param {CodeableConcept|undefined} [route],
     * @param {CodeableConcept|undefined} [method],
     * @param {Quantity|undefined} [dose],
     * @param {Ratio|undefined} [rateRatio],
     * @param {Quantity|undefined} [rateQuantity],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            text,
            site,
            route,
            method,
            dose,
            rateRatio,
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
         * @description Free text dosage can be used for cases where the dosage administered is too
    complex to code. When coded dosage is present, the free text dosage may still
    be present for display to humans.

    The dosage instructions should reflect the dosage of the medication that was
    administered.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'text', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.text,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.text = undefined;
                    return;
                }
                this.__data.text = valueProvided;
            }
        });

        /**
         * @description A coded specification of the anatomic site where the medication first entered
    the body.  For example, "left arm".
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'site', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.site,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.site = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.site = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description A code specifying the route or physiological path of administration of a
    therapeutic agent into or onto the patient.  For example, topical,
    intravenous, etc.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'route', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.route,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.route = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.route = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description A coded value indicating the method by which the medication is intended to be
    or was introduced into or on the body.  This attribute will most often NOT be
    populated.  It is most commonly used for injections.  For example, Slow Push,
    Deep IV.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'method', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.method,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.method = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.method = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The amount of the medication given at one administration event.   Use this
    value when the administration is essentially an instantaneous event such as a
    swallowing a tablet or giving an injection.
         * @property {Quantity|undefined}
        */
        Object.defineProperty(this, 'dose', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.dose,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.dose = undefined;
                    return;
                }
                const Quantity = require('../complex_types/quantity.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.dose = FhirResourceCreator.create(valueProvided, Quantity);
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
            text,
            site,
            route,
            method,
            dose,
            rateRatio,
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
            text: this.text,
            site: this.site && this.site.toJSON(),
            route: this.route && this.route.toJSON(),
            method: this.method && this.method.toJSON(),
            dose: this.dose && this.dose.toJSON(),
            rateRatio: this.rateRatio && this.rateRatio.toJSON(),
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
            if (this.site) { await this.site.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.route) { await this.route.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.method) { await this.method.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.dose) { await this.dose.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.rateRatio) { await this.rateRatio.updateReferencesAsync({ fnUpdateReferenceAsync }); }
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
            text: this.text,
            site: this.site && this.site.toJSONInternal(),
            route: this.route && this.route.toJSONInternal(),
            method: this.method && this.method.toJSONInternal(),
            dose: this.dose && this.dose.toJSONInternal(),
            rateRatio: this.rateRatio && this.rateRatio.toJSONInternal(),
            rateQuantity: this.rateQuantity && this.rateQuantity.toJSONInternal()
        };

        return removeNull(json);
    }
}

module.exports = MedicationAdministrationDosage;
