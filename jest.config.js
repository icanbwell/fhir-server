/** @type {import('jest').Config} */
module.exports = {
    watchman: false,
    watchPathIgnorePatterns: ['globalConfig'],
    globalSetup: '<rootDir>/src/tests/jestGlobalSetup.js',
    globalTeardown: '<rootDir>/src/tests/jestGlobalTeardown.js',
    verbose: false,
    testEnvironment: 'node',
    collectCoverage: false,
    coverageReporters: ['text', 'lcov', 'json'],
    reporters: ['default', 'github-actions'],
    transformIgnorePatterns: [
        'node_modules/(?!@kubernetes/client-node)/'
    ],
    coveragePathIgnorePatterns: [
        '<rootDir>/src/testutils/',
        '<rootDir>/src/fhir/classes',
        '<rootDir>/src/fhir/generator',
        '<rootDir>/src/middleware/fhir/resources',
        '<rootDir>/src/views',
        '<rootDir>/src/services',
        '<rootDir>/src/graphql/resolvers',
        '<rootDir>/src/graphqlv2/resolvers'
    ],
    testPathIgnorePatterns: ['<rootDir>/src/tests/performance/', '<rootDir>/.claude/'],
    setupFiles: [
        '<rootDir>/jest/patchClickHouseClient.js',
        '<rootDir>/jest/patchClickHouseManager.js',
        '<rootDir>/jest/setEnvVars.js'
    ],
    setupFilesAfterEnv: ['<rootDir>/src/tests/testSetup.js'],
    testTimeout: 60000,
    injectGlobals: false
};
