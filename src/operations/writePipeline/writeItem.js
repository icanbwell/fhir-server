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
 * One resource in a write batch, with the state the steps fill in: the stored document, the built
 * document (`candidate`), the write mode, the hybrid-storage context data, the identity saved
 * before `_` fields are stripped, and its status and failure. `index` is its position in the batch,
 * which the responder orders results by.
 */
class WriteItem {
    /**
     * @param {number} index
     * @param {Object} incoming
     */
    constructor ({ index, incoming }) {
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
