/**
 * Implements the main function
 */
const {createServer} = require('./server');
const {createContainer} = require('./createContainer');
const Sentry = require('@sentry/node');
const {ErrorReporter} = require('./utils/slack.logger');

const main = async function () {
    try {
        await createServer(() => createContainer());
    } catch (e) {
        console.log(JSON.stringify({method: 'main', message: JSON.stringify(e)}));
        Sentry.captureException(e);
        await new ErrorReporter().reportErrorAsync({message: 'uncaughtException', error: e});
    }
};

main().catch(reason => {
    console.error(JSON.stringify({message: `Top level error: ${reason}`}));
});
