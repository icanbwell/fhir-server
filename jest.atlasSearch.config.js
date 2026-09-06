/**
 * Dedicated Jest config for real end-to-end Atlas Search coverage against
 * mongodb/mongodb-atlas-local (see src/tests/integration/atlasSearchTestRunner.js) instead of
 * the main suite's MongoMemoryReplSet, which has no $search support at all. Kept separate from
 * jest.config.js (rather than folded into the main integration run) so:
 *   - the main suite's collections/indexes/env vars are never disturbed by this one, and
 *   - this suite -- which needs Docker and pulls a large third-party image -- can be run
 *     independently (`yarn test:atlas-search`) without becoming a hard dependency of every
 *     `make tests` run.
 * See docs/adr/0003-atlas-search-for-patient-person-practitioner-lookup.md.
 * @type {import('jest').Config}
 */
module.exports = {
    watchman: false,
    watchPathIgnorePatterns: ['globalConfig'],
    globalSetup: '<rootDir>/src/tests/integration/atlasSearchGlobalSetup.js',
    globalTeardown: '<rootDir>/src/tests/integration/atlasSearchGlobalTeardown.js',
    verbose: false,
    testEnvironment: 'node',
    collectCoverage: false,
    reporters: ['default', 'github-actions'],
    transformIgnorePatterns: [
        'node_modules/(?!@kubernetes/client-node)/'
    ],
    testMatch: ['<rootDir>/src/tests/integration/atlasSearch/**/*.test.js'],
    setupFiles: [
        '<rootDir>/jest/patchClickHouseClient.js',
        '<rootDir>/jest/patchClickHouseManager.js',
        '<rootDir>/jest/setEnvVars.js'
    ],
    setupFilesAfterEnv: ['<rootDir>/src/tests/integration/testSetup.js'],
    testTimeout: 60000,
    injectGlobals: false
};
