/**
 * The methods every operation's responder must implement, in the order `WritePipeline.runAsync`
 * first calls them.
 */
const WRITE_RESPONDER_METHOD_NAMES = Object.freeze([
    'readAsync',
    'failureResults',
    'results',
    'toResponse',
    'recordMetrics'
]);

/**
 * The base class for the per-operation piece of a write: it reads the request into items, builds
 * the results and the response, and records the operation's metrics. `WritePipeline` runs the
 * steps and the audit. Each operation's responder extends this class and implements every method
 * in `WRITE_RESPONDER_METHOD_NAMES`; the constructor throws when one is missing, so the container
 * fails when it builds the responder, before any request uses it.
 */
class WriteResponder {
    /**
     * Throws `<subclass name> must implement: <missing names>` when the subclass does not
     * override every method in `WRITE_RESPONDER_METHOD_NAMES` with a function, so constructing
     * `WriteResponder` itself throws too. An anonymous subclass is named `WriteResponder subclass`.
     * The required methods must be defined in the class body, because class fields and properties
     * set in the subclass constructor are assigned only after `super()` returns.
     */
    constructor () {
        const missingMethods = WRITE_RESPONDER_METHOD_NAMES.filter(
            (name) => typeof this[name] !== 'function' || this[name] === WriteResponder.prototype[name]
        );
        if (missingMethods.length > 0) {
            const subclassName = this.constructor.name || 'WriteResponder subclass';
            throw new Error(`${subclassName} must implement: ${missingMethods.join(', ')}`);
        }
    }

    /**
     * Called first by `WritePipeline.runAsync`, before any step runs. Reads the request into the
     * run's `WriteContext` and one `WriteItem` per resource, failing the items that cannot be
     * written as read, and returns them with the request-level errors and whether the body was a
     * list.
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{context: import('../writeContext').WriteContext, items: import('../writeItem').WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync ({ requestInfo, parsedArgs, resourceType }) {
        throw new Error('WriteResponder.readAsync is not implemented');
    }

    /**
     * Called by `WritePipeline.runAsync` after the steps and before the flush. Returns the result
     * entries for the request-level errors and the failed items, so the metrics still get the
     * failures if the flush throws.
     * @param {import('../writeItem').WriteItem[]} items
     * @param {Object[]} requestErrors
     * @returns {Object[]}
     */
    failureResults ({ items, requestErrors }) {
        throw new Error('WriteResponder.failureResults is not implemented');
    }

    /**
     * Called by `WritePipeline.runAsync` after the flush. Returns the final result entries, built
     * from the request-level errors, the items and the bulk inserter's results. The pipeline audits
     * them, stores them for the access log and passes them to `toResponse` and `recordMetrics`.
     * @param {import('../writeItem').WriteItem[]} items
     * @param {Object[]} requestErrors
     * @param {Object[]} executedResults
     * @returns {Object[]}
     */
    results ({ items, requestErrors, executedResults }) {
        throw new Error('WriteResponder.results is not implemented');
    }

    /**
     * Called on success by `WritePipeline.runAsync`, after the audit, the success log and the
     * access log, and before `recordMetrics`. Returns the operation's response for the results.
     * @param {import('../writeContext').WriteContext} context
     * @param {Object[]} results
     * @param {boolean} wasIncomingAList
     * @param {string} resourceType
     * @param {number} startTime
     * @param {number} stopTime
     * @returns {*}
     */
    toResponse ({ context, results, wasIncomingAList, resourceType, startTime, stopTime }) {
        throw new Error('WriteResponder.toResponse is not implemented');
    }

    /**
     * Called by `WritePipeline.runAsync` once per request, on success and on error, with the
     * results built so far. Records the operation's metrics.
     * @param {Object[]} results
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {void}
     */
    recordMetrics ({ results, requestInfo, parsedArgs }) {
        throw new Error('WriteResponder.recordMetrics is not implemented');
    }
}

module.exports = {
    WriteResponder,
    WRITE_RESPONDER_METHOD_NAMES
};
