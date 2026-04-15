const { describe, test, expect } = require('@jest/globals');
const { QueryParser } = require('../../../../../dataLayer/providers/mongoWithClickHouse/queryParser');

describe('QueryParser.validateMemberCriteria', () => {
    test('routes memberUuid to entityReferenceUuid', () => {
        const result = QueryParser.validateMemberCriteria({
            memberReference: null,
            memberSourceId: null,
            memberUuid: 'Patient/550e8400-e29b-41d4-a716-446655440000'
        });
        expect(result.valid).toBe(true);
        expect(result.entityReferenceUuid).toBe('Patient/550e8400-e29b-41d4-a716-446655440000');
        expect(result.entityReferenceSourceId).toBeUndefined();
    });

    test('routes memberSourceId to entityReferenceSourceId', () => {
        const result = QueryParser.validateMemberCriteria({
            memberReference: null,
            memberSourceId: 'Patient/123',
            memberUuid: null
        });
        expect(result.valid).toBe(true);
        expect(result.entityReferenceSourceId).toBe('Patient/123');
        expect(result.entityReferenceUuid).toBeUndefined();
    });

    test('memberUuid takes precedence when both provided', () => {
        const result = QueryParser.validateMemberCriteria({
            memberReference: null,
            memberSourceId: 'Patient/123',
            memberUuid: 'Patient/550e8400-e29b-41d4-a716-446655440000'
        });
        expect(result.valid).toBe(true);
        expect(result.entityReferenceUuid).toBe('Patient/550e8400-e29b-41d4-a716-446655440000');
        expect(result.entityReferenceSourceId).toBeUndefined();
    });

    test('rejects memberUuid without resource type prefix', () => {
        const result = QueryParser.validateMemberCriteria({
            memberReference: null,
            memberSourceId: null,
            memberUuid: 'just-a-uuid'
        });
        expect(result.valid).toBe(false);
    });

    test('rejects memberSourceId without resource type prefix', () => {
        const result = QueryParser.validateMemberCriteria({
            memberReference: null,
            memberSourceId: 'just-an-id',
            memberUuid: null
        });
        expect(result.valid).toBe(false);
    });

    test('rejects when no criteria provided', () => {
        const result = QueryParser.validateMemberCriteria({
            memberReference: null,
            memberSourceId: null,
            memberUuid: null
        });
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('no_criteria');
    });
});
