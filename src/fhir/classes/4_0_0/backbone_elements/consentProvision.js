

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Consent.Provision
    A record of a healthcare consumer’s  choices, which permits or denies
    identified recipient(s) or recipient role(s) to perform one or more actions
    within a given policy context, for specific purposes and periods of time.
*/
class ConsentProvision extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {code|undefined} [type],
     * @param {Period|undefined} [period],
     * @param {ConsentActor[]|undefined} [actor],
     * @param {CodeableConcept[]|undefined} [action],
     * @param {Coding[]|undefined} [securityLabel],
     * @param {Coding[]|undefined} [purpose],
     * @param {Coding[]|undefined} [class_],
     * @param {CodeableConcept[]|undefined} [code],
     * @param {Period|undefined} [dataPeriod],
     * @param {ConsentData[]|undefined} [data],
     * @param {ConsentProvision[]|undefined} [provision],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            type,
            period,
            actor,
            action,
            securityLabel,
            purpose,
            class: class_,
            code,
            dataPeriod,
            data,
            provision
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
         * @description Action  to take - permit or deny - when the rule conditions are met.  Not
    permitted in root rule, required in all nested rules.
         * @property {code|undefined}
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
                this.__data.type = valueProvided;
            }
        });

        /**
         * @description The timeframe in this rule is valid.
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

        /**
         * @description Who or what is controlled by this rule. Use group to identify a set of actors
    by some property they share (e.g. 'admitting officers').
         * @property {ConsentActor[]|undefined}
        */
        Object.defineProperty(this, 'actor', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.actor,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.actor = undefined;
                    return;
                }
                const ConsentActor = require('../backbone_elements/consentActor.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.actor = FhirResourceCreator.createArray(valueProvided, ConsentActor);
            }
        });

        /**
         * @description Actions controlled by this Rule.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'action', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.action,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.action = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.action = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description A security label, comprised of 0..* security label fields (Privacy tags),
    which define which resources are controlled by this exception.
         * @property {Coding[]|undefined}
        */
        Object.defineProperty(this, 'securityLabel', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.securityLabel,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.securityLabel = undefined;
                    return;
                }
                const Coding = require('../complex_types/coding.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.securityLabel = FhirResourceCreator.createArray(valueProvided, Coding);
            }
        });

        /**
         * @description The context of the activities a user is taking - why the user is accessing the
    data - that are controlled by this rule.
         * @property {Coding[]|undefined}
        */
        Object.defineProperty(this, 'purpose', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.purpose,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.purpose = undefined;
                    return;
                }
                const Coding = require('../complex_types/coding.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.purpose = FhirResourceCreator.createArray(valueProvided, Coding);
            }
        });

        /**
         * @description The class of information covered by this rule. The type can be a FHIR resource
    type, a profile on a type, or a CDA document, or some other type that
    indicates what sort of information the consent relates to.
         * @property {Coding[]|undefined}
        */
        Object.defineProperty(this, 'class', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.class,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.class = undefined;
                    return;
                }
                const Coding = require('../complex_types/coding.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.class = FhirResourceCreator.createArray(valueProvided, Coding);
            }
        });

        /**
         * @description If this code is found in an instance, then the rule applies.
         * @property {CodeableConcept[]|undefined}
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
                this.__data.code = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Clinical or Operational Relevant period of time that bounds the data
    controlled by this rule.
         * @property {Period|undefined}
        */
        Object.defineProperty(this, 'dataPeriod', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.dataPeriod,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.dataPeriod = undefined;
                    return;
                }
                const Period = require('../complex_types/period.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.dataPeriod = FhirResourceCreator.create(valueProvided, Period);
            }
        });

        /**
         * @description The resources controlled by this rule if specific resources are referenced.
         * @property {ConsentData[]|undefined}
        */
        Object.defineProperty(this, 'data', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.data,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.data = undefined;
                    return;
                }
                const ConsentData = require('../backbone_elements/consentData.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.data = FhirResourceCreator.createArray(valueProvided, ConsentData);
            }
        });

        /**
         * @description Rules which provide exceptions to the base rule or subrules.
         * @property {ConsentProvision[]|undefined}
        */
        Object.defineProperty(this, 'provision', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.provision,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.provision = undefined;
                    return;
                }
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.provision = FhirResourceCreator.createArray(valueProvided, ConsentProvision);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            type,
            period,
            actor,
            action,
            securityLabel,
            purpose,
            class: class_,
            code,
            dataPeriod,
            data,
            provision
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
            type: this.type,
            period: this.period && this.period.toJSON(),
            actor: this.actor && this.actor.map(v => v.toJSON()),
            action: this.action && this.action.map(v => v.toJSON()),
            securityLabel: this.securityLabel && this.securityLabel.map(v => v.toJSON()),
            purpose: this.purpose && this.purpose.map(v => v.toJSON()),
            class: this.class && this.class.map(v => v.toJSON()),
            code: this.code && this.code.map(v => v.toJSON()),
            dataPeriod: this.dataPeriod && this.dataPeriod.toJSON(),
            data: this.data && this.data.map(v => v.toJSON()),
            provision: this.provision && this.provision.map(v => v.toJSON())
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
            if (this.period) { await this.period.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.actor) { await async.each(this.actor, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.action) { await async.each(this.action, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.securityLabel) { await async.each(this.securityLabel, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.purpose) { await async.each(this.purpose, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.class) { await async.each(this.class, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.code) { await async.each(this.code, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.dataPeriod) { await this.dataPeriod.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.data) { await async.each(this.data, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.provision) { await async.each(this.provision, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            type: this.type,
            period: this.period && this.period.toJSONInternal(),
            actor: this.actor && this.actor.map(v => v.toJSONInternal()),
            action: this.action && this.action.map(v => v.toJSONInternal()),
            securityLabel: this.securityLabel && this.securityLabel.map(v => v.toJSONInternal()),
            purpose: this.purpose && this.purpose.map(v => v.toJSONInternal()),
            class: this.class && this.class.map(v => v.toJSONInternal()),
            code: this.code && this.code.map(v => v.toJSONInternal()),
            dataPeriod: this.dataPeriod && this.dataPeriod.toJSONInternal(),
            data: this.data && this.data.map(v => v.toJSONInternal()),
            provision: this.provision && this.provision.map(v => v.toJSONInternal())
        };

        return removeNull(json);
    }
}

module.exports = ConsentProvision;
