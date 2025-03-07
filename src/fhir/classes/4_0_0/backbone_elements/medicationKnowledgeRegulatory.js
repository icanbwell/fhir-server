

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
MedicationKnowledge.Regulatory
    Information about a medication that is used to support knowledge.
*/
class MedicationKnowledgeRegulatory extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Reference} regulatoryAuthority,
     * @param {MedicationKnowledgeSubstitution[]|undefined} [substitution],
     * @param {MedicationKnowledgeSchedule[]|undefined} [schedule],
     * @param {MedicationKnowledgeMaxDispense|undefined} [maxDispense],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            regulatoryAuthority,
            substitution,
            schedule,
            maxDispense
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
         * @description The authority that is specifying the regulations.
         * @property {Reference}
        */
        Object.defineProperty(this, 'regulatoryAuthority', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.regulatoryAuthority,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.regulatoryAuthority = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.regulatoryAuthority = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description Specifies if changes are allowed when dispensing a medication from a
    regulatory perspective.
         * @property {MedicationKnowledgeSubstitution[]|undefined}
        */
        Object.defineProperty(this, 'substitution', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.substitution,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.substitution = undefined;
                    return;
                }
                const MedicationKnowledgeSubstitution = require('../backbone_elements/medicationKnowledgeSubstitution.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.substitution = FhirResourceCreator.createArray(valueProvided, MedicationKnowledgeSubstitution);
            }
        });

        /**
         * @description Specifies the schedule of a medication in jurisdiction.
         * @property {MedicationKnowledgeSchedule[]|undefined}
        */
        Object.defineProperty(this, 'schedule', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.schedule,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.schedule = undefined;
                    return;
                }
                const MedicationKnowledgeSchedule = require('../backbone_elements/medicationKnowledgeSchedule.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.schedule = FhirResourceCreator.createArray(valueProvided, MedicationKnowledgeSchedule);
            }
        });

        /**
         * @description The maximum number of units of the medication that can be dispensed in a
    period.
         * @property {MedicationKnowledgeMaxDispense|undefined}
        */
        Object.defineProperty(this, 'maxDispense', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.maxDispense,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.maxDispense = undefined;
                    return;
                }
                const MedicationKnowledgeMaxDispense = require('../backbone_elements/medicationKnowledgeMaxDispense.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.maxDispense = FhirResourceCreator.create(valueProvided, MedicationKnowledgeMaxDispense);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            regulatoryAuthority,
            substitution,
            schedule,
            maxDispense
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
            regulatoryAuthority: this.regulatoryAuthority && this.regulatoryAuthority.toJSON(),
            substitution: this.substitution && this.substitution.map(v => v.toJSON()),
            schedule: this.schedule && this.schedule.map(v => v.toJSON()),
            maxDispense: this.maxDispense && this.maxDispense.toJSON()
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
            if (this.regulatoryAuthority) { await this.regulatoryAuthority.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.substitution) { await async.each(this.substitution, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.schedule) { await async.each(this.schedule, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.maxDispense) { await this.maxDispense.updateReferencesAsync({ fnUpdateReferenceAsync }); }
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
            regulatoryAuthority: this.regulatoryAuthority && this.regulatoryAuthority.toJSONInternal(),
            substitution: this.substitution && this.substitution.map(v => v.toJSONInternal()),
            schedule: this.schedule && this.schedule.map(v => v.toJSONInternal()),
            maxDispense: this.maxDispense && this.maxDispense.toJSONInternal()
        };

        return removeNull(json);
    }
}

module.exports = MedicationKnowledgeRegulatory;
