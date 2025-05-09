

// This file is auto-generated by generate_classes so do not edit manually

const { removeNull } = require('../../../../utils/nullRemover');

const Resource = require('../resources/resource');
const async = require('async');

/**
Invoice
    Invoice containing collected ChargeItems from an Account with calculated
    individual and total price for Billing purpose.
    If the element is present, it must have either a @value, an @id, or extensions
*/
class Invoice extends Resource {
    /**
     * @param {String|undefined} [id],
     * @param {Meta|undefined} [meta],
     * @param {uri|undefined} [implicitRules],
     * @param {code|undefined} [language],
     * @param {Narrative|undefined} [text],
     * @param {ResourceContainer[]|undefined} [contained],
     * @param {Extension[]|undefined} [extension],
     * @param {Extension[]|undefined} [modifierExtension],
     * @param {Identifier[]|undefined} [identifier],
     * @param {code} status,
     * @param {String|undefined} [cancelledReason],
     * @param {CodeableConcept|undefined} [type],
     * @param {Reference|undefined} [subject],
     * @param {Reference|undefined} [recipient],
     * @param {dateTime|undefined} [date],
     * @param {InvoiceParticipant[]|undefined} [participant],
     * @param {Reference|undefined} [issuer],
     * @param {Reference|undefined} [account],
     * @param {InvoiceLineItem[]|undefined} [lineItem],
     * @param {InvoicePriceComponent[]|undefined} [totalPriceComponent],
     * @param {Money|undefined} [totalNet],
     * @param {Money|undefined} [totalGross],
     * @param {markdown|undefined} [paymentTerms],
     * @param {Annotation[]|undefined} [note],
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
            identifier,
            status,
            cancelledReason,
            type,
            subject,
            recipient,
            date,
            participant,
            issuer,
            account,
            lineItem,
            totalPriceComponent,
            totalNet,
            totalGross,
            paymentTerms,
            note,
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
         * @description Identifier of this Invoice, often used for reference in correspondence about
    this invoice or for tracking of payments.
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
         * @description The current state of the Invoice.
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
         * @description In case of Invoice cancellation a reason must be given (entered in error,
    superseded by corrected invoice etc.).
         * @property {String|undefined}
        */
        Object.defineProperty(this, 'cancelledReason', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.cancelledReason,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.cancelledReason = undefined;
                    return;
                }
                this.__data.cancelledReason = valueProvided;
            }
        });

        /**
         * @description Type of Invoice depending on domain, realm an usage (e.g. internal/external,
    dental, preliminary).
         * @property {CodeableConcept|undefined}
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
         * @description The individual or set of individuals receiving the goods and services billed
    in this invoice.
         * @property {Reference|undefined}
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
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.subject = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description The individual or Organization responsible for balancing of this invoice.
         * @property {Reference|undefined}
        */
        Object.defineProperty(this, 'recipient', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.recipient,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.recipient = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.recipient = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description Date/time(s) of when this Invoice was posted.
         * @property {dateTime|undefined}
        */
        Object.defineProperty(this, 'date', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.date,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.date = undefined;
                    return;
                }
                this.__data.date = valueProvided;
            }
        });

        /**
         * @description Indicates who or what performed or participated in the charged service.
         * @property {InvoiceParticipant[]|undefined}
        */
        Object.defineProperty(this, 'participant', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.participant,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.participant = undefined;
                    return;
                }
                const InvoiceParticipant = require('../backbone_elements/invoiceParticipant.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.participant = FhirResourceCreator.createArray(valueProvided, InvoiceParticipant);
            }
        });

        /**
         * @description The organizationissuing the Invoice.
         * @property {Reference|undefined}
        */
        Object.defineProperty(this, 'issuer', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.issuer,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.issuer = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.issuer = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description Account which is supposed to be balanced with this Invoice.
         * @property {Reference|undefined}
        */
        Object.defineProperty(this, 'account', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.account,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.account = undefined;
                    return;
                }
                const Reference = require('../complex_types/reference.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.account = FhirResourceCreator.create(valueProvided, Reference);
            }
        });

        /**
         * @description Each line item represents one charge for goods and services rendered. Details
    such as date, code and amount are found in the referenced ChargeItem resource.
         * @property {InvoiceLineItem[]|undefined}
        */
        Object.defineProperty(this, 'lineItem', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.lineItem,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.lineItem = undefined;
                    return;
                }
                const InvoiceLineItem = require('../backbone_elements/invoiceLineItem.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.lineItem = FhirResourceCreator.createArray(valueProvided, InvoiceLineItem);
            }
        });

        /**
         * @description The total amount for the Invoice may be calculated as the sum of the line
    items with surcharges/deductions that apply in certain conditions.  The
    priceComponent element can be used to offer transparency to the recipient of
    the Invoice of how the total price was calculated.
         * @property {InvoicePriceComponent[]|undefined}
        */
        Object.defineProperty(this, 'totalPriceComponent', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.totalPriceComponent,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.totalPriceComponent = undefined;
                    return;
                }
                const InvoicePriceComponent = require('../backbone_elements/invoicePriceComponent.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.totalPriceComponent = FhirResourceCreator.createArray(valueProvided, InvoicePriceComponent);
            }
        });

        /**
         * @description Invoice total , taxes excluded.
         * @property {Money|undefined}
        */
        Object.defineProperty(this, 'totalNet', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.totalNet,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.totalNet = undefined;
                    return;
                }
                const Money = require('../complex_types/money.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.totalNet = FhirResourceCreator.create(valueProvided, Money);
            }
        });

        /**
         * @description Invoice total, tax included.
         * @property {Money|undefined}
        */
        Object.defineProperty(this, 'totalGross', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.totalGross,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.totalGross = undefined;
                    return;
                }
                const Money = require('../complex_types/money.js');
                const { FhirResourceCreator } = require('../../../fhirResourceCreator');
                this.__data.totalGross = FhirResourceCreator.create(valueProvided, Money);
            }
        });

        /**
         * @description Payment details such as banking details, period of payment, deductibles,
    methods of payment.
         * @property {markdown|undefined}
        */
        Object.defineProperty(this, 'paymentTerms', {
            // https://www.w3schools.com/js/js_object_es5.asp
            enumerable: true,
            configurable: true,
            get: () => this.__data.paymentTerms,
            set: valueProvided => {
                if (valueProvided === undefined || valueProvided === null || (Array.isArray(valueProvided) && valueProvided.length === 0)) {
                    this.__data.paymentTerms = undefined;
                    return;
                }
                this.__data.paymentTerms = valueProvided;
            }
        });

        /**
         * @description Comments made about the invoice by the issuer, subject, or other participants.
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
            identifier,
            status,
            cancelledReason,
            type,
            subject,
            recipient,
            date,
            participant,
            issuer,
            account,
            lineItem,
            totalPriceComponent,
            totalNet,
            totalGross,
            paymentTerms,
            note,
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
            value: 'Invoice',
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
        return 'Invoice';
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
     * @param {Identifier[]|undefined} [identifier],
     * @param {code} status,
     * @param {String|undefined} [cancelledReason],
     * @param {CodeableConcept|undefined} [type],
     * @param {Reference|undefined} [subject],
     * @param {Reference|undefined} [recipient],
     * @param {dateTime|undefined} [date],
     * @param {InvoiceParticipant[]|undefined} [participant],
     * @param {Reference|undefined} [issuer],
     * @param {Reference|undefined} [account],
     * @param {InvoiceLineItem[]|undefined} [lineItem],
     * @param {InvoicePriceComponent[]|undefined} [totalPriceComponent],
     * @param {Money|undefined} [totalNet],
     * @param {Money|undefined} [totalGross],
     * @param {markdown|undefined} [paymentTerms],
     * @param {Annotation[]|undefined} [note],
     * @param {Object|undefined} [_access]
     * @param {string|undefined} [_sourceAssigningAuthority]
     * @param {string|undefined} [_uuid]
     * @param {string|undefined} [_sourceId]
     * @returns {Invoice}
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
            identifier,
            status,
            cancelledReason,
            type,
            subject,
            recipient,
            date,
            participant,
            issuer,
            account,
            lineItem,
            totalPriceComponent,
            totalNet,
            totalGross,
            paymentTerms,
            note,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId
        }
    ) {
        return new Invoice({
            id,
            meta,
            implicitRules,
            language,
            text,
            contained,
            extension,
            modifierExtension,
            identifier,
            status,
            cancelledReason,
            type,
            subject,
            recipient,
            date,
            participant,
            issuer,
            account,
            lineItem,
            totalPriceComponent,
            totalNet,
            totalGross,
            paymentTerms,
            note,
            _access,
            _sourceAssigningAuthority,
            _uuid,
            _sourceId
        });
    }

    /**
     * @description creates a copy of this resource
     * @returns {Invoice}
    */
    clone () {
        return new Invoice(this.toJSONInternal());
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
            identifier: this.identifier && this.identifier.map(v => v.toJSON()),
            status: this.status,
            cancelledReason: this.cancelledReason,
            type: this.type && this.type.toJSON(),
            subject: this.subject && this.subject.toJSON(),
            recipient: this.recipient && this.recipient.toJSON(),
            date: this.date,
            participant: this.participant && this.participant.map(v => v.toJSON()),
            issuer: this.issuer && this.issuer.toJSON(),
            account: this.account && this.account.toJSON(),
            lineItem: this.lineItem && this.lineItem.map(v => v.toJSON()),
            totalPriceComponent: this.totalPriceComponent && this.totalPriceComponent.map(v => v.toJSON()),
            totalNet: this.totalNet && this.totalNet.toJSON(),
            totalGross: this.totalGross && this.totalGross.toJSON(),
            paymentTerms: this.paymentTerms,
            note: this.note && this.note.map(v => v.toJSON())
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
            if (this.identifier) { await async.each(this.identifier, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.type) { await this.type.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.subject) { await this.subject.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.recipient) { await this.recipient.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.participant) { await async.each(this.participant, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.issuer) { await this.issuer.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.account) { await this.account.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.lineItem) { await async.each(this.lineItem, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.totalPriceComponent) { await async.each(this.totalPriceComponent, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
            if (this.totalNet) { await this.totalNet.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.totalGross) { await this.totalGross.updateReferencesAsync({ fnUpdateReferenceAsync }); }
            if (this.note) { await async.each(this.note, async v => await v.updateReferencesAsync({ fnUpdateReferenceAsync })); }
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
            identifier: this.identifier && this.identifier.map(v => v.toJSONInternal()),
            status: this.status,
            cancelledReason: this.cancelledReason,
            type: this.type && this.type.toJSONInternal(),
            subject: this.subject && this.subject.toJSONInternal(),
            recipient: this.recipient && this.recipient.toJSONInternal(),
            date: this.date,
            participant: this.participant && this.participant.map(v => v.toJSONInternal()),
            issuer: this.issuer && this.issuer.toJSONInternal(),
            account: this.account && this.account.toJSONInternal(),
            lineItem: this.lineItem && this.lineItem.map(v => v.toJSONInternal()),
            totalPriceComponent: this.totalPriceComponent && this.totalPriceComponent.map(v => v.toJSONInternal()),
            totalNet: this.totalNet && this.totalNet.toJSONInternal(),
            totalGross: this.totalGross && this.totalGross.toJSONInternal(),
            paymentTerms: this.paymentTerms,
            note: this.note && this.note.map(v => v.toJSONInternal())
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

module.exports = Invoice;
