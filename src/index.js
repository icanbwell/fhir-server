/**
 * Implements the main function
 */
// This line must come before importing any instrumented module.
require('dd-trace').init({
    logInjection: true
});
// Now load the rest of the modules
const { createServer } = require('./server');
const { createContainer } = require('./createContainer');
const { ErrorReporter } = require('./utils/slack.logger');
const { getImageVersion } = require('./utils/getImageVersion');
const { initialize } = require('./winstonInit');
const { logSlackAsync, logError } = require('./operations/common/logging');

const main = async function () {
    try {
        initialize();
        await createServer(() => createContainer());
    } catch (e) {
        const errorReporter = new ErrorReporter(getImageVersion());
        await errorReporter.reportErrorAsync({
            source: 'main',
            message: 'uncaughtException',
            error: e,
        });
        await logSlackAsync({
            source: 'main',
            message: 'uncaughtException',
            error: e
        });
    }
};

main().catch((reason) => {
    logError('Top level error', {reason: reason});
});
