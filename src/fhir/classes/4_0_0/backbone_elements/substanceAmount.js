

// This file is auto-generated by generate_classes so do not edit manually

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
SubstanceAmount
    Chemical substances are a single substance type whose primary defining element
    is the molecular structure. Chemical substances shall be defined on the basis
    of their complete covalent molecular structure; the presence of a salt
    (counter-ion) and/or solvates (water, alcohols) is also captured. Purity,
    grade, physical form or particle size are not taken into account in the
    definition of a chemical substance or in the assignment of a Substance ID.
    If the element is present, it must have a value for at least one of the
    defined elements, an @id referenced from the Narrative, or extensions
*/
class SubstanceAmount extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Quantity|undefined} [amountQuantity],
     * @param {Range|undefined} [amountRange],
     * @param {String|undefined} [amountString],
     * @param {CodeableConcept|undefined} [amountType],
     * @param {String|undefined} [amountText],
     * @param {SubstanceAmountReferenceRange|undefined} [referenceRange],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            amountQuantity,
            amountRange,
            amountString,
            amountType,
            amountText,
            referenceRange
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
         * @description None
         * @property {Quantity|undefined}
        */
        Object.defineProperty(this, 'amountQuantity', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.amountQuantity,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.amountQuantity = undefined;
                    return;
                }
                const Quantity = require('../complex_types/quantity.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.amountQuantity = FhirResourceCreator.create(valueProvided, Quantity);
            }
        });

        /**
         * @description None
         * @property {Range|undefined}
        */
        Object.defineProperty(this, 'amountRange', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.amountRange,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.amountRange = undefined;
                    return;
                }
                const Range = require('../complex_types/range.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.amountRange = FhirResourceCreator.create(valueProvided, Range);
            }
        });

        /**
         * @description None
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'amountString', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.amountString,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.amountString = undefined;
                    return;
                }
                this.__data.amountString = valueProvided;
            }
        });

        /**
         * @description Most elements that require a quantitative value will also have a field called
    amount type. Amount type should always be specified because the actual value
    of the amount is often dependent on it. EXAMPLE: In capturing the actual
    relative amounts of substances or molecular fragments it is essential to
    indicate whether the amount refers to a mole ratio or weight ratio. For any
    given element an effort should be made to use same the amount type for all
    related definitional elements.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'amountType', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.amountType,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.amountType = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.amountType = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description A textual comment on a numeric value.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'amountText', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.amountText,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.amountText = undefined;
                    return;
                }
                this.__data.amountText = valueProvided;
            }
        });

        /**
         * @description Reference range of possible or expected values.
         * @property {SubstanceAmountReferenceRange|undefined}
        */
        Object.defineProperty(this, 'referenceRange', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.referenceRange,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.referenceRange = undefined;
                    return;
                }
                const SubstanceAmountReferenceRange = require('../backbone_elements/substanceAmountReferenceRange.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.referenceRange = FhirResourceCreator.create(valueProvided, SubstanceAmountReferenceRange);
            }
        });

        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            amountQuantity,
            amountRange,
            amountString,
            amountType,
            amountText,
            referenceRange
        });
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON () {
        const { removeNull } = require('../../../../utils/nullRemover');

        return removeNull({
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSON()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSON()),
            amountQuantity: this.amountQuantity && this.amountQuantity.toJSON(),
            amountRange: this.amountRange && this.amountRange.toJSON(),
            amountString: this.amountString,
            amountType: this.amountType && this.amountType.toJSON(),
            amountText: this.amountText,
            referenceRange: this.referenceRange && this.referenceRange.toJSON()
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
            if (this.amountQuantity) { await this.amountQuantity.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.amountRange) { await this.amountRange.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.amountType) { await this.amountType.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.referenceRange) { await this.referenceRange.updateReferencesAsync({ fnUpdateReferenceAsync }); }
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal () {
        const { removeNull } = require('../../../../utils/nullRemover');
        const json = {
            id: this.id,
            extension: this.extension && this.extension.map(v => v.toJSONInternal()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSONInternal()),
            amountQuantity: this.amountQuantity && this.amountQuantity.toJSONInternal(),
            amountRange: this.amountRange && this.amountRange.toJSONInternal(),
            amountString: this.amountString,
            amountType: this.amountType && this.amountType.toJSONInternal(),
            amountText: this.amountText,
            referenceRange: this.referenceRange && this.referenceRange.toJSONInternal()
        };

        return removeNull(json);
    }
}

module.exports = SubstanceAmount;