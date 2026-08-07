const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

describe('ConfigManager', () => {
    let configManager;
    const envKeysModified = new Set();
    const originalValues = {};

    beforeEach(() => {
        configManager = new ConfigManager();
    });

    afterEach(() => {
        // Restore all modified env vars on process.env directly
        for (const key of envKeysModified) {
            if (originalValues[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalValues[key];
            }
        }
        envKeysModified.clear();
    });

    function setEnv(key, value) {
        if (!envKeysModified.has(key)) {
            originalValues[key] = process.env[key];
            envKeysModified.add(key);
        }
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    // ========== _parseCommaSeparatedList ==========
    describe('_parseCommaSeparatedList', () => {
        test('returns parsed array from comma-separated string', () => {
            const result = configManager._parseCommaSeparatedList('a, b, c', []);
            expect(result).toEqual(['a', 'b', 'c']);
        });

        test('returns default value when envVar is undefined', () => {
            const result = configManager._parseCommaSeparatedList(undefined, ['default']);
            expect(result).toEqual(['default']);
        });

        test('returns empty default when envVar is empty string', () => {
            const result = configManager._parseCommaSeparatedList('', []);
            expect(result).toEqual([]);
        });
    });

    // ========== Simple boolean getters ==========
    describe('useAccessIndex', () => {
        test('returns true when env is truthy', () => {
            process.env.USE_ACCESS_INDEX = '1';
            expect(new ConfigManager().useAccessIndex).toBe(true);
        });

        test('returns false when env is falsy', () => {
            delete process.env.USE_ACCESS_INDEX;
            expect(new ConfigManager().useAccessIndex).toBe(false);
        });
    });

    describe('streamResponse', () => {
        test('returns true when STREAM_RESPONSE is set', () => {
            process.env.STREAM_RESPONSE = 'true';
            expect(new ConfigManager().streamResponse).toBe(true);
        });

        test('returns false when not set', () => {
            delete process.env.STREAM_RESPONSE;
            expect(new ConfigManager().streamResponse).toBe(false);
        });
    });

    // ========== requiredFiltersForAuditEvent ==========
    describe('requiredFiltersForAuditEvent', () => {
        test('returns null when env not set', () => {
            delete process.env.REQUIRED_AUDIT_EVENT_FILTERS;
            expect(new ConfigManager().requiredFiltersForAuditEvent).toBeNull();
        });

        test('returns array of trimmed values', () => {
            process.env.REQUIRED_AUDIT_EVENT_FILTERS = 'date, agent';
            expect(new ConfigManager().requiredFiltersForAuditEvent).toEqual(['date', 'agent']);
        });
    });

    // ========== auditEventMaxRangePeriod ==========
    describe('auditEventMaxRangePeriod', () => {
        test('returns default 30 when not set', () => {
            delete process.env.AUDIT_EVENT_MAX_RANGE_PERIOD;
            expect(new ConfigManager().auditEventMaxRangePeriod).toBe(30);
        });

        test('returns configured value', () => {
            process.env.AUDIT_EVENT_MAX_RANGE_PERIOD = '60';
            expect(new ConfigManager().auditEventMaxRangePeriod).toBe(60);
        });
    });

    // ========== environmentValue ==========
    describe('environmentValue', () => {
        test('returns empty string when not set', () => {
            delete process.env.ENVIRONMENT;
            expect(new ConfigManager().environmentValue).toBe('');
        });

        test('returns env value', () => {
            process.env.ENVIRONMENT = 'staging';
            expect(new ConfigManager().environmentValue).toBe('staging');
        });
    });

    // ========== accessTagsIndexed (large method with switch) ==========
    describe('accessTagsIndexed', () => {
        test('returns empty array when no env vars set', () => {
            delete process.env.ACCESS_TAGS_INDEXED;
            delete process.env.ACCESS_TAGS_INDEXED_ENCOUNTER;
            const result = new ConfigManager().accessTagsIndexed('Patient');
            expect(result).toEqual([]);
        });

        test('returns base tags for unknown resource type', () => {
            process.env.ACCESS_TAGS_INDEXED = 'tag1, tag2';
            const result = new ConfigManager().accessTagsIndexed('Observation');
            expect(result).toEqual(['tag1', 'tag2']);
        });

        test('appends Encounter-specific tags', () => {
            process.env.ACCESS_TAGS_INDEXED = 'base';
            process.env.ACCESS_TAGS_INDEXED_ENCOUNTER = 'enc1, enc2';
            const result = new ConfigManager().accessTagsIndexed('Encounter');
            expect(result).toEqual(['base', 'enc1', 'enc2']);
        });

        test('appends Person-specific tags', () => {
            process.env.ACCESS_TAGS_INDEXED = 'base';
            process.env.ACCESS_TAGS_INDEXED_PERSON = 'per1';
            const result = new ConfigManager().accessTagsIndexed('Person');
            expect(result).toEqual(['base', 'per1']);
        });

        test('appends ExplanationOfBenefit-specific tags', () => {
            process.env.ACCESS_TAGS_INDEXED = 'base';
            process.env.ACCESS_TAGS_INDEXED_EXPLANATIONOFBENEFIT = 'eob1';
            const result = new ConfigManager().accessTagsIndexed('ExplanationOfBenefit');
            expect(result).toEqual(['base', 'eob1']);
        });
    });

    // ========== Kafka config ==========
    describe('kafka config', () => {
        test('kafkaBrokers returns empty array when not set', () => {
            delete process.env.KAFKA_URLS;
            expect(new ConfigManager().kafkaBrokers).toEqual([]);
        });

        test('kafkaBrokers returns split URLs', () => {
            process.env.KAFKA_URLS = 'broker1:9092,broker2:9092';
            expect(new ConfigManager().kafkaBrokers).toEqual(['broker1:9092', 'broker2:9092']);
        });

        test('kafkaAuthMechanism defaults to aws', () => {
            delete process.env.KAFKA_SASL_MECHANISM;
            expect(new ConfigManager().kafkaAuthMechanism).toBe('aws');
        });

        test('kafkaEnabledResources defaults to Consent and ExportStatus', () => {
            delete process.env.KAFKA_ENABLED_RESOURCES;
            expect(new ConfigManager().kafkaEnabledResources).toEqual(['Consent', 'ExportStatus']);
        });
    });

    // ========== Auth config getters ==========
    describe('auth config', () => {
        test('authJwksUrl returns empty string when not set', () => {
            delete process.env.AUTH_JWKS_URL;
            expect(new ConfigManager().authJwksUrl).toBe('');
        });

        test('externalAuthJwksUrls splits comma-separated URLs', () => {
            process.env.EXTERNAL_AUTH_JWKS_URLS = 'url1,url2';
            expect(new ConfigManager().externalAuthJwksUrls).toEqual(['url1', 'url2']);
        });

        test('externalAuthJwksUrls returns empty array when not set', () => {
            delete process.env.EXTERNAL_AUTH_JWKS_URLS;
            expect(new ConfigManager().externalAuthJwksUrls).toEqual([]);
        });

        test('authCustomScope splits comma-separated values', () => {
            process.env.AUTH_CUSTOM_SCOPE = 'scope1,scope2';
            expect(new ConfigManager().authCustomScope).toEqual(['scope1', 'scope2']);
        });

        test('authRemoveScopePrefixes splits on comma', () => {
            process.env.AUTH_REMOVE_SCOPE_PREFIX = 'prefix1,prefix2';
            expect(new ConfigManager().authRemoveScopePrefixes).toEqual(['prefix1', 'prefix2']);
        });

        test('authCidCheckClientIds splits on comma', () => {
            process.env.AUTH_CID_CHECK_CLIENT_IDS = 'cid1,cid2';
            expect(new ConfigManager().authCidCheckClientIds).toEqual(['cid1', 'cid2']);
        });

        // DCON-4882
        test('allowedNonPatientScopeClients returns empty set when not set', () => {
            delete process.env.EXTERNAL_AUTH_ALLOWED_NON_PATIENT_SCOPE_CLIENTS;
            expect(new ConfigManager().allowedNonPatientScopeClients).toEqual(new Set());
        });

        test('allowedNonPatientScopeClients parses comma-separated "iss|client_id" pairs', () => {
            process.env.EXTERNAL_AUTH_ALLOWED_NON_PATIENT_SCOPE_CLIENTS =
                'https://a.example.com|client-a, https://b.example.com|client-b';
            expect(new ConfigManager().allowedNonPatientScopeClients).toEqual(new Set([
                'https://a.example.com|client-a',
                'https://b.example.com|client-b'
            ]));
        });

        test('allowedNonPatientScopeClients ignores malformed entries missing a pipe or client_id', () => {
            process.env.EXTERNAL_AUTH_ALLOWED_NON_PATIENT_SCOPE_CLIENTS =
                'https://a.example.com|client-a, https://no-pipe.example.com, https://c.example.com|';
            expect(new ConfigManager().allowedNonPatientScopeClients).toEqual(new Set([
                'https://a.example.com|client-a'
            ]));
        });
    });

    // ========== supportLegacyIds ==========
    describe('supportLegacyIds', () => {
        test('defaults to true when not set', () => {
            delete process.env.SUPPORT_LEGACY_IDS;
            expect(new ConfigManager().supportLegacyIds).toBe(true);
        });

        test('returns false when set to 0', () => {
            process.env.SUPPORT_LEGACY_IDS = '0';
            expect(new ConfigManager().supportLegacyIds).toBe(false);
        });
    });

    // ========== enabledGridFsResources ==========
    describe('enabledGridFsResources', () => {
        test('returns empty when not set', () => {
            delete process.env.GRIDFS_RESOURCES;
            expect(new ConfigManager().enabledGridFsResources).toEqual([]);
        });

        test('returns DocumentReference', () => {
            process.env.GRIDFS_RESOURCES = 'DocumentReference';
            expect(new ConfigManager().enabledGridFsResources).toEqual(['DocumentReference']);
        });

        test('throws for unsupported resource', () => {
            process.env.GRIDFS_RESOURCES = 'Patient,Observation';
            expect(() => new ConfigManager().enabledGridFsResources).toThrow('Only DocumentReference is supported');
        });
    });

    // ========== Summary/cache config ==========
    describe('summary and cache config', () => {
        test('writeToCacheForSummaryOperation requires both ENABLE_REDIS and write flag', () => {
            process.env.ENABLE_REDIS = '1';
            process.env.ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION = '1';
            expect(new ConfigManager().writeToCacheForSummaryOperation).toBe(true);
        });

        test('writeToCacheForSummaryOperation false without ENABLE_REDIS', () => {
            delete process.env.ENABLE_REDIS;
            process.env.ENABLE_REDIS_CACHE_WRITE_FOR_SUMMARY_OPERATION = '1';
            expect(new ConfigManager().writeToCacheForSummaryOperation).toBe(false);
        });

        test('summaryCacheTtlSeconds defaults to 300', () => {
            delete process.env.SUMMARY_CACHE_TTL_SECONDS;
            expect(new ConfigManager().summaryCacheTtlSeconds).toBe(300);
        });

        test('cacheExpiryTime returns configured value', () => {
            process.env.CACHE_EXPIRY_TIME = '7200000';
            expect(new ConfigManager().cacheExpiryTime).toBe(7200000);
        });

        test('serverTimeZone defaults to America/New_York', () => {
            delete process.env.SERVER_TIME_ZONE;
            expect(new ConfigManager().serverTimeZone).toBe('America/New_York');
        });
    });

    // ========== externalRequestTimeoutSec ==========
    describe('externalRequestTimeoutSec', () => {
        test('defaults to 30', () => {
            delete process.env.EXTERNAL_REQUEST_TIMEOUT_SEC;
            expect(new ConfigManager().externalRequestTimeoutSec).toBe(30);
        });

        test('returns parsed integer', () => {
            process.env.EXTERNAL_REQUEST_TIMEOUT_SEC = '60';
            expect(new ConfigManager().externalRequestTimeoutSec).toBe(60);
        });
    });

    // ========== replaceRetries ==========
    describe('replaceRetries', () => {
        test('defaults to 10', () => {
            delete process.env.REPLACE_RETRIES;
            expect(new ConfigManager().replaceRetries).toBe(10);
        });
    });

    // ========== defaultSortId ==========
    describe('defaultSortId', () => {
        test('defaults to _uuid', () => {
            delete process.env.DEFAULT_SORT_ID;
            expect(new ConfigManager().defaultSortId).toBe('_uuid');
        });

        test('returns configured value', () => {
            process.env.DEFAULT_SORT_ID = '_id';
            expect(new ConfigManager().defaultSortId).toBe('_id');
        });
    });

    // ========== graphBatchSize ==========
    describe('graphBatchSize', () => {
        test('defaults to 10', () => {
            delete process.env.GRAPH_BATCH_SIZE;
            expect(new ConfigManager().graphBatchSize).toBe(10);
        });
    });

    // ========== payloadLimit ==========
    describe('payloadLimit', () => {
        test('defaults to 50mb', () => {
            delete process.env.PAYLOAD_LIMIT;
            expect(new ConfigManager().payloadLimit).toBe('50mb');
        });

        test('returns configured value', () => {
            process.env.PAYLOAD_LIMIT = '100mb';
            expect(new ConfigManager().payloadLimit).toBe('100mb');
        });
    });
});
