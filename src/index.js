/**
 * Implements the main function
 */
// Load the rest of the modules
const Sentry = require('@sentry/node');
const { createServer } = require('./server');
const { createContainer } = require('./createContainer');
const { getCircularReplacer } = require('./utils/getCircularReplacer');
const { initialize } = require('./winstonInit');
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
        console.log(JSON.stringify({ method: 'main', message: e.message, stack: JSON.stringify(e.stack, getCircularReplacer()) }));
    }
};

main();
