'use strict';

/**
 * Environment-variable matrix coverage for ConfigManager (src/utils/configManager.js).
 *
 * ConfigManager is the single source of truth for feature flags and environment behavior, so a
 * getter that returns the wrong default silently changes production behavior. Every test here
 * drives the real getter with a real process.env value and asserts the exact value returned.
 *
 * Complements the existing src/tests/unit/utils/configManager.test.js (not a replacement).
 *
 * Oracle references:
 *  - bwell-business-logic-master.md §3 "Security Tag System / Tag Invariants"
 *  - bwell-business-logic-master.md §7 "Patient Scope & Identity Graph"
 *  - bwell-business-logic-master.md §24 "Audit Event Requirements"
 *  - bwell-business-logic-master.md §67 "Fail-Open vs Fail-Closed Classification"
 *
 * NOTE: jest/setEnvVars.js seeds a baseline environment for every unit test (NODE_ENV=production,
 * ENABLE_CLICKHOUSE=0, CMS_ALLOWED_PURPOSE_OF_USE=PATRQT, EXTERNAL_REQUEST_TIMEOUT_SEC=5, ...).
 * Each test explicitly sets or deletes the keys it cares about and the full env is restored in
 * afterEach, so the baseline never leaks an assumption into an assertion.
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');
const { DEFAULT_CACHE_EXPIRY_TIME, CONSENT_CATEGORY } = require('../../../constants');
const { DEFAULT_CLICKHOUSE } = require('../../../constants/groupConstants');
const { DEFAULT_ASSURANCE_MINIMUM_LEVEL } = require('../../../utils/personLinkAssuranceLevel');

describe('ConfigManager — env var matrix (set / unset / empty / malformed)', () => {
    /** @type {Object<string,string>} */
    let envSnapshot;
    /** @type {ConfigManager} */
    let configManager;

    beforeEach(() => {
        envSnapshot = { ...process.env };
        configManager = new ConfigManager();
    });

    afterEach(() => {
        // ConfigManager captures `process.env` by reference at module load, so restore the same
        // object in place rather than reassigning process.env.
        for (const key of Object.keys(process.env)) {
            if (!(key in envSnapshot)) {
                delete process.env[key];
            }
        }
        for (const [key, value] of Object.entries(envSnapshot)) {
            if (process.env[key] !== value) {
                process.env[key] = value;
            }
        }
    });

    /**
     * @param {string} key
     * @param {string|undefined} value
     */
    function setEnv(key, value) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    // ======================================================================
    // SECURITY-RELEVANT DEFAULTS — must be fail-CLOSED when unset
    // ======================================================================

    describe('security-relevant flags default to the SAFE value when unset', () => {
        test('SECURITY (business-logic §7): doNotRequirePersonOrPatientIdForPatientScope is FALSE when unset, so a patient-scoped token cannot skip the person/patient id requirement', () => {
            setEnv('DO_NOT_REQUIRE_PERSON_OR_PATIENT_FOR_PATIENT_SCOPE', undefined);
            expect(new ConfigManager().doNotRequirePersonOrPatientIdForPatientScope).toBe(false);
        });

        test('SECURITY (business-logic §7): doNotRequirePersonOrPatientIdForPatientScope stays FALSE for the string "false" (no truthy-string parsing)', () => {
            setEnv('DO_NOT_REQUIRE_PERSON_OR_PATIENT_FOR_PATIENT_SCOPE', 'false');
            expect(new ConfigManager().doNotRequirePersonOrPatientIdForPatientScope).toBe(false);
            setEnv('DO_NOT_REQUIRE_PERSON_OR_PATIENT_FOR_PATIENT_SCOPE', 'FALSE');
            expect(new ConfigManager().doNotRequirePersonOrPatientIdForPatientScope).toBe(false);
            setEnv('DO_NOT_REQUIRE_PERSON_OR_PATIENT_FOR_PATIENT_SCOPE', '0');
            expect(new ConfigManager().doNotRequirePersonOrPatientIdForPatientScope).toBe(false);
        });

        test('SECURITY (business-logic §67 FAIL CLOSED): bulkImportAllowedS3Buckets is an EMPTY allow-list when unset, so every bucket is rejected by default', () => {
            setEnv('BULK_IMPORT_ALLOWED_S3_BUCKETS', undefined);
            expect(new ConfigManager().bulkImportAllowedS3Buckets).toEqual([]);
            setEnv('BULK_IMPORT_ALLOWED_S3_BUCKETS', '');
            expect(new ConfigManager().bulkImportAllowedS3Buckets).toEqual([]);
        });

        test('SECURITY (business-logic §67): bulkImportAllowedS3Buckets returns exactly the configured, trimmed bucket list — nothing wider', () => {
            setEnv('BULK_IMPORT_ALLOWED_S3_BUCKETS', ' bucket-a , bucket-b ');
            expect(new ConfigManager().bulkImportAllowedS3Buckets).toEqual(['bucket-a', 'bucket-b']);
        });

        test('SECURITY (CMS partner access / business-logic §9): cmsAllowedPurposeOfUse is an EMPTY Set when unset — CMSManager._verifyPurposeOfUse rejects on allowed.size === 0', () => {
            setEnv('CMS_ALLOWED_PURPOSE_OF_USE', undefined);
            const allowed = new ConfigManager().cmsAllowedPurposeOfUse;
            expect(allowed).toBeInstanceOf(Set);
            expect(allowed.size).toBe(0);
        });

        test('SECURITY: cmsAllowedPurposeOfUse contains only the configured codes and rejects membership for anything else', () => {
            setEnv('CMS_ALLOWED_PURPOSE_OF_USE', 'PATRQT, TREAT');
            const allowed = new ConfigManager().cmsAllowedPurposeOfUse;
            expect(allowed.has('PATRQT')).toBe(true);
            expect(allowed.has('TREAT')).toBe(true);
            expect(allowed.has('MARKETING')).toBe(false);
            expect(allowed.size).toBe(2);
        });

        test('SECURITY (business-logic §3 Tag Invariants): requireMetaSourceTags defaults to TRUE when unset', () => {
            setEnv('REQUIRE_META_SOURCE_TAGS', undefined);
            expect(new ConfigManager().requireMetaSourceTags).toBe(true);
        });

        test('requireMetaSourceTags can be explicitly disabled with "0" / "false"', () => {
            setEnv('REQUIRE_META_SOURCE_TAGS', '0');
            expect(new ConfigManager().requireMetaSourceTags).toBe(false);
            setEnv('REQUIRE_META_SOURCE_TAGS', 'false');
            expect(new ConfigManager().requireMetaSourceTags).toBe(false);
            setEnv('REQUIRE_META_SOURCE_TAGS', '1');
            expect(new ConfigManager().requireMetaSourceTags).toBe(true);
        });

        test('SECURITY (business-logic §24 Audit Event Requirements): enableAccessAuditEvent defaults to TRUE when unset so audit logging is never silently off', () => {
            setEnv('ENABLE_ACCESS_AUDIT_EVENT', undefined);
            expect(new ConfigManager().enableAccessAuditEvent).toBe(true);
        });

        test('SECURITY (business-logic §26 Access Logging): enableAccessLogsMongoDB defaults to TRUE when unset', () => {
            setEnv('ENABLE_ACCESS_LOGS_MONGODB', undefined);
            expect(new ConfigManager().enableAccessLogsMongoDB).toBe(true);
        });

        test('enableStatsEndpoint defaults to FALSE (admin surface not exposed unless opted in)', () => {
            setEnv('ENABLE_STATS_ENDPOINT', undefined);
            expect(new ConfigManager().enableStatsEndpoint).toBe(false);
            setEnv('ENABLE_STATS_ENDPOINT', '1');
            expect(new ConfigManager().enableStatsEndpoint).toBe(true);
        });

        test('enableDelegatedAccessDetection defaults to FALSE when unset and for "false"', () => {
            setEnv('ENABLE_DELEGATED_ACCESS_DETECTION', undefined);
            expect(new ConfigManager().enableDelegatedAccessDetection).toBe(false);
            setEnv('ENABLE_DELEGATED_ACCESS_DETECTION', 'false');
            expect(new ConfigManager().enableDelegatedAccessDetection).toBe(false);
            setEnv('ENABLE_DELEGATED_ACCESS_DETECTION', 'true');
            expect(new ConfigManager().enableDelegatedAccessDetection).toBe(true);
        });

        test('documented, intentional: enforcePersonLinkAssuranceMinimum defaults to FALSE and logPersonLinkAssuranceBelowMinimum defaults to FALSE', () => {
            setEnv('ENFORCE_PERSON_LINK_ASSURANCE_MINIMUM', undefined);
            setEnv('LOG_PERSON_LINK_ASSURANCE_BELOW_MINIMUM', undefined);
            const cm = new ConfigManager();
            expect(cm.enforcePersonLinkAssuranceMinimum).toBe(false);
            expect(cm.logPersonLinkAssuranceBelowMinimum).toBe(false);
        });

        test('personLinkAssuranceMinimumLevel falls back to DEFAULT_ASSURANCE_MINIMUM_LEVEL and honours an override', () => {
            setEnv('PERSON_LINK_ASSURANCE_MINIMUM_LEVEL', undefined);
            expect(new ConfigManager().personLinkAssuranceMinimumLevel).toBe(DEFAULT_ASSURANCE_MINIMUM_LEVEL);
            setEnv('PERSON_LINK_ASSURANCE_MINIMUM_LEVEL', 'level4');
            expect(new ConfigManager().personLinkAssuranceMinimumLevel).toBe('level4');
        });

        test('handleConcurrency is an INVERTED flag: TRUE when SKIP_HANDLE_CONCURRENCY unset or "false", FALSE only when explicitly skipped', () => {
            setEnv('SKIP_HANDLE_CONCURRENCY', undefined);
            expect(new ConfigManager().handleConcurrency).toBe(true);
            setEnv('SKIP_HANDLE_CONCURRENCY', 'false');
            expect(new ConfigManager().handleConcurrency).toBe(true);
            setEnv('SKIP_HANDLE_CONCURRENCY', '1');
            expect(new ConfigManager().handleConcurrency).toBe(false);
            setEnv('SKIP_HANDLE_CONCURRENCY', 'true');
            expect(new ConfigManager().handleConcurrency).toBe(false);
        });

        test('enableConsentedProaDataAccess is FALSE when unset (consent expansion is opt-in)', () => {
            setEnv('ENABLE_CONSENTED_PROA_DATA_ACCESS', undefined);
            expect(new ConfigManager().enableConsentedProaDataAccess).toBe(false);
        });
    });

    // ======================================================================
    // isTrue() parsing semantics applied to a representative flag
    // ======================================================================

    describe('boolean parsing semantics (isTrue)', () => {
        test('useAccessIndex accepts only "true"/"1" (case-insensitive) and rejects every other string', () => {
            const cases = [
                ['1', true],
                ['true', true],
                ['TRUE', true],
                ['True', true],
                ['0', false],
                ['false', false],
                ['FALSE', false],
                ['yes', false],
                ['on', false],
                ['', false],
                ['2', false]
            ];
            for (const [value, expected] of cases) {
                setEnv('USE_ACCESS_INDEX', value);
                expect([value, new ConfigManager().useAccessIndex]).toEqual([value, expected]);
            }
        });

        test('useAccessIndex is false when the variable is not defined at all', () => {
            setEnv('USE_ACCESS_INDEX', undefined);
            expect(new ConfigManager().useAccessIndex).toBe(false);
        });

        test('a padded value like " 1 " is NOT treated as true (isTrue does not trim) — documents the exact contract', () => {
            setEnv('USE_ACCESS_INDEX', ' 1 ');
            expect(new ConfigManager().useAccessIndex).toBe(false);
        });

        test('useEnvironmentValueForK8sNamespace uses isTrueWithFallback: unset => true, "" => false, "0" => false, "1" => true', () => {
            setEnv('USE_ENVIRONMENT_VALUE_FOR_K8S_NAMESPACE', undefined);
            expect(new ConfigManager().useEnvironmentValueForK8sNamespace).toBe(true);
            setEnv('USE_ENVIRONMENT_VALUE_FOR_K8S_NAMESPACE', '');
            expect(new ConfigManager().useEnvironmentValueForK8sNamespace).toBe(false);
            setEnv('USE_ENVIRONMENT_VALUE_FOR_K8S_NAMESPACE', '0');
            expect(new ConfigManager().useEnvironmentValueForK8sNamespace).toBe(false);
            setEnv('USE_ENVIRONMENT_VALUE_FOR_K8S_NAMESPACE', '1');
            expect(new ConfigManager().useEnvironmentValueForK8sNamespace).toBe(true);
        });

        test('logUpdatedMergeValidations uses isTrueWithFallback with a TRUE fallback', () => {
            setEnv('LOG_UPDATED_MERGE_VALIDATION_ERRORS', undefined);
            expect(new ConfigManager().logUpdatedMergeValidations).toBe(true);
            setEnv('LOG_UPDATED_MERGE_VALIDATION_ERRORS', '0');
            expect(new ConfigManager().logUpdatedMergeValidations).toBe(false);
        });

        test('supportLegacyIds / rewritePatientReference / enableHistoryToCloudStorageMigration all default TRUE and flip on "0"', () => {
            setEnv('SUPPORT_LEGACY_IDS', undefined);
            setEnv('REWRITE_PATIENT_REFERENCE', undefined);
            setEnv('ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION', undefined);
            let cm = new ConfigManager();
            expect([cm.supportLegacyIds, cm.rewritePatientReference, cm.enableHistoryToCloudStorageMigration])
                .toEqual([true, true, true]);

            setEnv('SUPPORT_LEGACY_IDS', '0');
            setEnv('REWRITE_PATIENT_REFERENCE', '0');
            setEnv('ENABLE_HISTORY_TO_CLOUD_STORAGE_MIGRATION', '0');
            cm = new ConfigManager();
            expect([cm.supportLegacyIds, cm.rewritePatientReference, cm.enableHistoryToCloudStorageMigration])
                .toEqual([false, false, false]);
        });

        test('enableGraphQLV2 / enableGraphQLV2Playground / enableMcp default FALSE; enableGraphQLPlayground defaults TRUE', () => {
            setEnv('ENABLE_GRAPHQLV2', undefined);
            setEnv('ENABLE_GRAPHQLV2_PLAYGROUND', undefined);
            setEnv('ENABLE_MCP', undefined);
            setEnv('ENABLE_GRAPHQL_PLAYGROUND', undefined);
            const cm = new ConfigManager();
            expect(cm.enableGraphQLV2).toBe(false);
            expect(cm.enableGraphQLV2Playground).toBe(false);
            expect(cm.enableMcp).toBe(false);
            expect(cm.enableGraphQLPlayground).toBe(true);
        });

        test('enableAuditEventArchiveRead defaults FALSE and enables on "1"', () => {
            setEnv('AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ', undefined);
            expect(new ConfigManager().enableAuditEventArchiveRead).toBe(false);
            setEnv('AUDIT_EVENT_ONLINE_ARCHIVE_ENABLE_READ', '1');
            expect(new ConfigManager().enableAuditEventArchiveRead).toBe(true);
        });
    });

    // ======================================================================
    // Composite / AND-ed flags
    // ======================================================================

    describe('composite flags', () => {
        test('enableAccessLogsClickHouse requires BOTH ENABLE_ACCESS_LOGS_CLICKHOUSE and ENABLE_CLICKHOUSE', () => {
            const matrix = [
                ['0', '0', false],
                ['1', '0', false],
                ['0', '1', false],
                ['1', '1', true]
            ];
            for (const [logsFlag, chFlag, expected] of matrix) {
                setEnv('ENABLE_ACCESS_LOGS_CLICKHOUSE', logsFlag);
                setEnv('ENABLE_CLICKHOUSE', chFlag);
                expect([logsFlag, chFlag, new ConfigManager().enableAccessLogsClickHouse])
                    .toEqual([logsFlag, chFlag, expected]);
            }
        });

        test('enableAccessLogs is the OR of the Mongo and ClickHouse sinks and is false only when both are off', () => {
            setEnv('ENABLE_ACCESS_LOGS_MONGODB', '0');
            setEnv('ENABLE_ACCESS_LOGS_CLICKHOUSE', '0');
            setEnv('ENABLE_CLICKHOUSE', '0');
            expect(new ConfigManager().enableAccessLogs).toBe(false);

            setEnv('ENABLE_ACCESS_LOGS_CLICKHOUSE', '1');
            setEnv('ENABLE_CLICKHOUSE', '1');
            expect(new ConfigManager().enableAccessLogs).toBe(true);

            setEnv('ENABLE_ACCESS_LOGS_MONGODB', '1');
            setEnv('ENABLE_ACCESS_LOGS_CLICKHOUSE', '0');
            setEnv('ENABLE_CLICKHOUSE', '0');
            expect(new ConfigManager().enableAccessLogs).toBe(true);
        });

        test('writeToCacheForEverythingOperation and readFromCacheForEverythingOperation require ENABLE_REDIS AND their own flag', () => {
            setEnv('ENABLE_REDIS', '0');
            setEnv('ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION', '1');
            setEnv('ENABLE_REDIS_CACHE_READ_FOR_EVERYTHING_OPERATION', '1');
            let cm = new ConfigManager();
            expect(cm.writeToCacheForEverythingOperation).toBe(false);
            expect(cm.readFromCacheForEverythingOperation).toBe(false);

            setEnv('ENABLE_REDIS', '1');
            cm = new ConfigManager();
            expect(cm.writeToCacheForEverythingOperation).toBe(true);
            expect(cm.readFromCacheForEverythingOperation).toBe(true);

            setEnv('ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION', '0');
            expect(new ConfigManager().writeToCacheForEverythingOperation).toBe(false);
        });

        test('writeToCacheForSummaryOperation / readFromCacheForSummaryOperation follow the same AND rule', () => {
            setEnv('ENABLE_REDIS', '1');
            setEnv('ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION', '1');
            setEnv('ENABLE_REDIS_CACHE_READ_FOR_SUMMARY_OPERATION', '0');
            const cm = new ConfigManager();
            expect(cm.writeToCacheForSummaryOperation).toBe(true);
            expect(cm.readFromCacheForSummaryOperation).toBe(false);
        });
    });

    // ======================================================================
    // Numeric getters — set / unset / empty / malformed
    // ======================================================================

    describe('numeric getters', () => {
        test('trustProxyHopCount: unset/empty/negative/non-integer/garbage all fall back to 20; valid + padded integers parse', () => {
            const cases = [
                [undefined, 20],
                ['', 20],
                ['   ', 20],
                ['abc', 20],
                ['-1', 20],
                ['2.5', 20],
                ['0', 0],
                ['3', 3],
                ['  7  ', 7]
            ];
            for (const [value, expected] of cases) {
                setEnv('TRUST_PROXY_HOP_COUNT', value);
                expect([String(value), new ConfigManager().trustProxyHopCount])
                    .toEqual([String(value), expected]);
            }
        });

        test('requestTimeoutMs converts EXTERNAL_REQUEST_TIMEOUT_SEC to ms and defaults to 30000', () => {
            setEnv('EXTERNAL_REQUEST_TIMEOUT_SEC', undefined);
            expect(new ConfigManager().requestTimeoutMs).toBe(30000);
            setEnv('EXTERNAL_REQUEST_TIMEOUT_SEC', '5');
            expect(new ConfigManager().requestTimeoutMs).toBe(5000);
            setEnv('EXTERNAL_REQUEST_TIMEOUT_SEC', 'abc');
            expect(new ConfigManager().requestTimeoutMs).toBe(30000);
        });

        test('externalRequestTimeoutSec defaults to 30 and parses an integer prefix', () => {
            setEnv('EXTERNAL_REQUEST_TIMEOUT_SEC', undefined);
            expect(new ConfigManager().externalRequestTimeoutSec).toBe(30);
            setEnv('EXTERNAL_REQUEST_TIMEOUT_SEC', '45');
            expect(new ConfigManager().externalRequestTimeoutSec).toBe(45);
        });

        test('bulkImport size/count getters reject 0, negatives and garbage, falling back to their documented defaults', () => {
            const specs = [
                ['BULK_IMPORT_MAX_FILES_PER_REQUEST', 'bulkImportMaxFilesPerRequest', 100],
                ['BULK_IMPORT_RANGE_SIZE_MB', 'bulkImportRangeSizeMb', 100],
                ['BULK_IMPORT_MIN_FILE_SIZE_MB', 'bulkImportMinFileSizeMb', 50],
                ['BULK_IMPORT_MAX_FILE_SIZE_GB', 'bulkImportMaxFileSizeGb', 5],
                ['BULK_IMPORT_MAX_LINE_SIZE_MB', 'bulkImportMaxLineSizeMb', 16],
                ['BULK_IMPORT_BATCH_SIZE', 'bulkImportBatchSize', 100]
            ];
            for (const [envKey, getter, fallback] of specs) {
                for (const bad of [undefined, '', '0', '-3', 'abc']) {
                    setEnv(envKey, bad);
                    expect([getter, String(bad), new ConfigManager()[getter]])
                        .toEqual([getter, String(bad), fallback]);
                }
                setEnv(envKey, '7');
                expect([getter, new ConfigManager()[getter]]).toEqual([getter, 7]);
            }
        });

        test('bulkImportBatchDelayMs allows 0 (unlike the >0 guards) but rejects negatives and garbage', () => {
            setEnv('BULK_IMPORT_BATCH_DELAY_MS', '0');
            expect(new ConfigManager().bulkImportBatchDelayMs).toBe(0);
            setEnv('BULK_IMPORT_BATCH_DELAY_MS', '250');
            expect(new ConfigManager().bulkImportBatchDelayMs).toBe(250);
            setEnv('BULK_IMPORT_BATCH_DELAY_MS', '-1');
            expect(new ConfigManager().bulkImportBatchDelayMs).toBe(0);
            setEnv('BULK_IMPORT_BATCH_DELAY_MS', 'abc');
            expect(new ConfigManager().bulkImportBatchDelayMs).toBe(0);
            setEnv('BULK_IMPORT_BATCH_DELAY_MS', undefined);
            expect(new ConfigManager().bulkImportBatchDelayMs).toBe(0);
        });

        test('groupMemberLimit and groupPatchOperationsLimit use the `|| default-string` form so "" falls back but "0" does not', () => {
            setEnv('MAX_GROUP_MEMBERS_PER_PUT', undefined);
            setEnv('GROUP_PATCH_OPERATIONS_LIMIT', undefined);
            let cm = new ConfigManager();
            expect(cm.groupMemberLimit).toBe(50000);
            expect(cm.groupPatchOperationsLimit).toBe(10000);

            setEnv('MAX_GROUP_MEMBERS_PER_PUT', '');
            expect(new ConfigManager().groupMemberLimit).toBe(50000);

            setEnv('MAX_GROUP_MEMBERS_PER_PUT', '0');
            expect(new ConfigManager().groupMemberLimit).toBe(0);

            setEnv('MAX_GROUP_MEMBERS_PER_PUT', '25');
            setEnv('GROUP_PATCH_OPERATIONS_LIMIT', '9');
            cm = new ConfigManager();
            expect(cm.groupMemberLimit).toBe(25);
            expect(cm.groupPatchOperationsLimit).toBe(9);
        });

        test('auditEventMaxRangePeriod defaults to 30, honours "0", and parses a configured value', () => {
            setEnv('AUDIT_EVENT_MAX_RANGE_PERIOD', undefined);
            expect(new ConfigManager().auditEventMaxRangePeriod).toBe(30);
            setEnv('AUDIT_EVENT_MAX_RANGE_PERIOD', '');
            expect(new ConfigManager().auditEventMaxRangePeriod).toBe(30);
            setEnv('AUDIT_EVENT_MAX_RANGE_PERIOD', '0');
            expect(new ConfigManager().auditEventMaxRangePeriod).toBe(0);
            setEnv('AUDIT_EVENT_MAX_RANGE_PERIOD', '240');
            expect(new ConfigManager().auditEventMaxRangePeriod).toBe(240);
        });

        test('auditEventMaxSizeBytes defaults to 16 MiB and maxIdsPerAuditEvent defaults to 1000', () => {
            setEnv('AUDIT_EVENT_MAX_SIZE_BYTES', undefined);
            setEnv('AUDIT_MAX_NUMBER_OF_IDS', undefined);
            const cm = new ConfigManager();
            expect(cm.auditEventMaxSizeBytes).toBe(16 * 1024 * 1024);
            expect(cm.maxIdsPerAuditEvent).toBe(1000);

            setEnv('AUDIT_EVENT_MAX_SIZE_BYTES', '1048576');
            setEnv('AUDIT_MAX_NUMBER_OF_IDS', '50');
            const cm2 = new ConfigManager();
            expect(cm2.auditEventMaxSizeBytes).toBe(1048576);
            expect(cm2.maxIdsPerAuditEvent).toBe(50);
        });

        test('cacheExpiryTime falls back to DEFAULT_CACHE_EXPIRY_TIME and parses an override', () => {
            setEnv('CACHE_EXPIRY_TIME', undefined);
            expect(new ConfigManager().cacheExpiryTime).toBe(DEFAULT_CACHE_EXPIRY_TIME);
            setEnv('CACHE_EXPIRY_TIME', '1000');
            expect(new ConfigManager().cacheExpiryTime).toBe(1000);
        });

        test('everythingCacheTtlSeconds and summaryCacheTtlSeconds default to 300 and parse overrides', () => {
            setEnv('EVERYTHING_CACHE_TTL_SECONDS', undefined);
            setEnv('SUMMARY_CACHE_TTL_SECONDS', undefined);
            let cm = new ConfigManager();
            expect(cm.everythingCacheTtlSeconds).toBe(300);
            expect(cm.summaryCacheTtlSeconds).toBe(300);

            setEnv('EVERYTHING_CACHE_TTL_SECONDS', '600');
            setEnv('SUMMARY_CACHE_TTL_SECONDS', '900');
            cm = new ConfigManager();
            expect(cm.everythingCacheTtlSeconds).toBe(600);
            expect(cm.summaryCacheTtlSeconds).toBe(900);
        });

        test('everythingMaxParallelProcess defaults to 10 and treats "0" as unset (|| fallback)', () => {
            setEnv('EVERYTHING_MAX_PARALLEL_PROCESS', undefined);
            expect(new ConfigManager().everythingMaxParallelProcess).toBe(10);
            setEnv('EVERYTHING_MAX_PARALLEL_PROCESS', '0');
            expect(new ConfigManager().everythingMaxParallelProcess).toBe(10);
            setEnv('EVERYTHING_MAX_PARALLEL_PROCESS', '4');
            expect(new ConfigManager().everythingMaxParallelProcess).toBe(4);
        });

        test('mongo timeouts, pool-adjacent and access-log size limits resolve to their documented defaults when unset', () => {
            for (const key of [
                'MONGO_TIMEOUT', 'MONGO_STREAMING_TIMEOUT',
                'ACCESS_LOG_REQUEST_BODY_SIZE_LIMIT', 'ACCESS_LOG_RESULT_SIZE_LIMIT',
                'NO_OF_REQUESTS_PER_POD', 'MONGO_IN_QUERY_BATCH_SIZE',
                'CLOUD_STORAGE_BATCH_DOWNLOAD_SIZE', 'HISTORY_CRON_JOB_MIGRATION_LIMIT'
            ]) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.mongoTimeout).toBe(2 * 60 * 1000);
            expect(cm.mongoStreamingTimeout).toBe(60 * 60 * 1000);
            expect(cm.accessLogRequestBodyLimit).toBe(7 * 1024 * 1024);
            expect(cm.accessLogResultLimit).toBe(7 * 1024 * 1024);
            expect(cm.noOfRequestsPerPod).toBe(1000);
            expect(cm.mongoInQueryIdBatchSize).toBe(100);
            expect(cm.cloudStorageBatchDownloadSize).toBe(100);
            expect(cm.historyResourceCronJobMigrationLimit).toBe(100000);
        });

        test('clickHouse connection getters fall back to DEFAULT_CLICKHOUSE and parse overrides', () => {
            for (const key of [
                'CLICKHOUSE_HOST', 'CLICKHOUSE_PORT', 'CLICKHOUSE_DATABASE',
                'CLICKHOUSE_USERNAME', 'CLICKHOUSE_PASSWORD',
                'CLICKHOUSE_REQUEST_TIMEOUT', 'CLICKHOUSE_MAX_CONNECTIONS'
            ]) {
                setEnv(key, undefined);
            }
            let cm = new ConfigManager();
            expect(cm.clickHouseHost).toBe(DEFAULT_CLICKHOUSE.HOST);
            expect(cm.clickHousePort).toBe(DEFAULT_CLICKHOUSE.PORT);
            expect(cm.clickHouseDatabase).toBe(DEFAULT_CLICKHOUSE.DATABASE);
            expect(cm.clickHouseUsername).toBe(DEFAULT_CLICKHOUSE.USERNAME);
            expect(cm.clickHousePassword).toBe(DEFAULT_CLICKHOUSE.PASSWORD);
            expect(cm.clickHouseRequestTimeout).toBe(DEFAULT_CLICKHOUSE.REQUEST_TIMEOUT_MS);
            expect(cm.clickHouseMaxConnections).toBe(DEFAULT_CLICKHOUSE.MAX_CONNECTIONS);

            setEnv('CLICKHOUSE_HOST', 'clickhouse.internal');
            setEnv('CLICKHOUSE_PORT', '9000');
            setEnv('CLICKHOUSE_MAX_CONNECTIONS', '25');
            cm = new ConfigManager();
            expect(cm.clickHouseHost).toBe('clickhouse.internal');
            expect(cm.clickHousePort).toBe(9000);
            expect(cm.clickHouseMaxConnections).toBe(25);
        });

        test('accessHistoryBatchSize and accessHistoryMaxParallelProcess use `|| default-string` defaults', () => {
            setEnv('ACCESS_HISTORY_BATCH_SIZE', undefined);
            setEnv('ACCESS_HISTORY_MAX_PARALLEL_PROCESS', undefined);
            let cm = new ConfigManager();
            expect(cm.accessHistoryBatchSize).toBe(10000);
            expect(cm.accessHistoryMaxParallelProcess).toBe(10);

            setEnv('ACCESS_HISTORY_BATCH_SIZE', '500');
            setEnv('ACCESS_HISTORY_MAX_PARALLEL_PROCESS', '2');
            cm = new ConfigManager();
            expect(cm.accessHistoryBatchSize).toBe(500);
            expect(cm.accessHistoryMaxParallelProcess).toBe(2);
        });

        test('base64FieldDataThresholdKB defaults to 64 KB and parses an override', () => {
            setEnv('BASE64_FIELD_DATA_THRESHOLD_KB', undefined);
            expect(new ConfigManager().base64FieldDataThresholdKB).toBe(64);
            setEnv('BASE64_FIELD_DATA_THRESHOLD_KB', '256');
            expect(new ConfigManager().base64FieldDataThresholdKB).toBe(256);
        });

        test('cloud storage client retry/timeout getters resolve to their documented defaults', () => {
            setEnv('CLOUD_STORAGE_CLIENT_MAX_RETRY', undefined);
            setEnv('CLOUD_STORAGE_CLIENT_REQUEST_TIMEOUT', undefined);
            setEnv('CLOUD_STORAGE_CLIENT_CONNECTION_TIMEOUT', undefined);
            const cm = new ConfigManager();
            expect(cm.cloudStorageClientMaxRetry).toBe(3);
            expect(cm.cloudStorageClientRequestTimeout).toBe(10 * 1000);
            expect(cm.cloudStorageClientConnectionTimeout).toBe(5 * 1000);
        });

        test('batchSizeForRemoteFhir, mergeParallelChunkSize, postRequestBatchSize and graphQLFetchResourceBatchSize defaults', () => {
            setEnv('REMOTE_FHIR_REQUEST_BATCH_SIZE', undefined);
            setEnv('MERGE_PARALLEL_CHUNK_SIZE', undefined);
            setEnv('POST_REQUEST_BATCH_SIZE', undefined);
            setEnv('GRAPHQL_FETCH_RESOURCE_BATCH_SIZE', undefined);
            const cm = new ConfigManager();
            expect(cm.batchSizeForRemoteFhir).toBe(10);
            expect(cm.mergeParallelChunkSize).toBe(50);
            expect(cm.postRequestBatchSize).toBe(50);
            expect(cm.graphQLFetchResourceBatchSize).toBe(50);
        });
    });

    describe('everythingBatchSize', () => {
        test('everythingBatchSize falls back to 10 when nothing is configured (documents the current default)', () => {
            setEnv('EVERYTHING_BATCH_SZIE', undefined);
            setEnv('EVERYTHING_BATCH_SIZE', undefined);
            expect(new ConfigManager().everythingBatchSize).toBe(10);
        });
    });

    // ======================================================================
    // List / Set getters
    // ======================================================================

    describe('list and set getters', () => {
        test('_parseCommaSeparatedList trims entries, returns the default for undefined/empty, and keeps a single value', () => {
            expect(configManager._parseCommaSeparatedList('a , b ,c', ['x'])).toEqual(['a', 'b', 'c']);
            expect(configManager._parseCommaSeparatedList(undefined, ['x'])).toEqual(['x']);
            expect(configManager._parseCommaSeparatedList('', ['x'])).toEqual(['x']);
            expect(configManager._parseCommaSeparatedList('only')).toEqual(['only']);
            expect(configManager._parseCommaSeparatedList(undefined)).toEqual([]);
        });

        test('requiredFiltersForAuditEvent returns null when unset and a trimmed list when set', () => {
            setEnv('REQUIRED_AUDIT_EVENT_FILTERS', undefined);
            expect(new ConfigManager().requiredFiltersForAuditEvent).toBeNull();
            setEnv('REQUIRED_AUDIT_EVENT_FILTERS', '');
            expect(new ConfigManager().requiredFiltersForAuditEvent).toBeNull();
            setEnv('REQUIRED_AUDIT_EVENT_FILTERS', ' date , agent ');
            expect(new ConfigManager().requiredFiltersForAuditEvent).toEqual(['date', 'agent']);
        });

        test('kafkaEnabledResources defaults to [Consent, ExportStatus] and is fully replaced when configured', () => {
            setEnv('KAFKA_ENABLED_RESOURCES', undefined);
            expect(new ConfigManager().kafkaEnabledResources).toEqual(['Consent', 'ExportStatus']);
            setEnv('KAFKA_ENABLED_RESOURCES', ' Patient , Observation ');
            expect(new ConfigManager().kafkaEnabledResources).toEqual(['Patient', 'Observation']);
        });

        test('consent list getters default to [proa] / [dataSharing] / [DATA_SHARING_ACCESS code]', () => {
            setEnv('CONSENT_CONNECTION_TYPES_LIST', undefined);
            setEnv('DATA_SHARING_CONSENT_CODES', undefined);
            setEnv('DATA_SHARING_ACCESS_CONSENT_CODES', undefined);
            const cm = new ConfigManager();
            expect(cm.getConsentConnectionTypesList).toEqual(['proa']);
            expect(cm.getDataSharingConsentCodes).toEqual(['dataSharing']);
            expect(cm.dataSharingAccessCodes).toEqual([CONSENT_CATEGORY.DATA_SHARING_ACCESS.CODE]);
        });

        test('cloudStorageHistoryResources defaults to [Binary] and historyResourceMongodbFields to the 4 metadata paths', () => {
            setEnv('CLOUD_STORAGE_HISTORY_RESOURCES', undefined);
            setEnv('HISTORY_RESOURCE_MONGODB_FIELDS', undefined);
            const cm = new ConfigManager();
            expect(cm.cloudStorageHistoryResources).toEqual(['Binary']);
            expect(cm.historyResourceMongodbFields).toEqual([
                'id', 'resource._uuid', 'resource._sourceId', 'resource.meta'
            ]);
        });

        test('resourceTypesForUnclassifiedTagging returns an empty Set when unset (feature disabled) and a populated Set when configured', () => {
            setEnv('UNCLASSIFIED_TAGGING_RESOURCES', undefined);
            expect(new ConfigManager().resourceTypesForUnclassifiedTagging.size).toBe(0);
            setEnv('UNCLASSIFIED_TAGGING_RESOURCES', 'Observation, Condition');
            const tagged = new ConfigManager().resourceTypesForUnclassifiedTagging;
            expect(tagged.has('Observation')).toBe(true);
            expect(tagged.has('Condition')).toBe(true);
            expect(tagged.has('Patient')).toBe(false);
        });

        test('kafkaBrokers / kafkaV2Brokers / externalAuthJwksUrls split on comma and return [] when unset', () => {
            setEnv('KAFKA_URLS', undefined);
            setEnv('KAFKA_V2_URLS', undefined);
            setEnv('EXTERNAL_AUTH_JWKS_URLS', undefined);
            let cm = new ConfigManager();
            expect(cm.kafkaBrokers).toEqual([]);
            expect(cm.kafkaV2Brokers).toEqual([]);
            expect(cm.externalAuthJwksUrls).toEqual([]);

            setEnv('KAFKA_URLS', 'b1:9092,b2:9092');
            setEnv('KAFKA_V2_URLS', 'v1:9092');
            cm = new ConfigManager();
            expect(cm.kafkaBrokers).toEqual(['b1:9092', 'b2:9092']);
            expect(cm.kafkaV2Brokers).toEqual(['v1:9092']);
        });

        test('kafka v2 defaults: client id fhir-server, scram-sha-512 mechanism, us-east-1 region, null credentials, auth type ""', () => {
            for (const key of [
                'KAFKA_V2_CLIENT_ID', 'KAFKA_V2_SASL_MECHANISM', 'KAFKA_V2_AWS_REGION',
                'KAFKA_V2_SASL_USERNAME', 'KAFKA_V2_SASL_PASSWORD', 'KAFKA_V2_AUTH_TYPE',
                'ENABLE_EVENTS_KAFKA_V2', 'KAFKA_V2_SSL', 'KAFKA_V2_SASL'
            ]) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.kafkaV2ClientId).toBe('fhir-server');
            expect(cm.kafkaV2AuthMechanism).toBe('scram-sha-512');
            expect(cm.kafkaV2AwsRegion).toBe('us-east-1');
            expect(cm.kafkaV2UserName).toBeNull();
            expect(cm.kafkaV2Password).toBeNull();
            expect(cm.kafkaV2AuthType).toBe('');
            expect(cm.kafkaV2EnableEvents).toBe(false);
            expect(cm.kafkaV2UseSsl).toBe(false);
            expect(cm.kafkaV2UseSasl).toBe(false);
        });

        test('bulk import kafka topics and consumer group ids fall back to their documented names', () => {
            for (const key of [
                'KAFKA_BULK_IMPORT_EVENT_TOPIC', 'BULK_IMPORT_CONSUMER_GROUP_ID',
                'KAFKA_BULK_IMPORT_TASK_CREATED_TOPIC', 'BULK_IMPORT_ORCHESTRATOR_GROUP_ID',
                'BULK_IMPORT_RANGE_PROGRESS_GROUP_ID', 'KAFKA_BULK_IMPORT_RANGE_PROGRESS_TOPIC'
            ]) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.kafkaBulkImportEventTopic).toBe('fhir_server.bulk_import.events');
            expect(cm.bulkImportConsumerGroupId).toBe('fhir-bulk-import-consumer');
            expect(cm.kafkaBulkImportTaskCreatedTopic).toBe('fhir_server.bulk_import.requested');
            expect(cm.bulkImportOrchestratorGroupId).toBe('fhir-bulk-import-orchestrator');
            expect(cm.bulkImportRangeProgressGroupId).toBe('fhir-bulk-import-range-progress');
            expect(cm.kafkaBulkImportRangeProgressTopic).toBe('fhir_server.bulk_import.processing.events');
        });

        test('patient/person data change event topics and flags default correctly', () => {
            for (const key of [
                'PATIENT_DATA_CHANGE_EVENT_TOPIC', 'PERSON_DATA_CHANGE_EVENT_TOPIC',
                'ENABLE_PATIENT_DATA_CHANGE_EVENTS', 'ENABLE_PERSON_DATA_CHANGE_EVENTS'
            ]) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.patientDataChangeEventTopic).toBe('fhir.patient_data.change.events');
            expect(cm.personDataChangeEventTopic).toBe('fhir.person_data.change.events');
            expect(cm.enablePatientDataChangeEvents).toBe(false);
            expect(cm.enablePersonDataChangeEvents).toBe(false);
        });
    });

    // ======================================================================
    // Parameterized methods
    // ======================================================================

    describe('accessTagsIndexed(resourceType)', () => {
        test('returns only the base list for a resource type with no per-type override', () => {
            setEnv('ACCESS_TAGS_INDEXED', ' base1 , base2 ');
            setEnv('ACCESS_TAGS_INDEXED_ENCOUNTER', 'enc1');
            expect(new ConfigManager().accessTagsIndexed('Observation')).toEqual(['base1', 'base2']);
        });

        test('appends the per-resource list for each of the 7 supported resource types and never cross-contaminates', () => {
            setEnv('ACCESS_TAGS_INDEXED', 'base');
            setEnv('ACCESS_TAGS_INDEXED_ENCOUNTER', 'enc');
            setEnv('ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT', 'eob');
            setEnv('ACCESS_TAGS_INDEXED_LOCATION', 'loc');
            setEnv('ACCESS_TAGS_INDEXED_ORGANIZATION', 'org');
            setEnv('ACCESS_TAGS_INDEXED_PERSON', 'per');
            setEnv('ACCESS_TAGS_INDEXED_PRACTITIONER', 'prac');
            setEnv('ACCESS_TAGS_INDEXED_PRACTITIONER_ROLE', 'pracrole');
            const cm = new ConfigManager();
            expect(cm.accessTagsIndexed('Encounter')).toEqual(['base', 'enc']);
            expect(cm.accessTagsIndexed('ExplanationOfBenefit')).toEqual(['base', 'eob']);
            expect(cm.accessTagsIndexed('Location')).toEqual(['base', 'loc']);
            expect(cm.accessTagsIndexed('Organization')).toEqual(['base', 'org']);
            expect(cm.accessTagsIndexed('Person')).toEqual(['base', 'per']);
            expect(cm.accessTagsIndexed('Practitioner')).toEqual(['base', 'prac']);
            expect(cm.accessTagsIndexed('PractitionerRole')).toEqual(['base', 'pracrole']);
        });

        test('returns an empty array (not undefined) when nothing is configured', () => {
            setEnv('ACCESS_TAGS_INDEXED', undefined);
            setEnv('ACCESS_TAGS_INDEXED_PERSON', undefined);
            expect(new ConfigManager().accessTagsIndexed('Person')).toEqual([]);
        });

        test('successive calls do not accumulate into the same array (no shared mutable state)', () => {
            setEnv('ACCESS_TAGS_INDEXED', 'base');
            setEnv('ACCESS_TAGS_INDEXED_PERSON', 'per');
            const cm = new ConfigManager();
            expect(cm.accessTagsIndexed('Person')).toEqual(['base', 'per']);
            expect(cm.accessTagsIndexed('Person')).toEqual(['base', 'per']);
            expect(cm.accessTagsIndexed('Encounter')).toEqual(['base']);
        });
    });

    describe('isAtlasSearchEnabled(resourceType)', () => {
        test('is gated independently per resource type and is false for every unsupported type', () => {
            setEnv('ATLAS_SEARCH_ENABLED_PATIENT', '1');
            setEnv('ATLAS_SEARCH_ENABLED_PERSON', '0');
            setEnv('ATLAS_SEARCH_ENABLED_PRACTITIONER', undefined);
            const cm = new ConfigManager();
            expect(cm.isAtlasSearchEnabled('Patient')).toBe(true);
            expect(cm.isAtlasSearchEnabled('Person')).toBe(false);
            expect(cm.isAtlasSearchEnabled('Practitioner')).toBe(false);
            expect(cm.isAtlasSearchEnabled('Observation')).toBe(false);
            expect(cm.isAtlasSearchEnabled(undefined)).toBe(false);
        });

        test('isAtlasSearchNativeSortEnabled is independent of isAtlasSearchEnabled', () => {
            setEnv('ATLAS_SEARCH_ENABLED_PATIENT', '1');
            setEnv('ATLAS_SEARCH_NATIVE_SORT_ENABLED', undefined);
            expect(new ConfigManager().isAtlasSearchNativeSortEnabled).toBe(false);
            setEnv('ATLAS_SEARCH_NATIVE_SORT_ENABLED', '1');
            expect(new ConfigManager().isAtlasSearchNativeSortEnabled).toBe(true);
        });
    });

    describe('enabledGridFsResources', () => {
        test('returns [] when unset and [DocumentReference] when set to the only supported value', () => {
            setEnv('GRIDFS_RESOURCES', undefined);
            expect(new ConfigManager().enabledGridFsResources).toEqual([]);
            setEnv('GRIDFS_RESOURCES', 'DocumentReference');
            expect(new ConfigManager().enabledGridFsResources).toEqual(['DocumentReference']);
        });

        test('NEGATIVE: throws for an unsupported single resource and for any multi-resource list', () => {
            setEnv('GRIDFS_RESOURCES', 'Binary');
            expect(() => new ConfigManager().enabledGridFsResources)
                .toThrow('Only DocumentReference is supported as a GridFS resource');
            setEnv('GRIDFS_RESOURCES', 'DocumentReference,Binary');
            expect(() => new ConfigManager().enabledGridFsResources)
                .toThrow('Only DocumentReference is supported as a GridFS resource');
        });
    });

    describe('externalServicesWithRestrictions', () => {
        test('returns {} when unset', () => {
            setEnv('EXTERNAL_SERVICES_WITH_REQ_LIMIT', undefined);
            expect(new ConfigManager().externalServicesWithRestrictions).toEqual({});
        });

        test('lowercases the service name, trims both halves and strips a single trailing slash from the url prefix', () => {
            setEnv('EXTERNAL_SERVICES_WITH_REQ_LIMIT', ' MyService | https://api.example.com/v1/ , Other|https://b.example.com/v2');
            expect(new ConfigManager().externalServicesWithRestrictions).toEqual({
                myservice: 'https://api.example.com/v1',
                other: 'https://b.example.com/v2'
            });
        });

        test('maps a service declared without a url prefix to null (so limitReqForExternalServices still matches but sets no prefix)', () => {
            setEnv('EXTERNAL_SERVICES_WITH_REQ_LIMIT', 'plainsvc');
            const config = new ConfigManager().externalServicesWithRestrictions;
            expect(Object.prototype.hasOwnProperty.call(config, 'plainsvc')).toBe(true);
            expect(config.plainsvc).toBeNull();
        });
    });

    describe('plain string getters', () => {
        test('environmentValue / hostnameValue / dockerImageValue / authJwksUrl / authCidCheckIssuer return "" when unset', () => {
            for (const key of ['ENVIRONMENT', 'HOSTNAME', 'DOCKER_IMAGE', 'AUTH_JWKS_URL', 'AUTH_CID_CHECK_ISSUER']) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.environmentValue).toBe('');
            expect(cm.hostnameValue).toBe('');
            expect(cm.dockerImageValue).toBe('');
            expect(cm.authJwksUrl).toBe('');
            expect(cm.authCidCheckIssuer).toBe('');
        });

        test('customIndexesFilePath returns null when unset and the configured path otherwise', () => {
            setEnv('CUSTOM_INDEXES_FILE_PATH', undefined);
            expect(new ConfigManager().customIndexesFilePath).toBeNull();
            setEnv('CUSTOM_INDEXES_FILE_PATH', '/etc/indexes.json');
            expect(new ConfigManager().customIndexesFilePath).toBe('/etc/indexes.json');
        });

        test('defaultSortId, payloadLimit, awsRegion, serverTimeZone, postRequestFlushTime and summary generator identity defaults', () => {
            for (const key of [
                'DEFAULT_SORT_ID', 'PAYLOAD_LIMIT', 'AWS_REGION', 'SERVER_TIME_ZONE',
                'POST_REQUEST_FLUSH_TIME', 'SUMMARY_GENERATOR_ORGANIZATION_NAME',
                'SUMMARY_GENERATOR_ORGANIZATION_ID', 'SUMMARY_GENERATOR_ORGANIZATION_BASE_URL',
                'AUDIT_EVENT_OBSERVER_ORGANIZATION_ID'
            ]) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.defaultSortId).toBe('_uuid');
            expect(cm.payloadLimit).toBe('50mb');
            expect(cm.awsRegion).toBe('us-east-1');
            expect(cm.serverTimeZone).toBe('America/New_York');
            expect(cm.postRequestFlushTime).toBe('*/10 * * * * *');
            expect(cm.summaryGeneratorOrganizationName).toBe('b.well Connected Health');
            expect(cm.summaryGeneratorOrganizationId).toBe('bwell');
            expect(cm.summaryGeneratorOrganizationBaseUrl).toBe('https://bwell.com/summary');
            expect(cm.auditEventObserverOrganizationId).toBe('ecce70a8-f5ff-5562-b28f-dbbc0f543661');
        });

        test('kafka v1 credentials return null when unset and the configured value otherwise; mechanism defaults to aws', () => {
            setEnv('KAFKA_SASL_USERNAME', undefined);
            setEnv('KAFKA_SASL_PASSWORD', undefined);
            setEnv('KAFKA_SASL_MECHANISM', undefined);
            let cm = new ConfigManager();
            expect(cm.kafkaUserName).toBeNull();
            expect(cm.kafkaPassword).toBeNull();
            expect(cm.kafkaAuthMechanism).toBe('aws');

            setEnv('KAFKA_SASL_USERNAME', 'u');
            setEnv('KAFKA_SASL_PASSWORD', 'p');
            setEnv('KAFKA_SASL_MECHANISM', 'scram-sha-512');
            cm = new ConfigManager();
            expect(cm.kafkaUserName).toBe('u');
            expect(cm.kafkaPassword).toBe('p');
            expect(cm.kafkaAuthMechanism).toBe('scram-sha-512');
        });

        test('optional service urls/credentials are undefined (not "") when unset', () => {
            for (const key of [
                'PERSON_MATCHING_SERVICE_URL', 'PERSON_MATCHING_SERVICE_CLIENT_ID',
                'PERSON_MATCHING_SERVICE_CLIENT_SECRET', 'PERSON_MATCHING_SERVICE_TOKEN_URL',
                'FHIR_VALIDATION_URL', 'BULK_EXPORT_S3_BUCKET_NAME',
                'HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT', 'HISTORY_RESOURCE_BUCKET_NAME',
                'BASE64_FIELD_CLOUD_STORAGE_CLIENT', 'RESOURCE_BUCKET_NAME', 'KAFKA_CLIENT_ID'
            ]) {
                setEnv(key, undefined);
            }
            const cm = new ConfigManager();
            expect(cm.personMatchingServiceUrl).toBeUndefined();
            expect(cm.personMatchingServiceClientId).toBeUndefined();
            expect(cm.personMatchingServiceClientSecret).toBeUndefined();
            expect(cm.personMatchingServiceTokenUrl).toBeUndefined();
            expect(cm.fhirValidationUrl).toBeUndefined();
            expect(cm.bulkExportS3BucketName).toBeUndefined();
            expect(cm.historyResourceCloudStorageClient).toBeUndefined();
            expect(cm.historyResourceBucketName).toBeUndefined();
            expect(cm.base64FieldCloudStorageClient).toBeUndefined();
            expect(cm.resourceBucketName).toBeUndefined();
            expect(cm.kafkaClientId).toBeUndefined();
        });
    });
});
