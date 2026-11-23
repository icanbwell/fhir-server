const { transform, transformIgnorePatterns } = require('./jest/transformConfig');
const { collectCoverageFrom, coveragePathIgnorePatterns } = require('./jest/coverageConfig');

/** @type {import('jest').Config} */
module.exports = {
    watchman: false,
    watchPathIgnorePatterns: ['globalConfig'],
    globalSetup: '<rootDir>/src/tests/integration/jestGlobalSetup.js',
    globalTeardown: '<rootDir>/src/tests/integration/jestGlobalTeardown.js',
    verbose: false,
    testEnvironment: 'node',
    collectCoverage: false,
    coverageReporters: ['text', 'lcov', 'json'],
    reporters: ['default', 'github-actions'],
    transform,
    transformIgnorePatterns,
    collectCoverageFrom,
    coveragePathIgnorePatterns,
    testPathIgnorePatterns: [
        '<rootDir>/src/tests/integration/performance/',
        // Has its own dedicated config (jest.atlasSearch.config.js) -- needs a real Atlas
        // Search deployment (mongodb-atlas-local), not this suite's MongoMemoryReplSet, which
        // has no $search support at all.
        '<rootDir>/src/tests/integration/atlasSearch/',
        '<rootDir>/.claude/',
        '<rootDir>/src/tests/unit/'
    ],
    setupFiles: [
        '<rootDir>/jest/resetNockInterceptor.js',
        '<rootDir>/jest/patchClickHouseClient.js',
        '<rootDir>/jest/patchClickHouseManager.js',
        '<rootDir>/jest/setEnvVars.js'
    ],
    setupFilesAfterEnv: [
        '<rootDir>/src/tests/integration/testSetup.js',
        '<rootDir>/jest/retryFailedTestFiles.js'
    ],
    testTimeout: 60000,
    injectGlobals: false
};
