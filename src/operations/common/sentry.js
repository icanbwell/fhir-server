const Sentry = require('@sentry/node');

/**
 *
 * @param {Error} error Error
 * @param {import('@sentry/types').CaptureContext} context
 */
const captureException = (error, context) => {
    Sentry.captureException(error, context);
};

module.exports = { captureException };
