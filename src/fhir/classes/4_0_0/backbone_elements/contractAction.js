

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Element = require('../complex_types/element');
const Resource = require('../resources/resource');
const async = require('async');

/**
Contract.Action
    Legally enforceable, formally recorded unilateral or bilateral directive i.e.,
    a policy or agreement.
*/
class ContractAction extends Element {
    /**
     * @param {String|undefined} [id],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Boolean|undefined} [doNotPerform],
     * @param {CodeableConcept} type,
     * @param {ContractSubject[]|undefined} [subject],
     * @param {CodeableConcept} intent,
     * @param {String[]|undefined} [linkId],
     * @param {CodeableConcept} status,
     * @param {Reference|undefined} [context],
     * @param {String[]|undefined} [contextLinkId],
     * @param {dateTime|undefined} [occurrenceDateTime],
     * @param {Period|undefined} [occurrencePeriod],
     * @param {Timing|undefined} [occurrenceTiming],
     * @param {Reference[]|undefined} [requester],
     * @param {String[]|undefined} [requesterLinkId],
     * @param {CodeableConcept[]|undefined} [performerType],
     * @param {CodeableConcept|undefined} [performerRole],
     * @param {Reference|undefined} [performer],
     * @param {String[]|undefined} [performerLinkId],
     * @param {CodeableConcept[]|undefined} [reasonCode],
     * @param {Reference[]|undefined} [reasonReference],
     * @param {String[]|undefined} [reason],
     * @param {String[]|undefined} [reasonLinkId],
     * @param {Annotation[]|undefined} [note],
     * @param {unsignedInt[]|undefined} [securityLabelNumber],
    */
    constructor (
        {
            id,
            extension,
            modifierExtension,
            doNotPerform,
            type,
            subject,
            intent,
            linkId,
            status,
            context,
            contextLinkId,
            occurrenceDateTime,
            occurrencePeriod,
            occurrenceTiming,
            requester,
            requesterLinkId,
            performerType,
            performerRole,
            performer,
            performerLinkId,
            reasonCode,
            reasonReference,
            reason,
            reasonLinkId,
            note,
            securityLabelNumber
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
         * @description True if the term prohibits the  action.
         * @property {Boolean|undefined}
        */
        Object.defineProperty(this, 'doNotPerform', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.doNotPerform,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.doNotPerform = undefined;
                    return;
                }
                this.__data.doNotPerform = valueProvided;
            }
        });

        /**
         * @description Activity or service obligation to be done or not done, performed or not
    performed, effectuated or not by this Contract term.
         * @property {CodeableConcept}
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
         * @description Entity of the action.
         * @property {ContractSubject[]|undefined}
        */
        Object.defineProperty(this, 'subject', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.subject,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.subject = undefined;
                    return;
                }
                const ContractSubject = require('../backbone_elements/contractSubject.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.subject = FhirResourceCreator.createArray(valueProvided, ContractSubject);
            }
        });

        /**
         * @description Reason or purpose for the action stipulated by this Contract Provision.
         * @property {CodeableConcept}
        */
        Object.defineProperty(this, 'intent', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.intent,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.intent = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.intent = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Id [identifier??] of the clause or question text related to this action in the
    referenced form or QuestionnaireResponse.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'linkId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.linkId,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.linkId = undefined;
                    return;
                }
                this.__data.linkId = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description Current state of the term action.
         * @property {CodeableConcept}
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
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.status = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Encounter or Episode with primary association to specified term activity.
         * @property {Reference|undefined}
        */
        Object.defineProperty(this, 'context', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.context,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.context = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.context = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description Id [identifier??] of the clause or question text related to the requester of
    this action in the referenced form or QuestionnaireResponse.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'contextLinkId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.contextLinkId,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.contextLinkId = undefined;
                    return;
                }
                this.__data.contextLinkId = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description None
         * @property {dateTime|undefined}
        */
        Object.defineProperty(this, 'occurrenceDateTime', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.occurrenceDateTime,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.occurrenceDateTime = undefined;
                    return;
                }
                this.__data.occurrenceDateTime = valueProvided;
            }
        });

        /**
         * @description None
         * @property {Period|undefined}
        */
        Object.defineProperty(this, 'occurrencePeriod', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.occurrencePeriod,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.occurrencePeriod = undefined;
                    return;
                }
                const Period = require('../complex_types/period.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.occurrencePeriod = FhirResourceCreator.create(valueProvided, Period);
            }
        });

        /**
         * @description None
         * @property {Timing|undefined}
        */
        Object.defineProperty(this, 'occurrenceTiming', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.occurrenceTiming,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.occurrenceTiming = undefined;
                    return;
                }
                const Timing = require('../backbone_elements/timing.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.occurrenceTiming = FhirResourceCreator.create(valueProvided, Timing);
            }
        });

        /**
         * @description Who or what initiated the action and has responsibility for its activation.
         * @property {Reference[]|undefined}
        */
        Object.defineProperty(this, 'requester', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.requester,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.requester = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.requester = FhirResourceCreator.createArray(valueProvided, Reference);
            }
        });

        /**
         * @description Id [identifier??] of the clause or question text related to the requester of
    this action in the referenced form or QuestionnaireResponse.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'requesterLinkId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.requesterLinkId,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.requesterLinkId = undefined;
                    return;
                }
                this.__data.requesterLinkId = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description The type of individual that is desired or required to perform or not perform
    the action.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'performerType', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.performerType,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.performerType = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.performerType = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description The type of role or competency of an individual desired or required to perform
    or not perform the action.
         * @property {CodeableConcept|undefined}
        */
        Object.defineProperty(this, 'performerRole', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.performerRole,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.performerRole = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.performerRole = FhirResourceCreator.create(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Indicates who or what is being asked to perform (or not perform) the ction.
         * @property {Reference|undefined}
        */
        Object.defineProperty(this, 'performer', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.performer,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.performer = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.performer = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description Id [identifier??] of the clause or question text related to the reason type or
    reference of this  action in the referenced form or QuestionnaireResponse.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'performerLinkId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.performerLinkId,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.performerLinkId = undefined;
                    return;
                }
                this.__data.performerLinkId = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description Rationale for the action to be performed or not performed. Describes why the
    action is permitted or prohibited.
         * @property {CodeableConcept[]|undefined}
        */
        Object.defineProperty(this, 'reasonCode', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.reasonCode,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.reasonCode = undefined;
                    return;
                }
                const CodeableConcept = require('../complex_types/codeableConcept.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.reasonCode = FhirResourceCreator.createArray(valueProvided, CodeableConcept);
            }
        });

        /**
         * @description Indicates another resource whose existence justifies permitting or not
    permitting this action.
         * @property {Reference[]|undefined}
        */
        Object.defineProperty(this, 'reasonReference', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.reasonReference,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.reasonReference = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.reasonReference = FhirResourceCreator.createArray(valueProvided, Reference);
            }
        });

        /**
         * @description Describes why the action is to be performed or not performed in textual form.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'reason', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.reason,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.reason = undefined;
                    return;
                }
                this.__data.reason = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description Id [identifier??] of the clause or question text related to the reason type or
    reference of this  action in the referenced form or QuestionnaireResponse.
         * @property {String[]|undefined}
        */
        Object.defineProperty(this, 'reasonLinkId', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.reasonLinkId,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.reasonLinkId = undefined;
                    return;
                }
                this.__data.reasonLinkId = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });

        /**
         * @description Comments made about the term action made by the requester, performer, subject
    or other participants.
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

        /**
         * @description Security labels that protects the action.
         * @property {unsignedInt[]|undefined}
        */
        Object.defineProperty(this, 'securityLabelNumber', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.securityLabelNumber,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.securityLabelNumber = undefined;
                    return;
                }
                this.__data.securityLabelNumber = Array.isArray(valueProvided) ? valueProvided.filter(v => v).map(v => v) : [valueProvided];
            }
        });


        // --- Now copy properties from passed in object ----
        Object.assign(this, {
            id,
            extension,
            modifierExtension,
            doNotPerform,
            type,
            subject,
            intent,
            linkId,
            status,
            context,
            contextLinkId,
            occurrenceDateTime,
            occurrencePeriod,
            occurrenceTiming,
            requester,
            requesterLinkId,
            performerType,
            performerRole,
            performer,
            performerLinkId,
            reasonCode,
            reasonReference,
            reason,
            reasonLinkId,
            note,
            securityLabelNumber
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
            doNotPerform: this.doNotPerform,
            type: this.type && this.type.toJSON(),
            subject: this.subject && this.subject.map(v => v.toJSON()),
            intent: this.intent && this.intent.toJSON(),
            linkId: this.linkId,
            status: this.status && this.status.toJSON(),
            context: this.context && this.context.toJSON(),
            contextLinkId: this.contextLinkId,
            occurrenceDateTime: this.occurrenceDateTime,
            occurrencePeriod: this.occurrencePeriod && this.occurrencePeriod.toJSON(),
            occurrenceTiming: this.occurrenceTiming && this.occurrenceTiming.toJSON(),
            requester: this.requester && this.requester.map(v => v.toJSON()),
            requesterLinkId: this.requesterLinkId,
            performerType: this.performerType && this.performerType.map(v => v.toJSON()),
            performerRole: this.performerRole && this.performerRole.toJSON(),
            performer: this.performer && this.performer.toJSON(),
            performerLinkId: this.performerLinkId,
            reasonCode: this.reasonCode && this.reasonCode.map(v => v.toJSON()),
            reasonReference: this.reasonReference && this.reasonReference.map(v => v.toJSON()),
            reason: this.reason,
            reasonLinkId: this.reasonLinkId,
            note: this.note && this.note.map(v => v.toJSON()),
            securityLabelNumber: this.securityLabelNumber
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
            if (this.subject) { await async.each(this.subject, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.intent) { await this.intent.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.status) { await this.status.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.context) { await this.context.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.occurrencePeriod) { await this.occurrencePeriod.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.occurrenceTiming) { await this.occurrenceTiming.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.requester) { await async.each(this.requester, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.performerType) { await async.each(this.performerType, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.performerRole) { await this.performerRole.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.performer) { await this.performer.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.reasonCode) { await async.each(this.reasonCode, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.reasonReference) { await async.each(this.reasonReference, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            doNotPerform: this.doNotPerform,
            type: this.type && this.type.toJSONInternal(),
            subject: this.subject && this.subject.map(v => v.toJSONInternal()),
            intent: this.intent && this.intent.toJSONInternal(),
            linkId: this.linkId,
            status: this.status && this.status.toJSONInternal(),
            context: this.context && this.context.toJSONInternal(),
            contextLinkId: this.contextLinkId,
            occurrenceDateTime: this.occurrenceDateTime,
            occurrencePeriod: this.occurrencePeriod && this.occurrencePeriod.toJSONInternal(),
            occurrenceTiming: this.occurrenceTiming && this.occurrenceTiming.toJSONInternal(),
            requester: this.requester && this.requester.map(v => v.toJSONInternal()),
            requesterLinkId: this.requesterLinkId,
            performerType: this.performerType && this.performerType.map(v => v.toJSONInternal()),
            performerRole: this.performerRole && this.performerRole.toJSONInternal(),
            performer: this.performer && this.performer.toJSONInternal(),
            performerLinkId: this.performerLinkId,
            reasonCode: this.reasonCode && this.reasonCode.map(v => v.toJSONInternal()),
            reasonReference: this.reasonReference && this.reasonReference.map(v => v.toJSONInternal()),
            reason: this.reason,
            reasonLinkId: this.reasonLinkId,
            note: this.note && this.note.map(v => v.toJSONInternal()),
            securityLabelNumber: this.securityLabelNumber
        };

        return removeNull(json);
    }
}

module.exports = ContractAction;
