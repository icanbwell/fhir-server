/**
 * This file implements helper function for sentry error notifications
 */

const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN_SERVER,
  environment: process.env.NODE_ENV,
  release: process.env.GIT_TAG_VERSION,
});

process.on('uncaughtException', (err) => {
    console.log(JSON.stringify({message: JSON.stringify(err)}));
  Sentry.captureException(err);
  process.exitCode = 1;
});

process.on('unhandledRejection', (err) => {
    console.log(JSON.stringify({message: JSON.stringify(err)}));
  Sentry.captureException(err);
  process.exitCode = 1;
});

module.exports = Sentry;
