const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { rewriteMemberAddOperations } = require('../../../../operations/common/groupMemberDedupe');
const { enrichMemberReferences } = require('../../../../utils/referenceEnricher');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const SAA = 'test-owner';

/**
 * Builds a stored member the way it sits in Group_4_0_0 after a save: entity carries the
 * _uuid/_sourceId/_sourceAssigningAuthority that referenceGlobalIdHandler stamps.
 */
function storedMember(reference, extra = {}) {
    const member = { entity: { reference }, ...extra };
    enrichMemberReferences([member], SAA);
    return member;
}

function groupWith(members) {
    return { resourceType: 'Group', id: 'g1', _sourceAssigningAuthority: SAA, member: members };
}

describe('rewriteMemberAddOperations', () => {
    test.each([
        ['/member/-'],
        ['/member/'],
        ['/member/0']
    ])('drops an add on %s that re-adds an existing member unchanged', (path) => {
        const currentResource = groupWith([storedMember('Patient/a'), storedMember('Patient/b')]);
        const patchContent = [{ op: 'add', path, value: { entity: { reference: 'Patient/b' } } }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual([]);
    });

    test('turns an add that changes an existing member into a replace with exactly the value sent', () => {
        const currentResource = groupWith([
            storedMember('Patient/a'),
            storedMember('Patient/b', { id: 'm-b', inactive: true })
        ]);
        const patchContent = [{
            op: 'add',
            path: '/member/-',
            value: { entity: { reference: 'Patient/b' }, period: { start: '2026-01-01' } }
        }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual([{
            op: 'replace',
            path: '/member/1',
            value: storedMember('Patient/b', { period: { start: '2026-01-01' } })
        }]);
    });

    test('an add at an index for an existing member updates it where it is instead of inserting', () => {
        const currentResource = groupWith([storedMember('Patient/a'), storedMember('Patient/b')]);
        const patchContent = [{ op: 'add', path: '/member/0', value: { entity: { reference: 'Patient/b' }, id: 'new-id' } }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual([
            expect.objectContaining({ op: 'replace', path: '/member/1' })
        ]);
        expect(result[0].value.id).toBe('new-id');
    });

    test('re-adding an inactive member without inactive clears inactive', () => {
        const currentResource = groupWith([storedMember('Patient/a', { inactive: true })]);
        const patchContent = [{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' } } }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toHaveLength(1);
        expect(result[0].value).toEqual(storedMember('Patient/a'));
    });

    test('drops a retry that resends the stored member with reference fields the client set', () => {
        const currentResource = groupWith([storedMember('Patient/a', { period: { start: '2026-01-01' } })]);
        const patchContent = [{
            op: 'add',
            path: '/member/-',
            value: {
                entity: { reference: 'Patient/a', _uuid: 'Patient/spoofed', _sourceId: 'Patient/x' },
                period: { start: '2026-01-01' }
            }
        }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual([]);
    });

    test('leaves an add for a new member unchanged', () => {
        const currentResource = groupWith([storedMember('Patient/a')]);
        const patchContent = [{ op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/new' } } }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual(patchContent);
    });

    test.each([
        ['the same id', 'Patient/a'],
        ['id|sourceAssigningAuthority', `Patient/a|${SAA}`],
        ['the uuid', `Patient/${generateUUIDv5(`a|${SAA}`)}`]
    ])('matches an existing member referenced by %s', (_label, reference) => {
        const currentResource = groupWith([storedMember('Patient/a', { period: { start: '2025-01-01' } })]);
        const patchContent = [{ op: 'add', path: '/member/-', value: { entity: { reference }, period: { start: '2026-01-01' } } }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual([expect.objectContaining({ op: 'replace', path: '/member/0' })]);
        expect(result[0].value.entity.reference).toBe(reference);
    });

    test('a member added twice in one PATCH is appended once and then updated in place', () => {
        const currentResource = groupWith([storedMember('Patient/a')]);
        const patchContent = [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/new' } } },
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/new' } } },
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/new' }, period: { start: '2026-01-01' } } }
        ];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(patchContent[0]);
        expect(result[1]).toEqual(expect.objectContaining({ op: 'replace', path: '/member/1' }));
        expect(result[1].value.period).toEqual({ start: '2026-01-01' });
    });

    test('resolves the index after earlier ops in the same PATCH have shifted member[]', () => {
        const currentResource = groupWith([storedMember('Patient/a'), storedMember('Patient/b')]);
        const patchContent = [
            { op: 'remove', path: '/member/0' },
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/b' }, period: { start: '2026-01-01' } } }
        ];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result[0]).toEqual(patchContent[0]);
        expect(result[1]).toEqual(expect.objectContaining({ op: 'replace', path: '/member/0' }));
    });

    test('ignores a client-supplied entity._uuid when matching', () => {
        const currentResource = groupWith([storedMember('Patient/a')]);
        const spoofedUuid = currentResource.member[0].entity._uuid;
        const patchContent = [{
            op: 'add',
            path: '/member/-',
            value: { entity: { reference: 'Patient/other', _uuid: spoofedUuid } }
        }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual(patchContent);
    });

    test('does not mutate the current resource or the incoming ops', () => {
        const currentResource = groupWith([storedMember('Patient/a')]);
        const patchContent = [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/new' } } },
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } } }
        ];
        const resourceBefore = deepcopy(currentResource);
        const patchBefore = deepcopy(patchContent);

        rewriteMemberAddOperations({ patchContent, currentResource });

        expect(currentResource).toEqual(resourceBefore);
        expect(patchContent).toEqual(patchBefore);
    });

    test.each([
        ['no member add ops', [{ op: 'replace', path: '/active', value: true }]],
        ['an add without entity.reference', [{ op: 'add', path: '/member/-', value: { entity: { display: 'no reference' } } }]],
        ['an add of a nested member field', [{ op: 'add', path: '/member/0/period', value: { start: '2026-01-01' } }]],
        ['an op that cannot be applied', [
            { op: 'remove', path: '/member/9' },
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' } } }
        ]]
    ])('returns the ops unchanged for %s', (_label, patchContent) => {
        const currentResource = groupWith([storedMember('Patient/a')]);

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual(patchContent);
    });

    test('adds to a Group that has no member array yet are left unchanged', () => {
        const currentResource = groupWith(undefined);
        const patchContent = [{ op: 'add', path: '/member', value: [] }, { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' } } }];

        const result = rewriteMemberAddOperations({ patchContent, currentResource });

        expect(result).toEqual(patchContent);
    });
});
