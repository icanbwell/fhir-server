const { WriteFailure } = require('./writeFailure');

/**
 * An item's status. Steps get only `active` items; an item stops being active when it fails, the
 * no-op check marks it unchanged, or the write step queues it.
 */
const WRITE_ITEM_STATUS = Object.freeze({
    ACTIVE: 'active',
    FAILED: 'failed',
    UNCHANGED: 'unchanged',
    QUEUED: 'queued'
});

/**
 * An admin operation's description of its change: `kind` is `addLink`, `removeLink` or
 * `rewritePatientReference`; `target` is the resource being changed, its `id` the id the caller
 * sent without its prefix (a `_uuid`, a plain `id` or `id|authority`); `linkTarget` is the other
 * end of the link, or the new Patient, with its `id` as the caller sent it too;
 * `linkTargetLookup` says when `linkTarget` is looked up, and must then exist and be readable
 * (`whenTargetMissing` or `never`);
 * `createsMissingTarget` is true only for `createPersonToPatientLink`.
 * @typedef {Object} AdminChange
 * @property {'addLink'|'removeLink'|'rewritePatientReference'} kind
 * @property {{resourceType: string, id: string}} target
 * @property {{resourceType: string, id: string}} linkTarget
 * @property {'whenTargetMissing'|'never'} linkTargetLookup
 * @property {boolean} createsMissingTarget
 */

/**
 * What an import line adds to its item: the absolute byte offset of the line in the source file,
 * which the result entry carries, and whether an earlier line of the same flush already had the
 * resource's `_uuid`, which makes this line an update.
 * @typedef {Object} ImportLine
 * @property {number} byteOffset
 * @property {boolean} forceUpdated
 */

/**
 * One resource in a write batch, with the state the steps fill in: the stored document, the built
 * document (`candidate`), the write mode, the hybrid-storage context data, the identity saved
 * before `_` fields are stripped, and its status and failure. `index` is its position in the batch,
 * which the responder orders results by. A PATCH also keeps the JSON Patch operations to apply
 * (`patch`), the writes it makes to Group members (`memberWrites`) and the operations it applied
 * (`appliedPatch`); the steps that fill them are PATCH's own. An admin write keeps the description
 * of its change (`adminChange`) and the resources the change links to (`linked`); the steps that
 * fill them are the admin operations' own. An import line keeps its byte offset and whether it is
 * a repeat of an earlier line's resource (`importLine`), which only the import responder reads.
 */
class WriteItem {
    /**
     * @param {number} index
     * @param {Object} incoming
     * @param {ImportLine|null} [importLine]
     */
    constructor ({ index, incoming, importLine = null }) {
        /**
         * @type {number}
         */
        this.index = index;
        /**
         * @type {Object}
         */
        this.incoming = incoming;
        /**
         * @type {Object|null}
         */
        this.stored = null;
        /**
         * @type {Object|null}
         */
        this.candidate = null;
        /**
         * @type {'insert'|'update'|null}
         */
        this.writeMode = null;
        /**
         * @type {Object|null}
         */
        this.contextData = null;
        /**
         * @type {Object|null}
         */
        this.savedIdentity = null;
        /**
         * @type {Array|null}
         */
        this.patch = null;
        /**
         * @type {Object|null}
         */
        this.memberWrites = null;
        /**
         * @type {Array|null}
         */
        this.appliedPatch = null;
        /**
         * The admin operation's description of its change. Null for an operation that is not an
         * admin write.
         * @type {AdminChange|null}
         */
        this.adminChange = null;
        /**
         * The resources looked up for the change's `linkTarget`; empty until a step fills it.
         * @type {Array<{resourceType: string, resource: Object}>}
         */
        this.linked = [];
        /**
         * The import line's byte offset and repeat flag. Null for an operation that is not an
         * import.
         * @type {ImportLine|null}
         */
        this.importLine = importLine;
        /**
         * @type {WriteFailure|null}
         */
        this.failure = null;
        /**
         * @type {string}
         */
        this.status = WRITE_ITEM_STATUS.ACTIVE;
    }

    /**
     * Records the failure and marks the item failed, so later steps skip it.
     * @param {WriteFailure} failure
     * @returns {void}
     */
    fail ({ failure }) {
        this.failure = failure;
        this.status = WRITE_ITEM_STATUS.FAILED;
    }

    /**
     * Marks the item unchanged, so later steps skip it and nothing is written for it.
     * @returns {void}
     */
    markUnchanged () {
        this.status = WRITE_ITEM_STATUS.UNCHANGED;
    }

    /**
     * Marks the item queued: its write waits in the bulk inserter until the pipeline flushes it.
     * @returns {void}
     */
    markQueued () {
        this.status = WRITE_ITEM_STATUS.QUEUED;
    }

    /**
     * Whether the item is still active, so the next step gets it.
     * @returns {boolean}
     */
    get isActive () {
        return this.status === WRITE_ITEM_STATUS.ACTIVE;
    }
}

module.exports = {
    WRITE_ITEM_STATUS,
    WriteItem
};
