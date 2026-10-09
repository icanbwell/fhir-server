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

describe('QueryParser.extractRequestedIds with a member $or', () => {
    // GroupMemberQueryRewriter output for member=Patient/<uuid>
    const widenedMember = {
        $or: [{
            $or: [{
                $or: [
                    { 'member.entity._uuid': { $in: ['Patient/u1'] } },
                    { _uuid: { $in: ['extended-group-1'] } }
                ]
            }]
        }]
    };

    test('ignores the _uuid branch of a member $or', () => {
        expect(QueryParser.extractRequestedIds({ $and: [widenedMember] })).toBeNull();
    });

    test('still collects a real _id constraint next to a member $or', () => {
        const idFilter = { $or: [{ id: 'group-1' }, { _uuid: 'group-1' }] };

        expect(QueryParser.extractRequestedIds({ $and: [widenedMember, idFilter] })).toEqual(['group-1']);
    });

    test('still extracts the member criteria from inside the member $or', () => {
        expect(QueryParser.extractMemberCriteria({ $and: [widenedMember] }).memberUuid).toBe('Patient/u1');
    });
});

describe('QueryParser.hasMemberField', () => {
    test.each([
        [{ 'member.entity._uuid': 'Patient/u1' }, true],
        [{ $or: [{ $and: [{ 'member.entity._sourceId': 'Patient/1' }] }] }, true],
        [{ member: { $exists: true } }, true],
        [{ $or: [{ id: 'group-1' }, { _uuid: 'group-1' }] }, false],
        [{ 'resource.member.entity._uuid': 'Patient/u1' }, false]
    ])('%j -> %s', (query, expected) => {
        expect(QueryParser.hasMemberField(query)).toBe(expected);
    });
});
