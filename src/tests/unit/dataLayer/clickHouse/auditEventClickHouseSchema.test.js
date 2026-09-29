const { describe, test, expect, jest: jestObj } = require('@jest/globals');

// Mock the AuditEventFieldExtractor since it's a dependency
jestObj.mock('../../../../dataLayer/clickHouse/auditEventFieldExtractor', () => ({
    AuditEventFieldExtractor: class MockAuditEventFieldExtractor {
        extract(resource) { return resource; }
    }
}));

const { getAuditEventClickHouseSchema } = require('../../../../dataLayer/clickHouse/auditEventClickHouseSchema');
const {
    WRITE_STRATEGIES,
    ENGINE_TYPES,
    RESOURCE_COLUMN_TYPES,
    TABLES
} = require('../../../../constants/clickHouseConstants');

describe('getAuditEventClickHouseSchema', () => {
    describe('default parameters', () => {
        let schema;

        test('returns schema with correct table name', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.tableName).toBe(TABLES.AUDIT_EVENT);
            expect(schema.tableName).toBe('fhir.AuditEvent_4_0_0');
        });

        test('uses MergeTree engine', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.engine).toBe(ENGINE_TYPES.MERGE_TREE);
        });

        test('has null versionColumn and dedupKey', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.versionColumn).toBeNull();
            expect(schema.dedupKey).toBeNull();
        });

        test('has correct seekKey', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.seekKey).toEqual(['recorded', '_uuid']);
        });

        test('uses resource as fhirResourceColumn with JSON type', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.fhirResourceColumn).toBe('resource');
            expect(schema.fhirResourceColumnType).toBe(RESOURCE_COLUMN_TYPES.JSON);
        });

        test('defaults to SYNC_DIRECT write strategy', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.writeStrategy).toBe(WRITE_STRATEGIES.SYNC_DIRECT);
        });

        test('defaults kafkaTopic to null', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.kafkaTopic).toBeNull();
        });

        test('has fireChangeEvents set to false', () => {
            schema = getAuditEventClickHouseSchema();
            expect(schema.fireChangeEvents).toBe(false);
        });
    });

    describe('fieldMappings', () => {
        let fieldMappings;

        test('maps recorded to datetime column', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings.recorded).toEqual({ column: 'recorded', type: 'datetime' });
        });

        test('maps action to lowcardinality column', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings.action).toEqual({ column: 'action', type: 'lowcardinality' });
        });

        test('maps agent.who._uuid to array column', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings['agent.who._uuid']).toEqual({ column: 'agent_who', type: 'array<string>' });
        });

        test('maps agent.who._sourceId to JSON path', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings['agent.who._sourceId']).toEqual({
                column: 'resource.agent[].who._sourceId',
                type: 'array<string>',
                jsonPath: true
            });
        });

        test('maps agent.altId to array column', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings['agent.altId']).toEqual({ column: 'agent_altid', type: 'array<string>' });
        });

        test('maps entity.what._uuid to array column', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings['entity.what._uuid']).toEqual({ column: 'entity_what', type: 'array<string>' });
        });

        test('maps entity.what._sourceId to JSON path', () => {
            fieldMappings = getAuditEventClickHouseSchema().fieldMappings;
            expect(fieldMappings['entity.what._sourceId']).toEqual({
                column: 'resource.entity[].what._sourceId',
                type: 'array<string>',
                jsonPath: true
            });
        });
    });

    describe('securityMappings', () => {
        test('maps accessTags to access_tags column', () => {
            const schema = getAuditEventClickHouseSchema();
            expect(schema.securityMappings).toEqual({ accessTags: 'access_tags' });
        });
    });

    describe('requiredFilters and maxRangeDays', () => {
        test('requires recorded filter', () => {
            const schema = getAuditEventClickHouseSchema();
            expect(schema.requiredFilters).toEqual(['recorded']);
        });

        test('has 30 day max range', () => {
            const schema = getAuditEventClickHouseSchema();
            expect(schema.maxRangeDays).toBe(30);
        });
    });

    describe('custom parameters', () => {
        test('accepts KAFKA_CLICKPIPE write strategy', () => {
            const schema = getAuditEventClickHouseSchema({
                writeStrategy: WRITE_STRATEGIES.KAFKA_CLICKPIPE,
                kafkaTopic: 'fhir_server.resource.AuditEvent_4_0_0'
            });
            expect(schema.writeStrategy).toBe(WRITE_STRATEGIES.KAFKA_CLICKPIPE);
            expect(schema.kafkaTopic).toBe('fhir_server.resource.AuditEvent_4_0_0');
        });

        test('allows overriding writeStrategy only', () => {
            const schema = getAuditEventClickHouseSchema({
                writeStrategy: WRITE_STRATEGIES.KAFKA_CLICKPIPE
            });
            expect(schema.writeStrategy).toBe(WRITE_STRATEGIES.KAFKA_CLICKPIPE);
            expect(schema.kafkaTopic).toBeNull();
        });

        test('allows overriding kafkaTopic only', () => {
            const schema = getAuditEventClickHouseSchema({
                kafkaTopic: 'my-topic'
            });
            expect(schema.writeStrategy).toBe(WRITE_STRATEGIES.SYNC_DIRECT);
            expect(schema.kafkaTopic).toBe('my-topic');
        });
    });

    describe('fieldExtractor', () => {
        test('includes a fieldExtractor instance', () => {
            const schema = getAuditEventClickHouseSchema();
            expect(schema.fieldExtractor).toBeDefined();
            expect(typeof schema.fieldExtractor.extract).toBe('function');
        });
    });
});
