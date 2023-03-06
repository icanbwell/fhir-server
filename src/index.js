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
const env = require('var');
const { getImageVersion } = require('./utils/getImageVersion');
const { getCircularReplacer } = require('./utils/getCircularReplacer');
const { initialize } = require('./winstonInit');
const { logError } = require('./operations/common/logging');
const blocked = require('blocked-at');
const { isTrue } = require('./utils/isTrue');

if (isTrue(env.ENABLE_BLOCKED_INFO)){
    blocked((time, stack) => {
        console.log(`Blocked for ${time}ms, operation started here:`, stack);
    }, { threshold: env.BLOCKED_THRESHOLD || 100});
}

const main = async function () {
    try {
        initialize();
        await createServer(() => createContainer());
    } catch (e) {
        console.log(JSON.stringify({ method: 'main', message: JSON.stringify(e, getCircularReplacer()) }));
        const errorReporter = new ErrorReporter(getImageVersion());
        await errorReporter.reportErrorAsync({
            source: 'main',
            message: 'uncaughtException',
            error: e,
        });
    }
};

main().catch((reason) => {
    logError('Top level error', {reason: reason});
});
