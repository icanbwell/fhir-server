/**
 * This file implements helper function for sentry error notifications
 */

const Sentry = require('@sentry/node');
const {logError} = require('../operations/common/logging');

Sentry.init({
    dsn: process.env.SENTRY_DSN_SERVER,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_TAG_VERSION,
});

process.on('uncaughtException', (err) => {
    logError(err, {method: 'sentry.uncaughtException'});
    Sentry.captureException(err);
    process.exitCode = 1;
});

process.on('unhandledRejection', (err) => {
    logError(err, {method: 'sentry.unhandledRejection'});
    Sentry.captureException(err);
    process.exitCode = 1;
});

module.exports = Sentry;
