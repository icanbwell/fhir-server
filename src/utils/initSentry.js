const Sentry = require('@sentry/node');
const { getImageVersion } = require('./getImageVersion');

/**
 * Initializes Sentry with this app's standard options. Centralized so release/environment/
 * sampling settings only need to change in one place, rather than staying in sync across
 * every process that needs its own Sentry.init() call (the main FHIR server, plus each
 * standalone async job entrypoint).
 * @param {Object} [params]
 * @param {boolean} [params.validateOpenTelemetry] - only meaningful for entrypoints that
 *   actually load OpenTelemetry instrumentation (see src/otel_instrumentation.js); entrypoints
 *   that don't should leave this false rather than validate a setup that was never attempted.
 */
function initSentry ({ validateOpenTelemetry = false } = {}) {
    Sentry.init({
        release: getImageVersion(),
        environment: process.env.ENVIRONMENT,
        autoSessionTracking: false,
        skipOpenTelemetrySetup: true,
        tracesSampleRate: undefined,
        tracesSampler: undefined,
        tracePropagationTargets: []
    });

    if (validateOpenTelemetry) {
        Sentry.validateOpenTelemetrySetup();
    }
}

module.exports = { initSentry };
