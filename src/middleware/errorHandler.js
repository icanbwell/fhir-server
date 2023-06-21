/**
 * 3rd party Error Tracking Middleware
 */
const process = require('node:process');
const {logInfo, logError} = require('../operations/common/logging');

process.on('uncaughtException', (err) => {
    logError('uncaughtException', { error: err, source: 'uncaughtException' });
    // Send signal to be handled by the terminus listener for graceful shutdown
    process.kill(process.pid, 'SIGTERM');
});

process.on('unhandledRejection', (reason, promise) => {
    logError('unhandledRejection', {
        error: reason, source: 'unhandledRejection', args: {
            promise: promise,
        },
    });
    // Send signal to be handled by the terminus listener for graceful shutdown
    process.kill(process.pid, 'SIGTERM');
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
