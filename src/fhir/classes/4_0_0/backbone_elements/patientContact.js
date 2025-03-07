

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Patient.Contact
    Demographics and other administrative information about an individual or
    animal receiving care or other health-related services.
*/
class PatientContact extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {CodeableConcept[]|undefined} [relationship],
     * @param {HumanName|undefined} [name],
     * @param {ContactPoint[]|undefined} [telecom],
     * @param {Address|undefined} [address],
     * @param {code|undefined} [gender],
     * @param {Reference|undefined} [organization],
     * @param {Period|undefined} [period],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            relationship,
            name,
            telecom,
            address,
            gender,
            organization,
            period
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
         * @description The nature of the relationship between the patient and the contact person.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'relationship', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.relationship,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.relationship = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.relationship = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description A name associated with the contact person.
         * @property {HumanName|undefined}
        */
        Object.defineProperty(this, 'name', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.name,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.name = undefined;
                    return;
                }
                const HumanName = require('../complex_types/humanName.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.name = FhirResourceCreator.create(valueProvided, HumanName);
            }
        });

        /**
         * @description A contact detail for the person, e.g. a telephone number or an email address.
         * @property {ContactPoint[]|undefined}
        */
        Object.defineProperty(this, 'telecom', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.telecom,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.telecom = undefined;
                    return;
                }
                const ContactPoint = require('../complex_types/contactPoint.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.telecom = FhirResourceCreator.createArray(valueProvided, ContactPoint);
            }
        });

        /**
         * @description Address for the contact person.
         * @property {Address|undefined}
        */
        Object.defineProperty(this, 'address', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.address,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.address = undefined;
                    return;
                }
                const Address = require('../complex_types/address.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.address = FhirResourceCreator.create(valueProvided, Address);
            }
        });

        /**
         * @description Administrative Gender - the gender that the contact person is considered to
    have for administration and record keeping purposes.
         * @property {code|undefined}
        */
        Object.defineProperty(this, 'gender', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.gender,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.gender = undefined;
                    return;
                }
                this.__data.gender = valueProvided;
            }
        });

        /**
         * @description Organization on behalf of which the contact is acting or for which the contact
    is working.
         * @property {Reference|undefined}
        */
        Object.defineProperty(this, 'organization', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.organization,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.organization = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.organization = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description The period during which this contact person or organization is valid to be
    contacted relating to this patient.
         * @property {Period|undefined}
        */
        Object.defineProperty(this, 'period', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.period,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.period = undefined;
                    return;
                }
                const Period = require('../complex_types/period.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.period = FhirResourceCreator.create(valueProvided, Period);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            relationship,
            name,
            telecom,
            address,
            gender,
            organization,
            period
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
            relationship: this.relationship && this.relationship.map(v => v.toJSON()),
            name: this.name && this.name.toJSON(),
            telecom: this.telecom && this.telecom.map(v => v.toJSON()),
            address: this.address && this.address.toJSON(),
            gender: this.gender,
            organization: this.organization && this.organization.toJSON(),
            period: this.period && this.period.toJSON()
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
            if (this.relationship) { await async.each(this.relationship, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.name) { await this.name.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.telecom) { await async.each(this.telecom, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.address) { await this.address.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.organization) { await this.organization.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.period) { await this.period.updateReferencesAsync({ fnUpdateReferenceAsync }); }
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
            relationship: this.relationship && this.relationship.map(v => v.toJSONInternal()),
            name: this.name && this.name.toJSONInternal(),
            telecom: this.telecom && this.telecom.map(v => v.toJSONInternal()),
            address: this.address && this.address.toJSONInternal(),
            gender: this.gender,
            organization: this.organization && this.organization.toJSONInternal(),
            period: this.period && this.period.toJSONInternal()
        };

        return removeNull(json);
    }
}

module.exports = PatientContact;
