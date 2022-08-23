/**
 * 3rd party Error Tracking Middleware
 */
const Sentry = require('@sentry/node');
const {ErrorReporter} = require('../utils/slack.logger');

Sentry.init({dsn: process.env.SENTRY_DSN});


process.on('uncaughtException', async (err) => {
    console.log(JSON.stringify({method: 'sentryMiddleware.uncaughtException', message: JSON.stringify(err)}));
    Sentry.captureException(err);
    await new ErrorReporter().reportErrorAsync('uncaughtException', err);
    // process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.log(JSON.stringify(
            {
                method: 'sentryMiddleware.unhandledRejection',
                promise: promise,
                reason: reason,
                stack: reason.stack
            }
        )
    );
    // Sentry.captureException(err);
    // await new ErrorReporter().reportErrorAsync('unhandledRejection', err);
    // process.exit(1);
});

process.on('warning', (warning) => {
    console.log(JSON.stringify(
            {
                method: 'sentryMiddleware.warning',
                name: warning.name,
                message: warning.message,
                stack: warning.stack
            }
        )
    );
});

process.on('exit', function (code) {
    if (code !== 0) {
        const stack = new Error().stack;
        console.log(JSON.stringify({method: 'sentryMiddleware.exit', message: `PROCESS EXIT: exit code: ${code}`}));
        console.log(JSON.stringify({message: JSON.stringify(stack)}));
    }
});

module.exports = Sentry;
