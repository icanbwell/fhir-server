/**
 * Jest config for unit tests that don't require testcontainers (MongoDB/Kafka).
 * Used for fast-running unit tests that mock all infrastructure dependencies.
 */
const base = require('./jest.config.js');

module.exports = {
    ...base,
    globalSetup: undefined,
    globalTeardown: undefined,
    setupFilesAfterEnv: [],
    testMatch: ['**/tests/unit/**/*.test.js']
};
