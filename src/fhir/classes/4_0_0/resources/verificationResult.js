

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Resource = require('../resources/resource');
const async = require('async');

/**
VerificationResult
    Describes validation requirements, source(s), status and dates for one or more
    elements.
    If the element is present, it must have either a @value, an @id, or extensions
*/
class VerificationResult extends Resource {
    /**
     * @param {String|undefined} [id],
     * @param {Meta|undefined} [meta],
     * @param {uri|undefined} [implicitRules],
     * @param {code|undefined} [language],
     * @param {Narrative|undefined} [text],
     * @param {ResourceContainer[]|undefined} [contained],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Reference[]|undefined} [target],
     * @param {String[]|undefined} [targetLocation],
     * @param {CodeableConcept|undefined} [need],
     * @param {code} status,
     * @param {dateTime|undefined} [statusDate],
     * @param {CodeableConcept|undefined} [validationType],
     * @param {CodeableConcept[]|undefined} [validationProcess],
     * @param {Timing|undefined} [frequency],
     * @param {dateTime|undefined} [lastPerformed],
     * @param {date|undefined} [nextScheduled],
     * @param {CodeableConcept|undefined} [failureAction],
     * @param {VerificationResultPrimarySource[]|undefined} [primarySource],
     * @param {VerificationResultAttestation|undefined} [attestation],
     * @param {VerificationResultValidator[]|undefined} [validator],
     * @param {Object|undefined} [_access]
     * @param {string|undefined} [_sourceAssigningAuthority]
     * @param {string|undefined} [_uuid]
     * @param {string|undefined} [_sourceId]
    */
    constructor (
        {
            id,
            meta,
            implicitRules,
            language,
            text,
            contained,
            extension,
            modifierExtension,
            target,
            targetLocation,
            need,
            status,
            statusDate,
            validationType,
            validationProcess,
            frequency,
            lastPerformed,
            nextScheduled,
            failureAction,
            primarySource,
            attestation,
            validator,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId
        }
    ) {
        super({});

        // ---- Define getters and setters as enumerable ---

        /**
         * @description The logical id of the resource, as used in the URL for the resource. Once
    assigned, this value never changes.
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
         * @description The metadata about the resource. This is content that is maintained by the
    infrastructure. Changes to the content might not always be associated with
    version changes to the resource.
         * @property {Meta|undefined}
        */
        Object.defineProperty(this, 'meta', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.meta,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.meta = undefined;
                    return;
                }
                const Meta = require('../complex_types/meta.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.meta = FhirResourceCreator.create(valueProvided, Meta);
            }
        });

        /**
         * @description A reference to a set of rules that were followed when the resource was
    constructed, and which must be understood when processing the content. Often,
    this is a reference to an implementation guide that defines the special rules
    along with other profiles etc.
         * @property {uri|undefined}
        */
        Object.defineProperty(this, 'implicitRules', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.implicitRules,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.implicitRules = undefined;
                    return;
                }
                this.__data.implicitRules = valueProvided;
            }
        });

        /**
         * @description The base language in which the resource is written.
         * @property {code|undefined}
        */
        Object.defineProperty(this, 'language', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.language,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.language = undefined;
                    return;
                }
                this.__data.language = valueProvided;
            }
        });

        /**
         * @description A human-readable narrative that contains a summary of the resource and can be
    used to represent the content of the resource to a human. The narrative need
    not encode all the structured data, but is required to contain sufficient
    detail to make it "clinically safe" for a human to just read the narrative.
    Resource definitions may define what content should be represented in the
    narrative to ensure clinical safety.
         * @property {Narrative|undefined}
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
                const Narrative = require('../complex_types/narrative.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.text = FhirResourceCreator.create(valueProvided, Narrative);
            }
        });

        /**
         * @description These resources do not have an independent existence apart from the resource
    that contains them - they cannot be identified independently, and nor can they
    have their own independent transaction scope.
         * @property {ResourceContainer[]|undefined}
        */
        Object.defineProperty(this, 'contained', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.contained,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.contained = undefined;
                    return;
                }
                const ResourceContainer = require('../simple_types/resourceContainer.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.contained = FhirResourceCreator.createArray(valueProvided);
            }
        });

        /**
         * @description May be used to represent additional information that is not part of the basic
    definition of the resource. To make the use of extensions safe and manageable,
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
    definition of the resource and that modifies the understanding of the element
    that contains it and/or the understanding of the containing element's
    descendants. Usually modifier elements provide negation or qualification. To
    make the use of extensions safe and manageable, there is a strict set of
    governance applied to the definition and use of extensions. Though any
    implementer is allowed to define an extension, there is a set of requirements
    that SHALL be met as part of the definition of the extension. Applications
    processing a resource are required to check for modifier extensions.

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
         * @description A resource that was validated.
         * @property {Reference[]|undefined}
        */
        Object.defineProperty(this, 'target', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.target,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.target = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.target = FhirResourceCreator.createArray(valueProvided, Reference);
            }
        });

        /**
         * @description The fhirpath location(s) within the resource that was validated.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'targetLocation', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.targetLocation,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.targetLocation = undefined;
                    return;
                }
                this.__data.targetLocation = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description The frequency with which the target must be validated (none; initial;
    periodic).
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'need', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.need,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.need = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.need = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The validation status of the target (attested; validated; in process; requires
    revalidation; validation failed; revalidation failed).
         * @property {code}
        */
        Object.defineProperty(this, 'status', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.status,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.status = undefined;
                    return;
                }
                this.__data.status = valueProvided;
            }
        });

        /**
         * @description When the validation status was updated.
         * @property {dateTime|undefined}
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
                this.__data.statusDate = valueProvided;
            }
        });

        /**
         * @description What the target is validated against (nothing; primary source; multiple
    sources).
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'validationType', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.validationType,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.validationType = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.validationType = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The primary process by which the target is validated (edit check; value set;
    primary source; multiple sources; standalone; in context).
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'validationProcess', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.validationProcess,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.validationProcess = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.validationProcess = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Frequency of revalidation.
         * @property {Timing|undefined}
        */
        Object.defineProperty(this, 'frequency', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.frequency,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.frequency = undefined;
                    return;
                }
                const Timing = require('../backbone_elements/timing.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.frequency = FhirResourceCreator.create(valueProvided, Timing);
            }
        });

        /**
         * @description The date/time validation was last completed (including failed validations).
         * @property {dateTime|undefined}
        */
        Object.defineProperty(this, 'lastPerformed', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.lastPerformed,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.lastPerformed = undefined;
                    return;
                }
                this.__data.lastPerformed = valueProvided;
            }
        });

        /**
         * @description The date when target is next validated, if appropriate.
         * @property {date|undefined}
        */
        Object.defineProperty(this, 'nextScheduled', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.nextScheduled,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.nextScheduled = undefined;
                    return;
                }
                this.__data.nextScheduled = valueProvided;
            }
        });

        /**
         * @description The result if validation fails (fatal; warning; record only; none).
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'failureAction', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.failureAction,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.failureAction = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.failureAction = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Information about the primary source(s) involved in validation.
         * @property {VerificationResultPrimarySource[]|undefined}
        */
        Object.defineProperty(this, 'primarySource', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.primarySource,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.primarySource = undefined;
                    return;
                }
                const VerificationResultPrimarySource = require('../backbone_elements/verificationResultPrimarySource.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.primarySource = FhirResourceCreator.createArray(valueProvided, VerificationResultPrimarySource);
            }
        });

        /**
         * @description Information about the entity attesting to information.
         * @property {VerificationResultAttestation|undefined}
        */
        Object.defineProperty(this, 'attestation', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.attestation,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.attestation = undefined;
                    return;
                }
                const VerificationResultAttestation = require('../backbone_elements/verificationResultAttestation.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.attestation = FhirResourceCreator.create(valueProvided, VerificationResultAttestation);
            }
        });

        /**
         * @description Information about the entity validating information.
         * @property {VerificationResultValidator[]|undefined}
        */
        Object.defineProperty(this, 'validator', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.validator,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.validator = undefined;
                    return;
                }
                const VerificationResultValidator = require('../backbone_elements/verificationResultValidator.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.validator = FhirResourceCreator.createArray(valueProvided, VerificationResultValidator);
            }
        });

        /**
         * @description _access
         * @property {Object|undefined}
         */
        Object.defineProperty(this, '_access', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._access,
            set: valueProvided => {
                this.__data._access = valueProvided;
            }
        });
        /**
         * @description _sourceAssigningAuthority
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_sourceAssigningAuthority', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._sourceAssigningAuthority,
            set: valueProvided => {
                this.__data._sourceAssigningAuthority = valueProvided;
            }
        });
        /**
         * @description _uuid
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_uuid', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._uuid,
            set: valueProvided => {
                this.__data._uuid = valueProvided;
            }
        });
        /**
         * @description _sourceId
         * @property {string|undefined}
         */
        Object.defineProperty(this, '_sourceId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data._sourceId,
            set: valueProvided => {
                this.__data._sourceId = valueProvided;
            }
        });

        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            meta,
            implicitRules,
            language,
            text,
            contained,
            extension,
            modifierExtension,
            target,
            targetLocation,
            need,
            status,
            statusDate,
            validationType,
            validationProcess,
            frequency,
            lastPerformed,
            nextScheduled,
            failureAction,
            primarySource,
            attestation,
            validator,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId
        });

        /**
         * @description Define a default non-writable resourceType property
         * @property {string|undefined}
         */
        Object.defineProperty(this, 'resourceType', {
            value: 'VerificationResult',
            enumerable: true,
            writable: false,
            configurable: true
        });
    }

    /**
     * @description Define a default non-writable resourceType property
     * @property {string|undefined}
     */
    static get resourceType () {
        return 'VerificationResult';
    }

    /**
     * @description Creates a blank new resource
     * @param {String|undefined} [id],
     * @param {Meta|undefined} [meta],
     * @param {uri|undefined} [implicitRules],
     * @param {code|undefined} [language],
     * @param {Narrative|undefined} [text],
     * @param {ResourceContainer[]|undefined} [contained],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Reference[]|undefined} [target],
     * @param {String[]|undefined} [targetLocation],
     * @param {CodeableConcept|undefined} [need],
     * @param {code} status,
     * @param {dateTime|undefined} [statusDate],
     * @param {CodeableConcept|undefined} [validationType],
     * @param {CodeableConcept[]|undefined} [validationProcess],
     * @param {Timing|undefined} [frequency],
     * @param {dateTime|undefined} [lastPerformed],
     * @param {date|undefined} [nextScheduled],
     * @param {CodeableConcept|undefined} [failureAction],
     * @param {VerificationResultPrimarySource[]|undefined} [primarySource],
     * @param {VerificationResultAttestation|undefined} [attestation],
     * @param {VerificationResultValidator[]|undefined} [validator],
     * @param {Object|undefined} [_access]
     * @param {string|undefined} [_sourceAssigningAuthority]
     * @param {string|undefined} [_uuid]
     * @param {string|undefined} [_sourceId]
     * @returns {VerificationResult}
    */
    create (
            {
            id,
            meta,
            implicitRules,
            language,
            text,
            contained,
            extension,
            modifierExtension,
            target,
            targetLocation,
            need,
            status,
            statusDate,
            validationType,
            validationProcess,
            frequency,
            lastPerformed,
            nextScheduled,
            failureAction,
            primarySource,
            attestation,
            validator,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId
        }
    ) {
        return new VerificationResult({
            id,
            meta,
            implicitRules,
            language,
            text,
            contained,
            extension,
            modifierExtension,
            target,
            targetLocation,
            need,
            status,
            statusDate,
            validationType,
            validationProcess,
            frequency,
            lastPerformed,
            nextScheduled,
            failureAction,
            primarySource,
            attestation,
            validator,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId
        });
    }

    /**
     * @description creates a copy of this resource
     * @returns {VerificationResult}
    */
    clone () {
        return new VerificationResult(this.toJSONInternal());
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSON () {
        return removeNull({
            resourceType: this.resourceType,
            id: this.id,
            meta: this.meta && this.meta.toJSON(),
            implicitRules: this.implicitRules,
            language: this.language,
            text: this.text && this.text.toJSON(),
            contained: this.contained && this.contained.map(v => v.toJSON()),
            extension: this.extension && this.extension.map(v => v.toJSON()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSON()),
            target: this.target && this.target.map(v => v.toJSON()),
            targetLocation: this.targetLocation,
            need: this.need && this.need.toJSON(),
            status: this.status,
            statusDate: this.statusDate,
            validationType: this.validationType && this.validationType.toJSON(),
            validationProcess: this.validationProcess && this.validationProcess.map(v => v.toJSON()),
            frequency: this.frequency && this.frequency.toJSON(),
            lastPerformed: this.lastPerformed,
            nextScheduled: this.nextScheduled,
            failureAction: this.failureAction && this.failureAction.toJSON(),
            primarySource: this.primarySource && this.primarySource.map(v => v.toJSON()),
            attestation: this.attestation && this.attestation.toJSON(),
            validator: this.validator && this.validator.map(v => v.toJSON())
        });
    }

    /**
     * Returns JSON representation of entity
     * @param {function(Reference): Promise<Reference>} fnUpdateReferenceAsync
     * @return {void}
     */
    async updateReferencesAsync ({ fnUpdateReferenceAsync }) {
            if (this.meta) { await this.meta.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.text) { await this.text.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.contained) { await async.each(this.contained, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.extension) { await async.each(this.extension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.modifierExtension) { await async.each(this.modifierExtension, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.target) { await async.each(this.target, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.need) { await this.need.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.validationType) { await this.validationType.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.validationProcess) { await async.each(this.validationProcess, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.frequency) { await this.frequency.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.failureAction) { await this.failureAction.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.primarySource) { await async.each(this.primarySource, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.attestation) { await this.attestation.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.validator) { await async.each(this.validator, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
    }

    /**
     * Returns JSON representation of entity
     * @return {Object}
     */
    toJSONInternal () {
        const json = {
            resourceType: this.resourceType,
            id: this.id,
            meta: this.meta && this.meta.toJSONInternal(),
            implicitRules: this.implicitRules,
            language: this.language,
            text: this.text && this.text.toJSONInternal(),
            contained: this.contained && this.contained.map(v => v.toJSONInternal()),
            extension: this.extension && this.extension.map(v => v.toJSONInternal()),
            modifierExtension: this.modifierExtension && this.modifierExtension.map(v => v.toJSONInternal()),
            target: this.target && this.target.map(v => v.toJSONInternal()),
            targetLocation: this.targetLocation,
            need: this.need && this.need.toJSONInternal(),
            status: this.status,
            statusDate: this.statusDate,
            validationType: this.validationType && this.validationType.toJSONInternal(),
            validationProcess: this.validationProcess && this.validationProcess.map(v => v.toJSONInternal()),
            frequency: this.frequency && this.frequency.toJSONInternal(),
            lastPerformed: this.lastPerformed,
            nextScheduled: this.nextScheduled,
            failureAction: this.failureAction && this.failureAction.toJSONInternal(),
            primarySource: this.primarySource && this.primarySource.map(v => v.toJSONInternal()),
            attestation: this.attestation && this.attestation.toJSONInternal(),
            validator: this.validator && this.validator.map(v => v.toJSONInternal())
        };
        if (this._access) {
            json._access = this._access;
        }
        if (this._sourceAssigningAuthority) {
            json._sourceAssigningAuthority = this._sourceAssigningAuthority;
        }
        if (this._uuid) {
            json._uuid = this._uuid;
        }
        if (this._sourceId) {
            json._sourceId = this._sourceId;
        }

        return removeNull(json);
    }
}

module.exports = VerificationResult;
