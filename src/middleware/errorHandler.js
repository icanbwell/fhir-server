/**
 * 3rd party Error Tracking Middleware
 */
const process = require('node:process');
const {logInfo, logError} = require('../operations/common/logging');


process.on('uncaughtException', async (err) => {
    logError('uncaughtException', { error: err, source: 'uncaughtException' });
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
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
        logInfo(stack, {});
    }
});
