const { jest } = require('@jest/globals');

if (process.env.CI) {
    jest.retryTimes(2, { logErrorsBeforeRetry: true, entireDescribe: true });
}
