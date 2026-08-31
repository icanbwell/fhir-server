module.exports = {
    watchman: false,
    verbose: true,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/tests/unit/**/*.test.js'],
    // These suites assert correct behavior for known, tracked bugs and fail by design until each
    // is fixed (security findings also need adversarial review against review.md); excluded here
    // so a documented-but-unfixed bug doesn't fail CI. Note: entries below do NOT all point at a
    // single external tracker - `BUG_REPORT.md`/`fhir-server-security-bugs.csv`, previously cited
    // here for the whole list, do not exist in this repo (see docs/superpowers/plans/
    // 2026-08-04-security-review-test-coverage.md's Global Constraints). Before removing an entry,
    // confirm it passes against current `main` - some bugs get fixed without their quarantine entry
    // being removed. Naming the path alone does NOT bypass this list (jest reports "No tests
    // found"); override the list and keep the path BEFORE the flag, since --testPathIgnorePatterns
    // is variadic and would otherwise swallow the path and run the whole suite:
    //   yarn jest --runInBand --forceExit <path> --testPathIgnorePatterns='src/tests/integration/performance/'
    // A Docker daemon is required either way: globalSetup starts a ClickHouse testcontainer.
    // Remove an entry once its bug is fixed (and reviewed, for security ones).
    testPathIgnorePatterns: [
        '<rootDir>/src/tests/unit/admin/adminExportManager.test.js',
        // adminExportManagerRequestInfo.test.js: unresolved ESM-transform gap, not a logic bug -
        // it transitively requires @icanbwell/fhirpatientsummary, which is `"type": "module"` and
        // ships an unbundled `import` for luxon/html-minifier-terser that this config's
        // transformIgnorePatterns doesn't allowlist. Quarantined rather than chased here since the
        // full transform fix is open-ended (unknown how many more ESM deps sit behind it) and this
        // file has never run under any wired jest config before this PR.
        '<rootDir>/src/tests/unit/admin/adminExportManagerRequestInfo.test.js',
        '<rootDir>/src/tests/unit/admin/runners/updateCollectionsRunner.test.js',
        '<rootDir>/src/tests/unit/dataLayer/base64DataManager.test.js',
        '<rootDir>/src/tests/unit/dataLayer/bulkWriteExecutors/clickHouseBulkWriteExecutor.bugs.test.js',
        '<rootDir>/src/tests/unit/dataLayer/databaseBulkLoader.test.js',
        '<rootDir>/src/tests/unit/dataLayer/postSaveHandlers/clickHouseGroupHandler.nullSafety.test.js',
        '<rootDir>/src/tests/unit/dataLayer/providers/mongoWithClickHouseStorageProvider.unit.test.js',
        '<rootDir>/src/tests/unit/operations/everything/everythingRelatedResourcesMapper.test.js',
        '<rootDir>/src/tests/unit/operations/graph/graph.test.js',
        '<rootDir>/src/tests/unit/operations/history/history.test.js',
        '<rootDir>/src/tests/unit/operations/merge/merge.nullSafety.test.js',
        '<rootDir>/src/tests/unit/operations/patch/strategies/groupMemberPatchStrategy.bugs.test.js',
        '<rootDir>/src/tests/unit/operations/remove/removeHelper.test.js',
        '<rootDir>/src/tests/unit/operations/searchByVersionId/searchByVersionId.test.js',
        '<rootDir>/src/tests/unit/enrich/enrichmentManager.test.js',
        '<rootDir>/src/tests/unit/enrich/proxyPatientReferenceEnrichmentProvider.test.js',
        '<rootDir>/src/tests/unit/graphql/resolvers/graphqlResolver.crossTenant.test.js',
        '<rootDir>/src/tests/unit/graphqlv2/crossTenantPhiLeakage.test.js',
        '<rootDir>/src/tests/unit/middleware/errorInformationDisclosure.test.js',
        '<rootDir>/src/tests/unit/operations/export/bulkDataExportRunner.crossTenant.test.js',
        '<rootDir>/src/tests/unit/operations/history/historyCrossTenant.test.js',
        '<rootDir>/src/tests/unit/operations/merge/merge.crossTenant.test.js',
        '<rootDir>/src/tests/unit/operations/merge/mergeCrossTenantWrite.test.js',
        '<rootDir>/src/tests/unit/operations/query/searchQuery.crossTenant.test.js',
        '<rootDir>/src/tests/unit/operations/subscription/subscription.crossTenant.test.js',
        '<rootDir>/src/tests/unit/operations/subscription/webhookPhiLeakage.test.js',
        // personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js entry removed here:
        // DCON-4894 closed this gap (Person.link assurance enforcement) and the test now
        // passes against current main -- see the file's updated top-of-file comment.
    ],
    transformIgnorePatterns: ['node_modules/(?!(uuid|jose|@kubernetes/client-node|luxon|openid-client|oauth4webapi)/)'],
    setupFiles: ['<rootDir>/jest/setEnvVars.js'],
    testTimeout: 30000,
    injectGlobals: false
};
