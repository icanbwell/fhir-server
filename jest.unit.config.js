module.exports = {
    watchman: false,
    verbose: true,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/tests/unit/**/*.test.js'],
    testPathIgnorePatterns: [
        '<rootDir>/src/tests/unit/app.test.js',
        '<rootDir>/src/tests/unit/oauth/oauthCallback.test.js'
    ],
    transformIgnorePatterns: ['node_modules/(?!(uuid|jose|@kubernetes/client-node|luxon)/)'],
    setupFiles: ['<rootDir>/jest/setEnvVars.js'],
    testTimeout: 30000,
    injectGlobals: false
};
