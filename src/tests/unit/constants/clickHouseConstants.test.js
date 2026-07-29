'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    CLICKPIPE_KAFKA_TOPIC_PREFIX,
    TABLES,
    OPERATION_TYPES,
    EVENT_TYPES,
    LIMITS,
    QUERY_FORMAT,
    ACCESS_HISTORY_WINDOW_DAYS,
    SECURITY_TAG_SYSTEMS,
    WRITE_STRATEGIES,
    KAFKA_TOPICS,
    RESOURCE_COLUMN_TYPES
} = require('../../../constants/clickHouseConstants');

describe('clickHouseConstants', () => {
    test('CLICKPIPE_KAFKA_TOPIC_PREFIX is fhir_server', () => {
        expect(CLICKPIPE_KAFKA_TOPIC_PREFIX).toBe('fhir_server');
    });

    describe('TABLES', () => {
        test('GROUP_MEMBER_EVENTS uses fhir schema', () => {
            expect(TABLES.GROUP_MEMBER_EVENTS).toContain('fhir.');
        });

        test('AUDIT_EVENT table name', () => {
            expect(TABLES.AUDIT_EVENT).toBe('fhir.AuditEvent_4_0_0');
        });
    });

    describe('OPERATION_TYPES', () => {
        test('has single-char CRUD codes', () => {
            expect(OPERATION_TYPES.CREATE).toBe('C');
            expect(OPERATION_TYPES.UPDATE).toBe('U');
            expect(OPERATION_TYPES.DELETE).toBe('D');
        });
    });

    describe('EVENT_TYPES', () => {
        test('member lifecycle events', () => {
            expect(EVENT_TYPES.MEMBER_ADDED).toBe('added');
            expect(EVENT_TYPES.MEMBER_REMOVED).toBe('removed');
        });
    });

    describe('LIMITS', () => {
        test('DEFAULT_PAGE_SIZE is 100', () => {
            expect(LIMITS.DEFAULT_PAGE_SIZE).toBe(100);
        });

        test('MAX_PAGE_SIZE is 10000', () => {
            expect(LIMITS.MAX_PAGE_SIZE).toBe(10000);
        });

        test('MAX_BATCH_SIZE is 50000', () => {
            expect(LIMITS.MAX_BATCH_SIZE).toBe(50000);
        });

        test('MAX_PATCH_OPERATIONS is 10000', () => {
            expect(LIMITS.MAX_PATCH_OPERATIONS).toBe(10000);
        });

        test('MIN_PAGE_SIZE is 1', () => {
            expect(LIMITS.MIN_PAGE_SIZE).toBe(1);
        });
    });

    test('QUERY_FORMAT has JSONEachRow', () => {
        expect(QUERY_FORMAT.JSON_EACH_ROW).toBe('JSONEachRow');
    });

    test('ACCESS_HISTORY_WINDOW_DAYS is 90', () => {
        expect(ACCESS_HISTORY_WINDOW_DAYS).toBe(90);
    });

    describe('SECURITY_TAG_SYSTEMS', () => {
        test('has standard icanbwell URLs', () => {
            expect(SECURITY_TAG_SYSTEMS.ACCESS).toContain('icanbwell.com/access');
            expect(SECURITY_TAG_SYSTEMS.OWNER).toContain('icanbwell.com/owner');
            expect(SECURITY_TAG_SYSTEMS.SOURCE_ASSIGNING_AUTHORITY).toContain('sourceAssigningAuthority');
        });
    });

    describe('WRITE_STRATEGIES', () => {
        test('has sync-direct and kafka-clickpipe', () => {
            expect(WRITE_STRATEGIES.SYNC_DIRECT).toBe('sync-direct');
            expect(WRITE_STRATEGIES.KAFKA_CLICKPIPE).toBe('kafka-clickpipe');
        });
    });

    describe('KAFKA_TOPICS', () => {
        test('AUDIT_EVENT topic uses prefix', () => {
            expect(KAFKA_TOPICS.AUDIT_EVENT).toBe('fhir_server.resource.AuditEvent_4_0_0');
        });
    });

    describe('RESOURCE_COLUMN_TYPES', () => {
        test('has string and json', () => {
            expect(RESOURCE_COLUMN_TYPES.STRING).toBe('string');
            expect(RESOURCE_COLUMN_TYPES.JSON).toBe('json');
        });
    });
});
