const { assertTypeEquals } = require('./assertType');
const { trace: otelTrace } = require('@opentelemetry/api');

/**
 * This class provides custom tracer for Opentelemetry
 */
class CustomTracer {
    constructor() {
        // https://opentelemetry.io/docs/languages/js/instrumentation/#create-spans
        this.otelTracer = otelTrace.getTracer('fhir-server');
    }

    /**
     * function to add custom trace
     * @typedef traceParams
     * @property {string} name name of the span
     * @property {() => Promise<T>} func function to add custom span for
     *
     * @param {traceParams} traceParams
     * @returns {Promise<T>}
     */
    async trace({ name, func }) {
        return await this.otelTracer.startActiveSpan(name, async (span) => {
            try {
                return await func();
            } finally {
                span.end();
            }
        });
    }

    /**
     * Adds a span around a synchronous function. Unlike trace(), this stays synchronous
     * so it can wrap sync hot paths (e.g. code inside forEach loops) without forcing the
     * caller to become async. The span is a no-op when the OTel SDK isn't running.
     * @typedef traceSyncParams
     * @property {string} name name of the span
     * @property {() => T} func synchronous function to add a span for
     *
     * @template T
     * @param {traceSyncParams} traceSyncParams
     * @returns {T}
     */
    traceSync({ name, func }) {
        return this.otelTracer.startActiveSpan(name, (span) => {
            try {
                return func();
            } finally {
                span.end();
            }
        });
    }
}

module.exports = {
    CustomTracer
};
