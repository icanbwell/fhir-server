const { assertTypeEquals } = require('./assertType');
const { ConfigManager } = require('./configManager');
const { trace: otelTrace } = require('@opentelemetry/api');

/**
 * This class provides custom tracer that is enables among Datadog or Opentelemetry
 */
class CustomTracer {
    /**
     * @param {ConfigManager} configManager
     */
    constructor({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        // https://opentelemetry.io/docs/languages/js/instrumentation/#create-spans
        const otelTracer = otelTrace.getTracer('fhir-server');
        this.traceFunction = async (name, func) =>
            await otelTracer.startActiveSpan(name, async (span) => {
                const res = await func();
                span.end();
                return res;
            });
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
        return await this.traceFunction(name, func);
    }
}

module.exports = {
    CustomTracer
};
