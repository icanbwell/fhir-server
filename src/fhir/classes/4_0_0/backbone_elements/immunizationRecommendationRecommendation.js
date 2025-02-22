

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
ImmunizationRecommendation.Recommendation
    A patient's point-in-time set of recommendations (i.e. forecasting) according
    to a published schedule with optional supporting justification.
*/
class ImmunizationRecommendationRecommendation extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {CodeableConcept[]|undefined} [vaccineCode],
     * @param {CodeableConcept|undefined} [targetDisease],
     * @param {CodeableConcept[]|undefined} [contraindicatedVaccineCode],
     * @param {CodeableConcept} forecastStatus,
     * @param {CodeableConcept[]|undefined} [forecastReason],
     * @param {ImmunizationRecommendationDateCriterion[]|undefined} [dateCriterion],
     * @param {String|undefined} [description],
     * @param {String|undefined} [series],
     * @param {Int|undefined} [doseNumberPositiveInt],
     * @param {String|undefined} [doseNumberString],
     * @param {Int|undefined} [seriesDosesPositiveInt],
     * @param {String|undefined} [seriesDosesString],
     * @param {Reference[]|undefined} [supportingImmunization],
     * @param {Reference[]|undefined} [supportingPatientInformation],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            vaccineCode,
            targetDisease,
            contraindicatedVaccineCode,
            forecastStatus,
            forecastReason,
            dateCriterion,
            description,
            series,
            doseNumberPositiveInt,
            doseNumberString,
            seriesDosesPositiveInt,
            seriesDosesString,
            supportingImmunization,
            supportingPatientInformation
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
         * @description Vaccine(s) or vaccine group that pertain to the recommendation.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'vaccineCode', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.vaccineCode,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.vaccineCode = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.vaccineCode = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The targeted disease for the recommendation.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'targetDisease', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.targetDisease,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.targetDisease = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.targetDisease = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Vaccine(s) which should not be used to fulfill the recommendation.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'contraindicatedVaccineCode', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.contraindicatedVaccineCode,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.contraindicatedVaccineCode = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.contraindicatedVaccineCode = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Indicates the patient status with respect to the path to immunity for the
    target disease.
         * @property {CodeableConcept}
        */
        Object.defineProperty(this, 'forecastStatus', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.forecastStatus,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.forecastStatus = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.forecastStatus = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The reason for the assigned forecast status.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'forecastReason', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.forecastReason,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.forecastReason = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.forecastReason = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Vaccine date recommendations.  For example, earliest date to administer,
    latest date to administer, etc.
         * @property {ImmunizationRecommendationDateCriterion[]|undefined}
        */
        Object.defineProperty(this, 'dateCriterion', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.dateCriterion,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.dateCriterion = undefined;
                    return;
                }
                const ImmunizationRecommendationDateCriterion = require('../backbone_elements/immunizationRecommendationDateCriterion.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.dateCriterion = FhirResourceCreator.createArray(valueProvided, ImmunizationRecommendationDateCriterion);
            }
        });

        /**
         * @description Contains the description about the protocol under which the vaccine was
    administered.
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
         * @description One possible path to achieve presumed immunity against a disease - within the
    context of an authority.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'series', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.series,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.series = undefined;
                    return;
                }
                this.__data.series = valueProvided;
            }
        });

        /**
         * @description None
         * @property {Int|undefined}
        */
        Object.defineProperty(this, 'doseNumberPositiveInt', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.doseNumberPositiveInt,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.doseNumberPositiveInt = undefined;
                    return;
                }
                this.__data.doseNumberPositiveInt = valueProvided;
            }
        });

        /**
         * @description None
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'doseNumberString', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.doseNumberString,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.doseNumberString = undefined;
                    return;
                }
                this.__data.doseNumberString = valueProvided;
            }
        });

        /**
         * @description None
         * @property {Int|undefined}
        */
        Object.defineProperty(this, 'seriesDosesPositiveInt', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.seriesDosesPositiveInt,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.seriesDosesPositiveInt = undefined;
                    return;
                }
                this.__data.seriesDosesPositiveInt = valueProvided;
            }
        });

        /**
         * @description None
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'seriesDosesString', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.seriesDosesString,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.seriesDosesString = undefined;
                    return;
                }
                this.__data.seriesDosesString = valueProvided;
            }
        });

        /**
         * @description Immunization event history and/or evaluation that supports the status and
    recommendation.
         * @property {Reference[]|undefined}
        */
        Object.defineProperty(this, 'supportingImmunization', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.supportingImmunization,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.supportingImmunization = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.supportingImmunization = FhirResourceCreator.createArray(valueProvided, Reference);
            }
        });

        /**
         * @description Patient Information that supports the status and recommendation.  This
    includes patient observations, adverse reactions and allergy/intolerance
    information.
         * @property {Reference[]|undefined}
        */
        Object.defineProperty(this, 'supportingPatientInformation', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.supportingPatientInformation,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.supportingPatientInformation = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.supportingPatientInformation = FhirResourceCreator.createArray(valueProvided, Reference);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            vaccineCode,
            targetDisease,
            contraindicatedVaccineCode,
            forecastStatus,
            forecastReason,
            dateCriterion,
            description,
            series,
            doseNumberPositiveInt,
            doseNumberString,
            seriesDosesPositiveInt,
            seriesDosesString,
            supportingImmunization,
            supportingPatientInformation
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
            vaccineCode: this.vaccineCode && this.vaccineCode.map(v => v.toJSON()),
            targetDisease: this.targetDisease && this.targetDisease.toJSON(),
            contraindicatedVaccineCode: this.contraindicatedVaccineCode && this.contraindicatedVaccineCode.map(v => v.toJSON()),
            forecastStatus: this.forecastStatus && this.forecastStatus.toJSON(),
            forecastReason: this.forecastReason && this.forecastReason.map(v => v.toJSON()),
            dateCriterion: this.dateCriterion && this.dateCriterion.map(v => v.toJSON()),
            description: this.description,
            series: this.series,
            doseNumberPositiveInt: this.doseNumberPositiveInt,
            doseNumberString: this.doseNumberString,
            seriesDosesPositiveInt: this.seriesDosesPositiveInt,
            seriesDosesString: this.seriesDosesString,
            supportingImmunization: this.supportingImmunization && this.supportingImmunization.map(v => v.toJSON()),
            supportingPatientInformation: this.supportingPatientInformation && this.supportingPatientInformation.map(v => v.toJSON())
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
            if (this.vaccineCode) { await async.each(this.vaccineCode, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.targetDisease) { await this.targetDisease.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.contraindicatedVaccineCode) { await async.each(this.contraindicatedVaccineCode, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.forecastStatus) { await this.forecastStatus.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.forecastReason) { await async.each(this.forecastReason, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.dateCriterion) { await async.each(this.dateCriterion, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.supportingImmunization) { await async.each(this.supportingImmunization, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.supportingPatientInformation) { await async.each(this.supportingPatientInformation, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            vaccineCode: this.vaccineCode && this.vaccineCode.map(v => v.toJSONInternal()),
            targetDisease: this.targetDisease && this.targetDisease.toJSONInternal(),
            contraindicatedVaccineCode: this.contraindicatedVaccineCode && this.contraindicatedVaccineCode.map(v => v.toJSONInternal()),
            forecastStatus: this.forecastStatus && this.forecastStatus.toJSONInternal(),
            forecastReason: this.forecastReason && this.forecastReason.map(v => v.toJSONInternal()),
            dateCriterion: this.dateCriterion && this.dateCriterion.map(v => v.toJSONInternal()),
            description: this.description,
            series: this.series,
            doseNumberPositiveInt: this.doseNumberPositiveInt,
            doseNumberString: this.doseNumberString,
            seriesDosesPositiveInt: this.seriesDosesPositiveInt,
            seriesDosesString: this.seriesDosesString,
            supportingImmunization: this.supportingImmunization && this.supportingImmunization.map(v => v.toJSONInternal()),
            supportingPatientInformation: this.supportingPatientInformation && this.supportingPatientInformation.map(v => v.toJSONInternal())
        };

        return removeNull(json);
    }
}

module.exports = ImmunizationRecommendationRecommendation;
