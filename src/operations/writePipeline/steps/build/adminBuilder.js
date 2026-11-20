const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ResourceValidator } = require('../../../common/resourceValidator');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { BadRequestError } = require('../../../../utils/httpErrors');
const { generateUUID } = require('../../../../utils/uid.util');
const { GRIDFS: { RETRIEVE }, BLOB_OP } = require('../../../../constants');
const { InsertBuilder } = require('./insertBuilder');
const { SmartMergeBuilder } = require('./smartMergeBuilder');
const { ReplaceBuilder } = require('./replaceBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The resource types whose patient reference an admin write never rewrites, whatever the patient
 * field mapping says. A Person's links are changed only through the link changes.
 */
const NON_REWRITABLE_RESOURCE_TYPES = new Set(['Person']);

/**
 * The suffix of a patient field mapping that names a reference.
 */
const REFERENCE_SUFFIX = '.reference';

/**
 * The builder for the `buildDocument` step of an admin write, per item. It reads the item's
 * `adminChange`, builds the document the change asks for as the item's body, and has the
 * composed builder for that kind of write build it: a new Person by the insert builder, a link
 * added to a stored resource by the smart merge builder, and a link removed or a patient
 * reference rewritten by the replace builder. A change that is already in place is a no-op, and
 * so is a patient reference rewrite on a resource with no single patient reference that can be
 * rewritten (a Person, a type with no patient reference field, or a field that is missing or a
 * list): nothing is built or written for it.
 *
 * The body of a link removal or a patient reference rewrite is built from a copy of the stored
 * document with its GridFS attachments and its base64 data kept in cloud storage read back in, as
 * PATCH does, because the replace builder treats data the body leaves out as removed. The builder
 * itself never writes `item.stored`; the composed builders may (the smart merge builder replaces it
 * with its pre-saved copy).
 *
 * Before a build it sets the request method the history entry records, as the old admin writer
 * does: `POST` for the new Person and `PATCH` for a change to a stored resource. A no-op leaves the
 * method alone. The request info is the admin write runner's own copy for this one write, the
 * instance the bulk inserter writes the history from, so nothing shared is changed. The method is
 * set once per context, so it is right only while an admin run has exactly one item, as it does.
 */
class AdminBuilder {
    /**
     * Keeps the composed builders, the patient field mapping, the GridFS and base64 managers
     * that read the stored data back in and the validator that checks a new Person's meta, checks
     * that each has the expected type, and maps each change kind to the method that builds it.
     * @param {InsertBuilder} insertBuilder
     * @param {SmartMergeBuilder} smartMergeBuilder
     * @param {ReplaceBuilder} replaceBuilder
     * @param {PatientFilterManager} patientFilterManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {ResourceValidator} resourceValidator
     */
    constructor ({
        insertBuilder,
        smartMergeBuilder,
        replaceBuilder,
        patientFilterManager,
        databaseAttachmentManager,
        base64DataManager,
        resourceValidator
    }) {
        /**
         * @type {InsertBuilder}
         */
        this.insertBuilder = insertBuilder;
        assertTypeEquals(insertBuilder, InsertBuilder);
        /**
         * @type {SmartMergeBuilder}
         */
        this.smartMergeBuilder = smartMergeBuilder;
        assertTypeEquals(smartMergeBuilder, SmartMergeBuilder);
        /**
         * @type {ReplaceBuilder}
         */
        this.replaceBuilder = replaceBuilder;
        assertTypeEquals(replaceBuilder, ReplaceBuilder);
        /**
         * @type {PatientFilterManager}
         */
        this.patientFilterManager = patientFilterManager;
        assertTypeEquals(patientFilterManager, PatientFilterManager);
        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
        /**
         * @type {Map<string, function(Object): Promise<WriteFailure|null>>}
         */
        this.changeBuilders = new Map([
            ['addLink', (args) => this._buildAddLinkAsync(args)],
            ['removeLink', (args) => this._buildRemoveLinkAsync(args)],
            ['rewritePatientReference', (args) => this._buildRewritePatientReferenceAsync(args)]
        ]);
    }

    /**
     * Builds the item's new document for its change and sets `candidate` and `writeMode`, as the
     * composed builder does, or sets `candidate` to null and `writeMode` to 'update' when the
     * change is a no-op. Returns the composed builder's failure, a `BUILD` failure carrying a
     * `BadRequestError` for an unknown change kind, or null.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async buildAsync ({ item, context }) {
        const kind = item.adminChange.kind;
        const buildChangeAsync = this.changeBuilders.get(kind);
        if (!buildChangeAsync) {
            return this._badRequestFailure({ item, message: `Unsupported admin change: ${kind}` });
        }
        return await buildChangeAsync({ item, context });
    }

    /**
     * Adds a link to the change's `linkTarget`. With no stored target it creates a new Person
     * linked to the loaded Patient. With a stored target it is a no-op when a link already points
     * at the loaded link target's `_uuid`; else it appends a link `<Type>/<loaded _uuid>` to a copy
     * of the stored document, so the link is the same whichever id the caller sent, and has the
     * smart merge builder build it. The link target is always loaded; with none loaded it returns
     * the failure of `_missingLinkTargetFailure` and builds nothing.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async _buildAddLinkAsync ({ item, context }) {
        if (item.linked.length === 0) {
            return this._missingLinkTargetFailure(item);
        }
        if (!item.stored) {
            return await this._buildNewPersonAsync({ item, context });
        }
        const reference = this._linkedReference(item);
        const document = deepcopy(item.stored);
        const links = document.link || [];
        if (links.some((link) => this._pointsTo({ referenceObject: link.target, reference }))) {
            return this._noChange(item);
        }
        document.link = [...links, { target: { reference } }];
        item.incoming = FhirResourceWriteSerializer.serialize({ obj: document });
        this._setRequestMethod({ context, method: 'PATCH' });
        return await this.smartMergeBuilder.buildAsync({ item, context });
    }

    /**
     * Builds a new Person as the item's body, as the old admin path does: a generated uuid as its
     * `id` and `_uuid`, a generated `meta.id`, the loaded Patient's `meta.source` and a copy of its
     * `meta.security`, and one link to the Patient by its `_uuid`. Checks its meta with the
     * validator's meta check (meta.source when required, one owner tag, no empty security system or
     * code), because the admin profiles turn off the step that checks a new resource's meta, and
     * returns a `BUILD` failure carrying the check's OperationOutcome (a 400) when it fails, with
     * nothing built. Otherwise has the insert builder build it.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async _buildNewPersonAsync ({ item, context }) {
        const [{ resourceType, resource: patient }] = item.linked;
        const personId = generateUUID();
        const person = {
            resourceType: 'Person',
            id: personId,
            _uuid: personId,
            meta: {
                id: generateUUID(),
                source: patient.meta?.source,
                security: deepcopy(patient.meta?.security)
            },
            link: [{ target: { reference: `${resourceType}/${patient._uuid}` } }]
        };
        item.incoming = FhirResourceWriteSerializer.serialize({ obj: person });
        const metaOutcome = this.resourceValidator.validateResourceMetaSync(item.incoming);
        if (metaOutcome) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.BUILD,
                subject: WriteFailure.subjectOf(item.incoming),
                operationOutcome: metaOutcome
            });
        }
        this._setRequestMethod({ context, method: 'POST' });
        return await this.insertBuilder.buildAsync({ item, context });
    }

    /**
     * Removes the links to the change's `linkTarget` from a hydrated copy of the stored document
     * and has the replace builder build it. A link is removed when its `reference` or its `_uuid`
     * is `<Type>/<id>` with the id the caller sent, as the old admin path matches it. Keeps the
     * first removed link's target in the change's `removedLinkTarget`, for the manual-link event.
     * A no-op when no stored link matches, found before anything is read back in.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async _buildRemoveLinkAsync ({ item, context }) {
        const reference = this._referenceTo(item.adminChange.linkTarget);
        const pointsToLinkTarget = (link) =>
            this._namesReference({ referenceObject: link.target, reference });
        const removedLink = (item.stored.link || []).find(pointsToLinkTarget);
        if (!removedLink) {
            return this._noChange(item);
        }
        item.adminChange.removedLinkTarget = deepcopy(removedLink.target);
        const document = await this._hydratedStoredAsync({ item, context });
        document.link = document.link.filter((link) => !pointsToLinkTarget(link));
        item.incoming = FhirResourceWriteSerializer.serialize({ obj: document });
        this._setRequestMethod({ context, method: 'PATCH' });
        return await this.replaceBuilder.buildAsync({ item, context });
    }

    /**
     * Points the patient field of a hydrated copy of the stored document at the loaded Patient,
     * as `Patient/<loaded _uuid>`, clears the field's `_uuid`, `_sourceId` and
     * `_sourceAssigningAuthority` so preSave recomputes them, and has the replace builder build it.
     * A no-op when the field already points at that Patient, and when the resource has no single
     * patient reference that can be rewritten; both checks run on the stored document, before
     * anything is read back in, copied into the body or built. The new Patient is always loaded;
     * with none loaded it returns the failure of `_missingLinkTargetFailure` and builds nothing.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async _buildRewritePatientReferenceAsync ({ item, context }) {
        if (item.linked.length === 0) {
            return this._missingLinkTargetFailure(item);
        }
        const reference = this._linkedReference(item);
        const storedPatientReference = this._rewritablePatientReference(item.stored);
        if (
            !storedPatientReference ||
            this._pointsTo({ referenceObject: storedPatientReference, reference })
        ) {
            return this._noChange(item);
        }
        const document = await this._hydratedStoredAsync({ item, context });
        const patientReference = this._rewritablePatientReference(document);
        patientReference.reference = reference;
        this._clearGlobalIdFields(patientReference);
        item.incoming = FhirResourceWriteSerializer.serialize({ obj: document });
        this._setRequestMethod({ context, method: 'PATCH' });
        const failure = await this.replaceBuilder.buildAsync({ item, context });
        const builtPatientReference =
            item.candidate && this._rewritablePatientReference(item.candidate);
        if (!failure && builtPatientReference) {
            this._clearGlobalIdFields(builtPatientReference);
        }
        return failure;
    }

    /**
     * Returns a copy of the stored document with its GridFS attachments and its base64 data kept
     * in cloud storage read back in, as the PATCH builder does. `item.stored` is not modified.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<Object>}
     */
    async _hydratedStoredAsync ({ item, context }) {
        const hydrated = await this.databaseAttachmentManager.transformAttachments(
            deepcopy(item.stored), RETRIEVE
        );
        return await this.base64DataManager.transformAsync(
            hydrated, BLOB_OP.RETRIEVE, context.requestInfo
        );
    }

    /**
     * Removes the `_uuid`, `_sourceId` and `_sourceAssigningAuthority` of a reference, in place, so
     * preSave recomputes them from its `reference`. The replace builder's merge keeps the stored
     * reference's fields on the built document, so they are cleared on the body and on the result.
     * @param {Object} referenceObject
     * @returns {void}
     */
    _clearGlobalIdFields (referenceObject) {
        delete referenceObject._uuid;
        delete referenceObject._sourceId;
        delete referenceObject._sourceAssigningAuthority;
    }

    /**
     * Returns the document's patient reference object, or null when it has none that can be
     * rewritten: a resource type the admin write never rewrites, a type whose patient field is not
     * a reference (such as Patient, whose field is its own `id`) or not mapped, or a field that is
     * missing or that passes through a list.
     * @param {Object} document
     * @returns {Object|null}
     */
    _rewritablePatientReference (document) {
        const resourceType = document.resourceType;
        if (NON_REWRITABLE_RESOURCE_TYPES.has(resourceType)) {
            return null;
        }
        const patientProperty = this.patientFilterManager.getPatientPropertyForResource({
            resourceType
        });
        if (typeof patientProperty !== 'string' || !patientProperty.endsWith(REFERENCE_SUFFIX)) {
            return null;
        }
        const path = patientProperty.slice(0, -REFERENCE_SUFFIX.length).split('.');
        let value = document;
        for (const field of path) {
            value = value[`${field}`];
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return null;
            }
        }
        return value;
    }

    /**
     * Whether the reference object points at the reference: on its `_uuid` when it has one, else
     * on its `reference` string.
     * @param {Object|undefined} referenceObject
     * @param {string} reference
     * @returns {boolean}
     */
    _pointsTo ({ referenceObject, reference }) {
        if (!referenceObject) {
            return false;
        }
        if (referenceObject._uuid) {
            return referenceObject._uuid === reference;
        }
        return referenceObject.reference === reference;
    }

    /**
     * Whether the reference object names the reference, as the old admin link removal matches a
     * link: its `reference` or its `_uuid` is the reference.
     * @param {Object|undefined} referenceObject
     * @param {string} reference
     * @returns {boolean}
     */
    _namesReference ({ referenceObject, reference }) {
        if (!referenceObject) {
            return false;
        }
        return referenceObject.reference === reference || referenceObject._uuid === reference;
    }

    /**
     * Returns the `<resourceType>/<id>` reference to the resource.
     * @param {{resourceType: string, id: string}} target `id` is the id the caller sent
     * @returns {string}
     */
    _referenceTo ({ resourceType, id }) {
        return `${resourceType}/${id}`;
    }

    /**
     * Returns the `<resourceType>/<_uuid>` reference to the item's loaded link target, which the
     * caller has checked is loaded.
     * @param {WriteItem} item
     * @returns {string}
     */
    _linkedReference (item) {
        const [linked] = item.linked;
        return this._referenceTo({ resourceType: linked.resourceType, id: linked.resource._uuid });
    }

    /**
     * Sets the method of the request info the write is flushed with, which the history entry
     * records as its `request.method`. The request info is the admin write runner's own copy.
     * @param {WriteContext} context
     * @param {'POST'|'PATCH'} method
     * @returns {void}
     */
    _setRequestMethod ({ context, method }) {
        context.requestInfo.method = method;
    }

    /**
     * Marks the change as a no-op: no document to write, as an update. Returns null.
     * @param {WriteItem} item
     * @returns {null}
     */
    _noChange (item) {
        item.candidate = null;
        item.writeMode = 'update';
        return null;
    }

    /**
     * Returns a `BUILD` failure for the item carrying a plain `Error` (a 500) for a change whose
     * link target was not loaded, which only an operation defined without `lookupLinkTarget` could
     * reach: the link would otherwise name the resource by the id the caller sent.
     * @param {WriteItem} item
     * @returns {WriteFailure}
     */
    _missingLinkTargetFailure (item) {
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.BUILD,
            subject: WriteFailure.subjectOf(item.incoming),
            error: new Error(`Admin change ${item.adminChange.kind} has no loaded link target`)
        });
    }

    /**
     * Returns a `BUILD` failure for the item carrying a `BadRequestError` with the message.
     * @param {WriteItem} item
     * @param {string} message
     * @returns {WriteFailure}
     */
    _badRequestFailure ({ item, message }) {
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.BUILD,
            subject: WriteFailure.subjectOf(item.incoming),
            error: new BadRequestError(new Error(message))
        });
    }
}

module.exports = {
    AdminBuilder
};
