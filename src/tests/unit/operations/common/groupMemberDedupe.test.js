const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn()
}));

const deepcopy = require('deepcopy');
const { mergeMemberEntry, mergeDuplicateMembers, unchangedStoredEntries } = require('../../../../operations/common/groupMemberDedupe');
const { logInfo } = require('../../../../operations/common/logging');
const { ReferenceGlobalIdHandler } = require('../../../../preSaveHandlers/handlers/referenceGlobalIdHandler');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
const { groupMemberMergeEntriesCounter } = require('../../../../utils/metrics');

const mergeEntriesCounted = jestObj.spyOn(groupMemberMergeEntriesCounter, 'add');

const SAA = 'test-owner';
const PERIOD_2024 = { start: '2024-01-01' };
const PERIOD_2025 = { start: '2025-01-01' };
const PERIOD_2026 = { start: '2026-01-01' };

function member(reference, extra = {}) {
    return { entity: { reference }, ...extra };
}

/** An entry as the save path stores it, with the given _uuid */
function storedEntry(reference, uuid, owner = SAA) {
    return { entity: { reference, _uuid: uuid, _sourceId: reference.split('|')[0], _sourceAssigningAuthority: owner } };
}

/** The entries as preSave stamps them */
async function savedEntries(references) {
    const group = { resourceType: 'Group', id: 'group-1', _sourceAssigningAuthority: SAA, member: references.map((reference) => member(reference)) };
    await new ReferenceGlobalIdHandler().preSaveAsync({ resource: group });
    return group.member;
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
        ['an entry without a reference is kept in place', ['Patient/a', null, 'Patient/a'], ['Patient/a', null]],
        ['versioned references of different members stay apart', ['Patient/x/_history/2', 'Patient/y/_history/2'], ['Patient/x/_history/2', 'Patient/y/_history/2']],
        [
            'absolute references to different resource types stay apart',
            ['https://example.org/fhir/Patient/x', 'https://example.org/fhir/Practitioner/x'],
            ['https://example.org/fhir/Patient/x', 'https://example.org/fhir/Practitioner/x']
        ],
        ['a reference that is not Type/id is not merged, even when repeated', ['Patient/a/_history/1', 'Patient/a/_history/1'], ['Patient/a/_history/1', 'Patient/a/_history/1']],
        ['a reference with no id is not merged', ['Patient/', 'Patient/'], ['Patient/', 'Patient/']]
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

describe('mergeDuplicateMembers with entity._uuid stamped by preSave', () => {
    const referenceForms = [
        'Patient/a',
        `Patient/a|${SAA}`,
        'Patient/a|other-owner',
        `Patient/${generateUUIDv5(`a|${SAA}`)}`,
        `Patient/${generateUUIDv5('a|other-owner')}`,
        'Patient/b',
        'Practitioner/a'
    ];
    const savedUuidOf = async (reference) => (await savedEntries([reference]))[0].entity._uuid;

    test.each(referenceForms.flatMap((first) => referenceForms.map((second) => [first, second])))(
        '%s and %s are one member exactly when preSave gives them the same _uuid, stamped or not',
        async (first, second) => {
            const sameUuid = (await savedUuidOf(first)) === (await savedUuidOf(second));

            const stampedResult = mergeDuplicateMembers({ members: await savedEntries([first, second]), sourceAssigningAuthority: SAA });
            const unstampedResult = mergeDuplicateMembers({ members: [member(first), member(second)], sourceAssigningAuthority: SAA });

            expect(stampedResult).toHaveLength(sameUuid ? 1 : 2);
            expect(unstampedResult).toHaveLength(sameUuid ? 1 : 2);
        }
    );

    test('entity._uuid is used as it is, so entries with one _uuid are one member', () => {
        const members = [storedEntry('Patient/a', 'Patient/same'), storedEntry('Patient/b', 'Patient/same')];

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(result).toHaveLength(1);
    });

    test('an entry with no entity._uuid is computed from its reference', async () => {
        const members = [member('Patient/a'), storedEntry(`Patient/a|${SAA}`, await savedUuidOf('Patient/a'))];

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(result).toHaveLength(1);
    });

    test('absolute references sharing one entity._uuid are not merged', () => {
        const inputReferences = ['https://example.org/fhir/Patient/x', 'https://example.org/fhir/Practitioner/x'];
        const members = inputReferences.map((reference) => storedEntry(reference, 'https:/same'));

        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA });

        expect(references(result)).toEqual(inputReferences);
    });
});

describe('mergeDuplicateMembers logging and metrics', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    test('logs the Group id and how many entries were merged away, and counts them', () => {
        const members = [member('Patient/a'), member('Patient/b'), member('Patient/a'), member('Patient/a'), member('Patient/b')];

        mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA, groupId: 'group-1' });

        expect(logInfo).toHaveBeenCalledWith('Group member entries of the same member merged into one', {
            groupId: 'group-1',
            membersWithRepeatedEntriesCount: 2,
            mergedAwayEntriesCount: 3
        });
        expect(mergeEntriesCounted).toHaveBeenCalledTimes(1);
        expect(mergeEntriesCounted).toHaveBeenCalledWith(3, { outcome: 'merged_away' });
    });

    test('logs and counts the entries left as is when other entries are merged', () => {
        const members = [member('Patient/a'), member('https://example.org/fhir/Patient/x'), member('Patient/a'), member(undefined)];

        mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA, groupId: 'group-1' });

        expect(logInfo).toHaveBeenCalledWith(
            'Group members with no resolvable entity.reference left as is when merging duplicates',
            { groupId: 'group-1', entriesWithoutReferenceCount: 2 }
        );
        expect(mergeEntriesCounted).toHaveBeenCalledWith(2, { outcome: 'left_as_is' });
        expect(mergeEntriesCounted).toHaveBeenCalledWith(1, { outcome: 'merged_away' });
    });

    test('logs and counts nothing when no member is listed twice', () => {
        const members = [member('Patient/a'), member('Patient/b'), member('https://example.org/fhir/Patient/a')];

        mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA, groupId: 'group-1' });

        expect(logInfo).not.toHaveBeenCalled();
        expect(mergeEntriesCounted).not.toHaveBeenCalled();
    });
});

describe('mergeDuplicateMembers per-member entry limit', () => {
    const LIMIT = 2;
    const entriesOfA = (count) => Array.from({ length: count }, (_, i) => member('Patient/a', { period: { start: `20${10 + i}-01-01` } }));

    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    test.each([
        ['at the limit', entriesOfA(2), LIMIT],
        ['over the limit with no limit passed', entriesOfA(3), undefined]
    ])('merges a member sent %s', (_name, members, maxEntriesPerMember) => {
        const result = mergeDuplicateMembers({ members, sourceAssigningAuthority: SAA, maxEntriesPerMember });

        expect(references(result)).toEqual(['Patient/a']);
    });

    test('rejects a member sent more times than the limit with a 400, and counts its entries', () => {
        let thrown;
        try {
            mergeDuplicateMembers({ members: entriesOfA(3), sourceAssigningAuthority: SAA, maxEntriesPerMember: LIMIT });
        } catch (e) {
            thrown = e;
        }

        // ServerError resets the prototype of its subclasses, so a BadRequestError is not an
        // instanceof BadRequestError; its 400 is the statusCode it carries
        expect(thrown).toMatchObject({
            statusCode: 400,
            message: 'Group.member has 3 entries for one member, more than the 2 allowed'
        });
        expect(mergeEntriesCounted).toHaveBeenCalledTimes(1);
        expect(mergeEntriesCounted).toHaveBeenCalledWith(3, { outcome: 'rejected' });
    });

    test('does not count entries the Group already stores', () => {
        const stored = entriesOfA(3);
        const members = [...stored, member('Patient/a', { inactive: true })];

        const result = mergeDuplicateMembers({
            members, sourceAssigningAuthority: SAA, olderEntries: new Set(stored), maxEntriesPerMember: LIMIT
        });

        expect(result).toEqual([member('Patient/a', { period: { start: '2012-01-01' }, inactive: true })]);
    });
});

describe('unchangedStoredEntries', () => {
    const STORED = [member('Patient/a', { period: PERIOD_2025 }), member('Patient/b')];

    test.each([
        ['an entry equal to a stored entry', STORED, member('Patient/a', { period: PERIOD_2025 }), true],
        ['a stored entry the write changed', STORED, member('Patient/a', { period: PERIOD_2026 }), false],
        ['a new member', STORED, member('Patient/c'), false],
        ['an entry without a reference', [...STORED, { entity: { display: 'no reference' } }], { entity: { display: 'no reference' } }, true],
        ['a Group with no stored member[]', undefined, member('Patient/a', { period: PERIOD_2025 }), false]
    ])('%s counts as still stored: %s', (_label, storedMembers, entry, expected) => {
        expect(unchangedStoredEntries(storedMembers).has(entry)).toBe(expected);
    });

    test.each([
        [
            'an edited first entry wins over a later one still as stored',
            [member('Patient/a', { period: PERIOD_2025 }), member('Patient/b'), member('Patient/a', { period: PERIOD_2024, inactive: true })],
            [member('Patient/a', { period: PERIOD_2026 }), member('Patient/b'), member('Patient/a', { period: PERIOD_2024, inactive: true })],
            [member('Patient/a', { period: PERIOD_2026, inactive: true }), member('Patient/b')]
        ],
        [
            'a sent entry merged into the first slot by id wins over a later stored entry',
            [member('Patient/a', { id: 'm-a', period: PERIOD_2025 }), member('Patient/a', { period: { end: '2025-12-31' } })],
            [member('Patient/a', { id: 'm-a', period: { start: '2025-01-01', end: '2026-12-31' } }), member('Patient/a', { period: { end: '2025-12-31' } })],
            [member('Patient/a', { id: 'm-a', period: { start: '2025-01-01', end: '2026-12-31' } })]
        ]
    ])('with mergeDuplicateMembers, %s', (_label, storedMembers, writtenMembers, expectedMembers) => {
        const result = mergeDuplicateMembers({
            members: writtenMembers,
            sourceAssigningAuthority: SAA,
            olderEntries: unchangedStoredEntries(storedMembers)
        });

        expect(result).toEqual(expectedMembers);
    });
});
