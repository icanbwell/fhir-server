/**
 * 3rd party Error Tracking Middleware
 */
const process = require('node:process');
const { logSystemEventAsync } = require('../operations/common/logging');
const {logInfo, logError} = require('../operations/common/logging');

// Listener to do graceful shutdown in case of unexpected errors
async function errorListener(eventName, httpTerminator) {
    logInfo(`Beginning graceful shutdown of server for ${eventName}`, {});
    await logSystemEventAsync({
        event: eventName,
        message: `Beginning shutdown of server for ${eventName}`,
        args: {},
    });
    try {
        await httpTerminator.terminate();
        logInfo(`Successfully shut down server for ${eventName}`, {});
    } catch (error) {
        logError(`Failed to shutdown server for ${eventName}`, { error: error });
    } finally {
        process.exit(1);
    }
}

function initErrorHandler(httpTerminator) {
    process.on('uncaughtException', async (err) => {
        logError('uncaughtException', { error: err, source: 'uncaughtException' });
        await errorListener('uncaughtException', httpTerminator);
    });

    process.on('unhandledRejection', async (reason, promise) => {
        logError('unhandledRejection', {
            error: reason, source: 'unhandledRejection', args: {
                promise: promise,
            },
        });
        await errorListener('unhandledRejection', httpTerminator);
    });

}

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

module.exports = {
    initErrorHandler
};
