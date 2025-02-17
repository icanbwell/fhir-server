

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Citation.CitedArtifact
    The Citation Resource enables reference to any knowledge artifact for purposes
    of identification and attribution. The Citation Resource supports existing
    reference structures and developing publication practices such as versioning,
    expressing complex contributorship roles, and referencing computable
    resources.
*/
class CitationCitedArtifact extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Identifier[]|undefined} [identifier],
     * @param {Identifier[]|undefined} [relatedIdentifier],
     * @param {dateTime|undefined} [dateAccessed],
     * @param {CitationVersion|undefined} [version],
     * @param {CodeableConcept[]|undefined} [currentState],
     * @param {CitationStatusDate1[]|undefined} [statusDate],
     * @param {CitationTitle[]|undefined} [title],
     * @param {CitationAbstract[]|undefined} [abstract],
     * @param {CitationPart|undefined} [part],
     * @param {CitationRelatesTo1[]|undefined} [relatesTo],
     * @param {CitationPublicationForm[]|undefined} [publicationForm],
     * @param {CitationWebLocation[]|undefined} [webLocation],
     * @param {CitationClassification1[]|undefined} [classification],
     * @param {CitationContributorship|undefined} [contributorship],
     * @param {Annotation[]|undefined} [note],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            identifier,
            relatedIdentifier,
            dateAccessed,
            version,
            currentState,
            statusDate,
            title,
            abstract,
            part,
            relatesTo,
            publicationForm,
            webLocation,
            classification,
            contributorship,
            note
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
         * @description A formal identifier that is used to identify this citation when it is
    represented in other formats, or referenced in a specification, model, design
    or an instance.
         * @property {Identifier[]|undefined}
        */
        Object.defineProperty(this, 'identifier', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.identifier,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.identifier = undefined;
                    return;
                }
                const Identifier = require('../complex_types/identifier.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.identifier = FhirResourceCreator.createArray(valueProvided, Identifier);
            }
        });

        /**
         * @description A formal identifier that is used to identify things closely related to this
    citation.
         * @property {Identifier[]|undefined}
        */
        Object.defineProperty(this, 'relatedIdentifier', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.relatedIdentifier,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.relatedIdentifier = undefined;
                    return;
                }
                const Identifier = require('../complex_types/identifier.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.relatedIdentifier = FhirResourceCreator.createArray(valueProvided, Identifier);
            }
        });

        /**
         * @description When the cited artifact was accessed.
         * @property {dateTime|undefined}
        */
        Object.defineProperty(this, 'dateAccessed', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.dateAccessed,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.dateAccessed = undefined;
                    return;
                }
                this.__data.dateAccessed = valueProvided;
            }
        });

        /**
         * @description The defined version of the cited artifact.
         * @property {CitationVersion|undefined}
        */
        Object.defineProperty(this, 'version', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.version,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.version = undefined;
                    return;
                }
                const CitationVersion = require('../backbone_elements/citationVersion.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.version = FhirResourceCreator.create(valueProvided, CitationVersion);
            }
        });

        /**
         * @description The status of the cited artifact.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'currentState', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.currentState,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.currentState = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.currentState = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description An effective date or period for a status of the cited artifact.
         * @property {CitationStatusDate1[]|undefined}
        */
        Object.defineProperty(this, 'statusDate', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.statusDate,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.statusDate = undefined;
                    return;
                }
                const CitationStatusDate1 = require('../backbone_elements/citationStatusDate1.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.statusDate = FhirResourceCreator.createArray(valueProvided, CitationStatusDate1);
            }
        });

        /**
         * @description The title details of the article or artifact.
         * @property {CitationTitle[]|undefined}
        */
        Object.defineProperty(this, 'title', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.title,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.title = undefined;
                    return;
                }
                const CitationTitle = require('../backbone_elements/citationTitle.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.title = FhirResourceCreator.createArray(valueProvided, CitationTitle);
            }
        });

        /**
         * @description Summary of the article or artifact.
         * @property {CitationAbstract[]|undefined}
        */
        Object.defineProperty(this, 'abstract', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.abstract,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.abstract = undefined;
                    return;
                }
                const CitationAbstract = require('../backbone_elements/citationAbstract.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.abstract = FhirResourceCreator.createArray(valueProvided, CitationAbstract);
            }
        });

        /**
         * @description The component of the article or artifact.
         * @property {CitationPart|undefined}
        */
        Object.defineProperty(this, 'part', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.part,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.part = undefined;
                    return;
                }
                const CitationPart = require('../backbone_elements/citationPart.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.part = FhirResourceCreator.create(valueProvided, CitationPart);
            }
        });

        /**
         * @description The artifact related to the cited artifact.
         * @property {CitationRelatesTo1[]|undefined}
        */
        Object.defineProperty(this, 'relatesTo', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.relatesTo,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.relatesTo = undefined;
                    return;
                }
                const CitationRelatesTo1 = require('../backbone_elements/citationRelatesTo1.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.relatesTo = FhirResourceCreator.createArray(valueProvided, CitationRelatesTo1);
            }
        });

        /**
         * @description If multiple, used to represent alternative forms of the article that are not
    separate citations.
         * @property {CitationPublicationForm[]|undefined}
        */
        Object.defineProperty(this, 'publicationForm', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.publicationForm,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.publicationForm = undefined;
                    return;
                }
                const CitationPublicationForm = require('../backbone_elements/citationPublicationForm.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.publicationForm = FhirResourceCreator.createArray(valueProvided, CitationPublicationForm);
            }
        });

        /**
         * @description Used for any URL for the article or artifact cited.
         * @property {CitationWebLocation[]|undefined}
        */
        Object.defineProperty(this, 'webLocation', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.webLocation,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.webLocation = undefined;
                    return;
                }
                const CitationWebLocation = require('../backbone_elements/citationWebLocation.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.webLocation = FhirResourceCreator.createArray(valueProvided, CitationWebLocation);
            }
        });

        /**
         * @description The assignment to an organizing scheme.
         * @property {CitationClassification1[]|undefined}
        */
        Object.defineProperty(this, 'classification', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.classification,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.classification = undefined;
                    return;
                }
                const CitationClassification1 = require('../backbone_elements/citationClassification1.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.classification = FhirResourceCreator.createArray(valueProvided, CitationClassification1);
            }
        });

        /**
         * @description This element is used to list authors and other contributors, their contact
    information, specific contributions, and summary statements.
         * @property {CitationContributorship|undefined}
        */
        Object.defineProperty(this, 'contributorship', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.contributorship,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.contributorship = undefined;
                    return;
                }
                const CitationContributorship = require('../backbone_elements/citationContributorship.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.contributorship = FhirResourceCreator.create(valueProvided, CitationContributorship);
            }
        });

        /**
         * @description Any additional information or content for the article or artifact.
         * @property {Annotation[]|undefined}
        */
        Object.defineProperty(this, 'note', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.note,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.note = undefined;
                    return;
                }
                const Annotation = require('../complex_types/annotation.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.note = FhirResourceCreator.createArray(valueProvided, Annotation);
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            identifier,
            relatedIdentifier,
            dateAccessed,
            version,
            currentState,
            statusDate,
            title,
            abstract,
            part,
            relatesTo,
            publicationForm,
            webLocation,
            classification,
            contributorship,
            note
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
            identifier: this.identifier && this.identifier.map(v => v.toJSON()),
            relatedIdentifier: this.relatedIdentifier && this.relatedIdentifier.map(v => v.toJSON()),
            dateAccessed: this.dateAccessed,
            version: this.version && this.version.toJSON(),
            currentState: this.currentState && this.currentState.map(v => v.toJSON()),
            statusDate: this.statusDate && this.statusDate.map(v => v.toJSON()),
            title: this.title && this.title.map(v => v.toJSON()),
            abstract: this.abstract && this.abstract.map(v => v.toJSON()),
            part: this.part && this.part.toJSON(),
            relatesTo: this.relatesTo && this.relatesTo.map(v => v.toJSON()),
            publicationForm: this.publicationForm && this.publicationForm.map(v => v.toJSON()),
            webLocation: this.webLocation && this.webLocation.map(v => v.toJSON()),
            classification: this.classification && this.classification.map(v => v.toJSON()),
            contributorship: this.contributorship && this.contributorship.toJSON(),
            note: this.note && this.note.map(v => v.toJSON())
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
            if (this.identifier) { await async.each(this.identifier, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.relatedIdentifier) { await async.each(this.relatedIdentifier, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.version) { await this.version.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.currentState) { await async.each(this.currentState, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.statusDate) { await async.each(this.statusDate, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.title) { await async.each(this.title, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.abstract) { await async.each(this.abstract, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.part) { await this.part.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.relatesTo) { await async.each(this.relatesTo, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.publicationForm) { await async.each(this.publicationForm, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.webLocation) { await async.each(this.webLocation, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.classification) { await async.each(this.classification, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.contributorship) { await this.contributorship.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.note) { await async.each(this.note, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            identifier: this.identifier && this.identifier.map(v => v.toJSONInternal()),
            relatedIdentifier: this.relatedIdentifier && this.relatedIdentifier.map(v => v.toJSONInternal()),
            dateAccessed: this.dateAccessed,
            version: this.version && this.version.toJSONInternal(),
            currentState: this.currentState && this.currentState.map(v => v.toJSONInternal()),
            statusDate: this.statusDate && this.statusDate.map(v => v.toJSONInternal()),
            title: this.title && this.title.map(v => v.toJSONInternal()),
            abstract: this.abstract && this.abstract.map(v => v.toJSONInternal()),
            part: this.part && this.part.toJSONInternal(),
            relatesTo: this.relatesTo && this.relatesTo.map(v => v.toJSONInternal()),
            publicationForm: this.publicationForm && this.publicationForm.map(v => v.toJSONInternal()),
            webLocation: this.webLocation && this.webLocation.map(v => v.toJSONInternal()),
            classification: this.classification && this.classification.map(v => v.toJSONInternal()),
            contributorship: this.contributorship && this.contributorship.toJSONInternal(),
            note: this.note && this.note.map(v => v.toJSONInternal())
        };

        return removeNull(json);
    }
}

module.exports = CitationCitedArtifact;
