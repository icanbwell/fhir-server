

// This file is auto-generated by generate_classes so do not edit manually

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
SubstanceDefinition.Structure
    The detailed description of a substance, typically at a level beyond what is
    used for prescribing.
*/
class SubstanceDefinitionStructure extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {CodeableConcept|undefined} [stereochemistry],
     * @param {CodeableConcept|undefined} [opticalActivity],
     * @param {String|undefined} [molecularFormula],
     * @param {String|undefined} [molecularFormulaByMoiety],
     * @param {SubstanceDefinitionMolecularWeight|undefined} [molecularWeight],
     * @param {CodeableConcept[]|undefined} [technique],
     * @param {Reference[]|undefined} [sourceDocument],
     * @param {SubstanceDefinitionRepresentation[]|undefined} [representation],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            stereochemistry,
            opticalActivity,
            molecularFormula,
            molecularFormulaByMoiety,
            molecularWeight,
            technique,
            sourceDocument,
            representation
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
         * @description Stereochemistry type.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'stereochemistry', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.stereochemistry,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.stereochemistry = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.stereochemistry = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Optical activity type.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'opticalActivity', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.opticalActivity,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.opticalActivity = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.opticalActivity = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Molecular formula of this substance, typically using the Hill system.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'molecularFormula', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.molecularFormula,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.molecularFormula = undefined;
                    return;
                }
                this.__data.molecularFormula = valueProvided;
            }
        });

        /**
         * @description Specified per moiety according to the Hill system, i.e. first C, then H, then
    alphabetical, each moiety separated by a dot.
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'molecularFormulaByMoiety', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.molecularFormulaByMoiety,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.molecularFormulaByMoiety = undefined;
                    return;
                }
                this.__data.molecularFormulaByMoiety = valueProvided;
            }
        });

        /**
         * @description The molecular weight or weight range (for proteins, polymers or nucleic
    acids).
         * @property {SubstanceDefinitionMolecularWeight|undefined}
        */
        Object.defineProperty(this, 'molecularWeight', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.molecularWeight,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.molecularWeight = undefined;
                    return;
                }
                const SubstanceDefinitionMolecularWeight = require('../backbone_elements/substanceDefinitionMolecularWeight.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.molecularWeight = FhirResourceCreator.create(valueProvided, SubstanceDefinitionMolecularWeight);
            }
        });

        /**
         * @description The method used to elucidate the structure or characterization of the drug
    substance. Examples: X-ray, HPLC, NMR, Peptide mapping, Ligand binding assay.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'technique', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.technique,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.technique = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.technique = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The source of information about the structure.
         * @property {Reference[]|undefined}
        */
        Object.defineProperty(this, 'sourceDocument', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.sourceDocument,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.sourceDocument = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.sourceDocument = FhirResourceCreator.createArray(valueProvided, Reference);
            }
        });

        /**
         * @description A depiction of the structure or characterization of the substance.
         * @property {SubstanceDefinitionRepresentation[]|undefined}
        */
        Object.defineProperty(this, 'representation', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.representation,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.representation = undefined;
                    return;
                }
                const SubstanceDefinitionRepresentation = require('../backbone_elements/substanceDefinitionRepresentation.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.representation = FhirResourceCreator.createArray(valueProvided, SubstanceDefinitionRepresentation);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            stereochemistry,
            opticalActivity,
            molecularFormula,
            molecularFormulaByMoiety,
            molecularWeight,
            technique,
            sourceDocument,
            representation
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
            stereochemistry: this.stereochemistry && this.stereochemistry.toJSON(),
            opticalActivity: this.opticalActivity && this.opticalActivity.toJSON(),
            molecularFormula: this.molecularFormula,
            molecularFormulaByMoiety: this.molecularFormulaByMoiety,
            molecularWeight: this.molecularWeight && this.molecularWeight.toJSON(),
            technique: this.technique && this.technique.map(v => v.toJSON()),
            sourceDocument: this.sourceDocument && this.sourceDocument.map(v => v.toJSON()),
            representation: this.representation && this.representation.map(v => v.toJSON())
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
            if (this.stereochemistry) { await this.stereochemistry.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.opticalActivity) { await this.opticalActivity.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.molecularWeight) { await this.molecularWeight.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.technique) { await async.each(this.technique, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.sourceDocument) { await async.each(this.sourceDocument, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.representation) { await async.each(this.representation, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            stereochemistry: this.stereochemistry && this.stereochemistry.toJSONInternal(),
            opticalActivity: this.opticalActivity && this.opticalActivity.toJSONInternal(),
            molecularFormula: this.molecularFormula,
            molecularFormulaByMoiety: this.molecularFormulaByMoiety,
            molecularWeight: this.molecularWeight && this.molecularWeight.toJSONInternal(),
            technique: this.technique && this.technique.map(v => v.toJSONInternal()),
            sourceDocument: this.sourceDocument && this.sourceDocument.map(v => v.toJSONInternal()),
            representation: this.representation && this.representation.map(v => v.toJSONInternal())
        };

        return removeNull(json);
    }
}

module.exports = SubstanceDefinitionStructure;