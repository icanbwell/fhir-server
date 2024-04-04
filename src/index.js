/**
 * Implements the main function
 */
// Load the rest of the modules
const Sentry = require('@sentry/node');
const { createServer } = require('./server');
const { createContainer } = require('./createContainer');
const { getCircularReplacer } = require('./utils/getCircularReplacer');
const { initialize } = require('./winstonInit');
const { logError } = require('./operations/common/logging');
const { getImageVersion } = require('./utils/getImageVersion');

Sentry.init({
    release: getImageVersion(),
    environment: process.env.ENVIRONMENT,
    autoSessionTracking: false
});

const main = async function () {
    try {
        initialize();
        const container = createContainer();
        await createServer(() => container);
    } catch (e) {
        console.log('ERROR from MAIN: ' + e);
        console.log(JSON.stringify({ method: 'main', message: JSON.stringify(e, getCircularReplacer()) }));
    }
};

main().catch((reason) => {
    logError('Top level error', { reason });
});
