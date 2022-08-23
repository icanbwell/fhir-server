/**
 * 3rd party Error Tracking Middleware
 */
const Sentry = require('@sentry/node');
const {ErrorReporter} = require('../utils/slack.logger');

Sentry.init({dsn: process.env.SENTRY_DSN});


process.on('uncaughtException', async (err) => {
    console.log(JSON.stringify({message: JSON.stringify(err)}));
    Sentry.captureException(err);
    await new ErrorReporter().reportErrorAsync('uncaughtException', err);
    process.exit(1);
});

process.on('unhandledRejection', async (err) => {
    console.log(JSON.stringify({message: JSON.stringify(err)}));
    Sentry.captureException(err);
    await new ErrorReporter().reportErrorAsync('unhandledRejection', err);
    process.exit(1);
});

process.on('exit', function (code) {
    if (code !== 0) {
        const stack = new Error().stack;
        console.log(JSON.stringify({message: `PROCESS EXIT: exit code: ${code}`}));
        console.log(JSON.stringify({message: JSON.stringify(stack)}));
    }
});

module.exports = Sentry;
