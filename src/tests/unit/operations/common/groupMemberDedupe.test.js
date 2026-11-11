const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { applyPatch } = require('fast-json-patch');
const { consolidateAddedMembers, storedMemberEntriesOf } = require('../../../../operations/common/groupMemberDedupe');
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

function groupWithMembers(members) {
    return { resourceType: 'Group', id: 'g1', _sourceAssigningAuthority: SAA, member: members };
}

/**
 * Applies the PATCH the way patch.js does: plain JSON Patch, then consolidateAddedMembers.
 */
function applyPatchToGroup(group, patchContent) {
    const groupToPatch = deepcopy(group);
    const storedMemberEntries = storedMemberEntriesOf(groupToPatch);
    const patchedGroup = applyPatch(groupToPatch, deepcopy(patchContent)).newDocument;
    return consolidateAddedMembers({ patchedGroup, storedMemberEntries });
}

function memberReferences(group) {
    return group.member.map((member) => member.entity?.reference);
}

describe('consolidateAddedMembers', () => {
    test.each([
        ['/member/-', ['Patient/a', 'Patient/b']],
        ['/member/', ['Patient/b', 'Patient/a']],
        ['/member/0', ['Patient/b', 'Patient/a']]
    ])('an unchanged re-add on %s keeps one entry, where the member first appears', (path, expectedReferences) => {
        const group = groupWithMembers([storedMember('Patient/a'), storedMember('Patient/b')]);

        const result = applyPatchToGroup(group, [{ op: 'add', path, value: { entity: { reference: 'Patient/b' } } }]);

        expect(memberReferences(result)).toEqual(expectedReferences);
        expect(result.member.find((member) => member.entity.reference === 'Patient/b')).toEqual({ entity: { reference: 'Patient/b' } });
    });

    test('a re-add of an existing member with changes replaces it where it is with exactly the value sent', () => {
        const group = groupWithMembers([storedMember('Patient/a'), storedMember('Patient/b', { id: 'm-b', inactive: true })]);

        const result = applyPatchToGroup(group, [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/b' }, period: { start: '2026-01-01' } } }
        ]);

        expect(memberReferences(result)).toEqual(['Patient/a', 'Patient/b']);
        expect(result.member[1]).toEqual({ entity: { reference: 'Patient/b' }, period: { start: '2026-01-01' } });
    });

    test.each([
        ['the same id', 'Patient/a'],
        ['id|sourceAssigningAuthority', `Patient/a|${SAA}`],
        ['the uuid', `Patient/${generateUUIDv5(`a|${SAA}`)}`]
    ])('a re-add referencing an existing member by %s updates that member', (_label, reference) => {
        const group = groupWithMembers([storedMember('Patient/a', { period: { start: '2025-01-01' } })]);

        const result = applyPatchToGroup(group, [
            { op: 'add', path: '/member/-', value: { entity: { reference }, period: { start: '2026-01-01' } } }
        ]);

        expect(result.member).toEqual([{ entity: { reference }, period: { start: '2026-01-01' } }]);
    });

    test.each([
        ['a new member', [storedMember('Patient/a')], ['Patient/a', 'Patient/b']],
        ['an existing member', [storedMember('Patient/a'), storedMember('Patient/b', { id: 'm-b' })], ['Patient/a', 'Patient/b']]
    ])('adds of %s twice in one PATCH keep only the last one', (_label, storedMembers, expectedReferences) => {
        const group = groupWithMembers(storedMembers);

        const result = applyPatchToGroup(group, [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/b' }, period: { start: '2026-01-01' } } },
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/b' }, inactive: true } }
        ]);

        expect(memberReferences(result)).toEqual(expectedReferences);
        expect(result.member[1]).toEqual({ entity: { reference: 'Patient/b' }, inactive: true });
    });

    test.each([
        [
            'a re-add of the old patient adds it back',
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' } } },
            ['Patient/b', 'Patient/a']
        ],
        [
            'an add of the new patient keeps one entry',
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/b' } } },
            ['Patient/b']
        ]
    ])('after a member is re-pointed in the same PATCH, %s', (_label, addOp, expectedReferences) => {
        const group = groupWithMembers([storedMember('Patient/a')]);

        const result = applyPatchToGroup(group, [
            { op: 'replace', path: '/member/0/entity/reference', value: 'Patient/b' },
            addOp
        ]);

        expect(memberReferences(result)).toEqual(expectedReferences);
    });

    test('a member added and then removed in the same PATCH stays removed', () => {
        const group = groupWithMembers([storedMember('Patient/x')]);

        const result = applyPatchToGroup(group, [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' } } },
            { op: 'remove', path: '/member/1' }
        ]);

        expect(memberReferences(result)).toEqual(['Patient/x']);
    });

    test.each([
        [
            'an edit to the entry the add created is kept',
            '/member/2/period',
            { entity: { reference: 'Patient/a' }, inactive: true, period: { start: '2026-02-01' } }
        ],
        [
            'an edit to the stored entry is replaced by the add',
            '/member/1/period',
            { entity: { reference: 'Patient/a' }, inactive: true }
        ]
    ])('after a re-add of an existing member, %s', (_label, editPath, expectedMember) => {
        const group = groupWithMembers([storedMember('Patient/x'), storedMember('Patient/a')]);

        const result = applyPatchToGroup(group, [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' }, inactive: true } },
            { op: 'add', path: editPath, value: { start: '2026-02-01' } }
        ]);

        expect(result.member).toEqual([storedMember('Patient/x'), expectedMember]);
    });

    test('members the PATCH does not add are left as they are, including duplicates already stored', () => {
        const group = groupWithMembers([
            storedMember('Patient/a', { period: { start: '2025-01-01' } }),
            storedMember('Patient/x'),
            storedMember('Patient/a', { period: { start: '2025-02-01' } })
        ]);

        const result = applyPatchToGroup(group, [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/y' } } }
        ]);

        expect(memberReferences(result)).toEqual(['Patient/a', 'Patient/x', 'Patient/a', 'Patient/y']);
    });

    test.each([
        ['no member ops', [{ op: 'add', path: '/active', value: true }]],
        ['an add of a field of a member', [{ op: 'add', path: '/member/0/period', value: { start: '2026-01-01' } }]],
        ['an add without entity.reference', [{ op: 'add', path: '/member/-', value: { entity: { display: 'no reference' } } }]]
    ])('leaves the patched Group as plain JSON Patch left it for %s', (_label, patchContent) => {
        const group = groupWithMembers([storedMember('Patient/a')]);
        const plainResult = applyPatch(deepcopy(group), deepcopy(patchContent)).newDocument;

        const result = applyPatchToGroup(group, patchContent);

        expect(result).toEqual(plainResult);
    });

    test('does not modify the PATCH ops', () => {
        const group = groupWithMembers([storedMember('Patient/a')]);
        const patchContent = [
            { op: 'add', path: '/member/-', value: { entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } } }
        ];
        const patchBefore = deepcopy(patchContent);

        applyPatchToGroup(group, patchContent);

        expect(patchContent).toEqual(patchBefore);
    });
});
