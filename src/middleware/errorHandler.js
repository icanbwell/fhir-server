/**
 * 3rd party Error Tracking Middleware
 */
const process = require('node:process');
const {ErrorReporter} = require('../utils/slack.logger');
const {getImageVersion} = require('../utils/getImageVersion');
const {logInfo, logError} = require('../operations/common/logging');


process.on('uncaughtException', async (err) => {
    const errorReporter = new ErrorReporter(getImageVersion());
    await errorReporter.reportErrorAsync({
            source: 'uncaughtException',
            message: 'uncaughtException',
            error: err
        }
    );
    logError('uncaughtException', { error: err, source: 'uncaughtException' });
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    const errorReporter1 = new ErrorReporter(getImageVersion());
    await errorReporter1.reportErrorAsync({
        source: 'unhandledRejection',
        message: 'unhandledRejection',
        error: reason
    });
    logError('unhandledRejection', { error: reason, source: 'unhandledRejection', args: {
        promise: promise
    }});
    process.exit(1);
});

process.on('warning', (warning) => {
    logInfo(warning.message, {
        method: 'errorHandler.warning',
        name: warning.name,
        stack: warning.stack
    });
});

process.on('exit', function (code) {
    if (code !== 0) {
        const stack = new Error().stack;
        logInfo(`PROCESS EXIT: exit code: ${code}`, {method: 'errorHandler.exit'});
        logInfo(stack);
    }
});
