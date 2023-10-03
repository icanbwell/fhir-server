const Sentry = require('@sentry/node');

/**
 *
 * @param {Error} error Error
 * @param {import('@sentry/types').CaptureContext} context
 */
const captureSentryException = (error, context) => {
    Sentry.captureException(error, context);
};

module.exports = { captureSentryException };
