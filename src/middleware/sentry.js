/**
 * 3rd party Error Tracking Middleware
 */
const process = require('node:process');
const Sentry = require('@sentry/node');
const {ErrorReporter} = require('../utils/slack.logger');
const {getImageVersion} = require('../utils/getImageVersion');
const {logInfo} = require('../operations/common/logging');

Sentry.init({dsn: process.env.SENTRY_DSN});


process.on('uncaughtException', async (err) => {
    logInfo(err, {method: 'sentryMiddleware.uncaughtException'});
    Sentry.captureException(err);
    const errorReporter = new ErrorReporter(getImageVersion());
    await errorReporter.reportErrorAsync({
            source: 'uncaughtException',
            message: 'uncaughtException',
            error: err
        }
    );
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    logInfo('', {
        method: 'sentryMiddleware.unhandledRejection',
        promise: promise,
        reason: reason,
        stack: reason.stack
    });
    Sentry.captureException(reason);
    const errorReporter1 = new ErrorReporter(getImageVersion());
    await errorReporter1.reportErrorAsync({
        source: 'unhandledRejection',
        message: 'unhandledRejection',
        error: reason
    });
    process.exit(1);
});

process.on('warning', (warning) => {
    logInfo(warning.message, {
        method: 'sentryMiddleware.warning',
        name: warning.name,
        stack: warning.stack
    });
});

process.on('exit', function (code) {
    if (code !== 0) {
        const stack = new Error().stack;
        logInfo(`PROCESS EXIT: exit code: ${code}`, {method: 'sentryMiddleware.exit'});
        logInfo(stack);
    }
});

module.exports = Sentry;
