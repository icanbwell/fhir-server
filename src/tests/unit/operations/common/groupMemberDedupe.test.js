const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { mergeMemberEntry, mergeDuplicateMembers } = require('../../../../operations/common/groupMemberDedupe');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const SAA = 'test-owner';
const PERIOD_2025 = { start: '2025-01-01' };
const PERIOD_2026 = { start: '2026-01-01' };

function member(reference, extra = {}) {
    return { entity: { reference }, ...extra };
}

function references(members) {
    return members.map((entry) => entry.entity?.reference ?? null);
}

describe('mergeMemberEntry', () => {
    test.each([
        ['the newer value wins', member('Patient/a', { period: PERIOD_2025 }), member('Patient/a', { period: PERIOD_2026 }), member('Patient/a', { period: PERIOD_2026 })],
        ['a field only the older entry has is kept', member('Patient/a', { period: PERIOD_2025 }), member('Patient/a'), member('Patient/a', { period: PERIOD_2025 })],
        [
            'a period merges field by field, so an end only the older entry has is kept',
            member('Patient/a', { period: { start: '2024-01-01', end: '2024-06-30' } }),
            member('Patient/a', { period: { start: '2025-01-01' } }),
            member('Patient/a', { period: { start: '2025-01-01', end: '2024-06-30' } })
        ],
        [
            'entity merges field by field',
            { entity: { reference: 'Patient/a', display: 'Name' } },
            { entity: { reference: 'Patient/a', type: 'Patient' } },
            { entity: { reference: 'Patient/a', display: 'Name', type: 'Patient' } }
        ],
        ['a newer entry without inactive keeps the stored inactive', member('Patient/a', { inactive: true }), member('Patient/a'), member('Patient/a', { inactive: true })],
        ['a newer inactive false wins', member('Patient/a', { inactive: true }), member('Patient/a', { inactive: false }), member('Patient/a', { inactive: false })],
        ['a newer inactive true wins', member('Patient/a'), member('Patient/a', { inactive: true }), member('Patient/a', { inactive: true })],
        ['with no older entry the newer entry is used', undefined, member('Patient/a', { period: PERIOD_2026 }), member('Patient/a', { period: PERIOD_2026 })],
        [
            'extension items are merged by id',
            member('Patient/a', { extension: [{ id: 'x1', url: 'https://example.org/one', valueString: 'one' }] }),
            member('Patient/a', { extension: [{ id: 'x2', url: 'https://example.org/two', valueString: 'two' }] }),
            member('Patient/a', {
                extension: [
                    { id: 'x1', url: 'https://example.org/one', valueString: 'one' },
                    { id: 'x2', url: 'https://example.org/two', valueString: 'two' }
                ]
            })
        ]
    ])('%s', (_label, olderEntry, newerEntry, expectedEntry) => {
        expect(mergeMemberEntry(olderEntry, newerEntry)).toEqual(expectedEntry);
    });

    test('does not modify either entry', () => {
        const olderEntry = member('Patient/a', { period: PERIOD_2025 });
        const newerEntry = member('Patient/a', { inactive: true });
        const olderBefore = deepcopy(olderEntry);
        const newerBefore = deepcopy(newerEntry);

        const mergedEntry = mergeMemberEntry(olderEntry, newerEntry);
        mergedEntry.entity.display = 'changed after merge';

        expect(olderEntry).toEqual(olderBefore);
        expect(newerEntry).toEqual(newerBefore);
    });
});

describe('mergeDuplicateMembers', () => {
    test.each([
        ['no duplicates', ['Patient/a', 'Patient/b'], ['Patient/a', 'Patient/b']],
        ['a duplicate collapses at the first position', ['Patient/a', 'Patient/b', 'Patient/a'], ['Patient/a', 'Patient/b']],
        ['three entries of one member collapse to one', ['Patient/a', 'Patient/a', 'Patient/b', 'Patient/a'], ['Patient/a', 'Patient/b']],
        ['the id|sourceAssigningAuthority form matches the plain id', ['Patient/a', 'Patient/b', `Patient/a|${SAA}`], [`Patient/a|${SAA}`, 'Patient/b']],
        ['the uuid form matches the plain id', ['Patient/a', `Patient/${generateUUIDv5(`a|${SAA}`)}`], [`Patient/${generateUUIDv5(`a|${SAA}`)}`]],
        ['the same id under another owner is a different member', ['Patient/a', 'Patient/a|other-owner'], ['Patient/a', 'Patient/a|other-owner']],
        ['an entry without a reference is kept in place', ['Patient/a', null, 'Patient/a'], ['Patient/a', null]]
    ])('%s', (_label, inputReferences, expectedReferences) => {
        const members = inputReferences.map((reference) => (reference ? member(reference) : { entity: { display: 'no reference' } }));

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(references(result)).toEqual(expectedReferences);
    });

    test('entries are merged in member[] order, so a later entry wins and earlier fields are kept', () => {
        const members = [
            member('Patient/a', { period: PERIOD_2025, inactive: true }),
            member('Patient/b'),
            member('Patient/a', { period: PERIOD_2026 })
        ];

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(result).toEqual([member('Patient/a', { period: PERIOD_2026, inactive: true }), member('Patient/b')]);
    });

    test('the other entries win over entries in olderEntries even when they come first', () => {
        const storedEntry = member('Patient/a', { period: PERIOD_2025, inactive: true });
        const members = [member('Patient/a', { period: PERIOD_2026 }), member('Patient/x'), storedEntry];

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA, olderEntries: new Set([storedEntry]) });

        expect(result).toEqual([member('Patient/a', { period: PERIOD_2026, inactive: true }), member('Patient/x')]);
    });

    test('an entity sourceAssigningAuthority is used before the Group one', () => {
        const members = [
            { entity: { reference: 'Patient/a', _sourceAssigningAuthority: 'other-owner' } },
            member('Patient/a|other-owner', { inactive: true })
        ];

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(result).toHaveLength(1);
        expect(result[0].inactive).toBe(true);
    });

    test('a stored entity._uuid is not used, so entries are matched on their current reference', () => {
        const members = [
            { entity: { reference: 'Patient/a', _uuid: 'Patient/same-uuid' } },
            { entity: { reference: 'Patient/b', _uuid: 'Patient/same-uuid' } }
        ];

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(result).toHaveLength(2);
    });

    test('returns the same array when nothing is merged', () => {
        const members = [member('Patient/a'), member('Patient/b')];

        expect(mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA })).toBe(members);
    });

    test('does not modify the input entries', () => {
        const members = [member('Patient/a', { period: PERIOD_2025 }), member('Patient/a', { inactive: true })];
        const membersBefore = deepcopy(members);

        mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(members).toEqual(membersBefore);
    });
});
