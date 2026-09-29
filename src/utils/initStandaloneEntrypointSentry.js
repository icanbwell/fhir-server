const { initSentry } = require('./initSentry');

/**
 * Initializes Sentry plus the shared process-level error handlers for a standalone entrypoint
 * that runs outside the main FHIR server (e.g. an async job's Kafka consumer process,
 * `node src/operations/asyncJobs/orchestrator.js`) and therefore never loads src/index.js or
 * server.js, where these are normally wired up. Without this, errors in such a process
 * (including an uncaught exception or unhandled rejection) go completely unreported.
 */
function initStandaloneEntrypointSentry () {
    initSentry();
    require('../middleware/errorHandler');
}

module.exports = { initStandaloneEntrypointSentry };
