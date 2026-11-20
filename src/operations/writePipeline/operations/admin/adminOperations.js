/**
 * Freezes the value and everything reachable from it, and returns it.
 * @param {*} value
 * @returns {*}
 */
function freezeDeep (value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freezeDeep);
    }
    return value;
}

/**
 * Names the request parameter that holds a resource's id (`idParameter`: a `_uuid`, a plain `id`
 * or `id|authority`) and the resource type it has, either fixed (`resourceType`) or read from
 * another request parameter (`resourceTypeParameter`). `stripsAnyTypePrefix` is true when the id
 * may carry any resource type as its prefix, which is stripped; otherwise only a leading `Person/`
 * or `Patient/` is.
 * @typedef {Object} AdminResourceDefinition
 * @property {string} idParameter
 * @property {string} [resourceType]
 * @property {string} [resourceTypeParameter]
 * @property {boolean} [stripsAnyTypePrefix]
 */

/**
 * How one admin operation reads its request and answers, as plain data. `name` is the operation's
 * route name and `profile` the name of the write profile it runs under. `target` is the resource
 * the change is made on and `linkTarget` the other end of the link, or the new Patient: each names
 * the request parameter that holds its id and the resource type it has (see
 * `AdminResourceDefinition`). `kind`, `lookupLinkTarget`, `createsMissingTarget` and
 * `linkTargetAccess` are copied onto the item's `adminChange`, and `smartMerge` onto the write
 * context. `linkTargetAccess` is the access letter
 * the looked-up link target is checked with: `r` for a link, which only reads it, and `u` for the
 * new Patient of a patient reference rewrite, which puts the changed resource in that Patient's
 * record. `manualLinkEvent` is the manual-link Kafka event the
 * operation sends when it writes (`isLinking` says whether it links or unlinks), or null.
 * `responseParameters` are the request parameters the response body echoes, after `message`.
 * `messages` are the response messages, each a template whose `{name}` placeholders are request
 * parameters: `success` when the change was written, `created` when the write created the target
 * (only for an operation that creates a missing target) and `noOp` when the change was already in
 * place.
 * @typedef {Object} AdminOperation
 * @property {string} name
 * @property {string} profile
 * @property {'addLink'|'removeLink'|'rewritePatientReference'} kind
 * @property {AdminResourceDefinition} target
 * @property {AdminResourceDefinition} linkTarget
 * @property {boolean} lookupLinkTarget
 * @property {boolean} createsMissingTarget
 * @property {'r'|'u'} linkTargetAccess
 * @property {boolean} smartMerge
 * @property {{isLinking: boolean}|null} manualLinkEvent
 * @property {string[]} responseParameters
 * @property {{success: string, created?: string, noOp: string}} messages
 */

/**
 * The five admin operations that write a resource, keyed by name. The messages are the ones
 * `AdminPersonPatientLinkManager` answers with today. A sixth operation is a new entry here.
 * @type {Readonly<Object<string, AdminOperation>>}
 */
const ADMIN_OPERATIONS = freezeDeep({
    createPersonToPersonLink: {
        name: 'createPersonToPersonLink',
        profile: 'adminLink',
        kind: 'addLink',
        target: { idParameter: 'bwellPersonId', resourceType: 'Person' },
        linkTarget: { idParameter: 'externalPersonId', resourceType: 'Person' },
        lookupLinkTarget: true,
        createsMissingTarget: false,
        linkTargetAccess: 'r',
        smartMerge: true,
        manualLinkEvent: null,
        responseParameters: ['bwellPersonId', 'externalPersonId'],
        messages: {
            success: 'Added link from Person/{bwellPersonId} to Person/{externalPersonId}',
            noOp: 'Link already exists from {bwellPersonId} to {externalPersonId}'
        }
    },
    removePersonToPersonLink: {
        name: 'removePersonToPersonLink',
        profile: 'adminLink',
        kind: 'removeLink',
        target: { idParameter: 'bwellPersonId', resourceType: 'Person' },
        linkTarget: { idParameter: 'externalPersonId', resourceType: 'Person' },
        lookupLinkTarget: false,
        createsMissingTarget: false,
        linkTargetAccess: 'r',
        smartMerge: false,
        manualLinkEvent: null,
        responseParameters: ['bwellPersonId', 'externalPersonId'],
        messages: {
            success: 'Removed link from Person/{bwellPersonId} to Person/{externalPersonId}',
            noOp: 'No Link exists from Person/{bwellPersonId} to Person/{externalPersonId}'
        }
    },
    createPersonToPatientLink: {
        name: 'createPersonToPatientLink',
        profile: 'adminLink',
        kind: 'addLink',
        target: { idParameter: 'externalPersonId', resourceType: 'Person' },
        linkTarget: { idParameter: 'patientId', resourceType: 'Patient' },
        lookupLinkTarget: true,
        createsMissingTarget: true,
        linkTargetAccess: 'r',
        smartMerge: true,
        manualLinkEvent: { isLinking: true },
        responseParameters: ['patientId', 'externalPersonId'],
        messages: {
            success: 'Added link from Person/{externalPersonId} to Patient/{patientId}',
            created: 'Created Person and added link from Person/{externalPersonId} to Patient/{patientId}',
            noOp: 'Link already exists from Person/{externalPersonId} to Patient/{patientId}'
        }
    },
    removePersonToPatientLink: {
        name: 'removePersonToPatientLink',
        profile: 'adminLink',
        kind: 'removeLink',
        target: { idParameter: 'personId', resourceType: 'Person' },
        linkTarget: { idParameter: 'patientId', resourceType: 'Patient' },
        lookupLinkTarget: false,
        createsMissingTarget: false,
        linkTargetAccess: 'r',
        smartMerge: false,
        manualLinkEvent: { isLinking: false },
        responseParameters: ['personId', 'patientId'],
        messages: {
            success: 'Removed link from Person/{personId} to Patient/{patientId}',
            noOp: 'No Link exists from Person/{personId} to Patient/{patientId}'
        }
    },
    updatePatientReference: {
        name: 'updatePatientReference',
        profile: 'adminPatientReference',
        kind: 'rewritePatientReference',
        target: {
            idParameter: 'resourceId',
            resourceTypeParameter: 'resourceType',
            stripsAnyTypePrefix: true
        },
        linkTarget: { idParameter: 'patientId', resourceType: 'Patient' },
        lookupLinkTarget: true,
        createsMissingTarget: false,
        linkTargetAccess: 'u',
        smartMerge: false,
        manualLinkEvent: null,
        responseParameters: ['patientId'],
        messages: {
            success: 'Patient reference updated for {resourceType} with id {resourceId}',
            noOp: "Couldn't update Patient reference in {resourceType} with id {resourceId}"
        }
    }
});

/**
 * Thrown when an admin write is asked for an operation that has no entry in `ADMIN_OPERATIONS`. A
 * route handler only runs the operations it names, so this is a programming error, not a bad
 * request. `operation` is the name that was asked for.
 */
class UnknownAdminOperationError extends Error {
    /**
     * @param {*} operation
     */
    constructor (operation) {
        super(`Unknown admin operation: ${String(operation)}`);
        this.name = 'UnknownAdminOperationError';
        /**
         * @type {*}
         */
        this.operation = operation;
    }
}

/**
 * Returns the definition of the admin operation. Throws an `UnknownAdminOperationError` when the
 * name is not one of the operations' own names (a name inherited from `Object.prototype` is not).
 * @param {string} name
 * @returns {AdminOperation}
 */
function getAdminOperation (name) {
    if (typeof name !== 'string' || !Object.hasOwn(ADMIN_OPERATIONS, name)) {
        throw new UnknownAdminOperationError(name);
    }
    return ADMIN_OPERATIONS[`${name}`];
}

module.exports = {
    ADMIN_OPERATIONS,
    UnknownAdminOperationError,
    getAdminOperation
};
