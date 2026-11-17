const { describe, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { GroupMemberMerger } = require('../../../../operations/common/groupMemberMerger');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../utils/contextDataBuilder');
const {
    EXTERNAL_STORAGE_TAG_SYSTEM,
    EXTERNAL_STORAGE_TAG_CODE
} = require('../../../../utils/clickHouseGroupPreSave');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

const SAA = 'test-owner';
const DUPLICATE_MEMBERS = [
    { entity: { reference: 'Patient/a' } },
    { entity: { reference: 'Patient/b' } },
    { entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } }
];
const MERGED_MEMBERS = [
    { entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } },
    { entity: { reference: 'Patient/b' } }
];
const CLICKHOUSE_FOR_GROUP = { enableClickHouse: true, mongoWithClickHouseResources: ['Group'] };
const CLICKHOUSE_DISABLED = { enableClickHouse: false, mongoWithClickHouseResources: [] };
const CLICKHOUSE_FOR_OTHER_RESOURCES = { enableClickHouse: true, mongoWithClickHouseResources: ['List'] };
const HEADER = { headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' } };
const NO_HEADER = { headers: {} };

function group(extra = {}) {
    return { resourceType: 'Group', id: 'g1', _sourceAssigningAuthority: SAA, member: DUPLICATE_MEMBERS, ...extra };
}

describe('GroupMemberMerger', () => {
    test.each([
        ['a resource that is not a Group', { ...group(), resourceType: 'List' }, undefined, CLICKHOUSE_DISABLED, DUPLICATE_MEMBERS],
        ['a Group without member', group({ member: undefined }), undefined, CLICKHOUSE_DISABLED, undefined],
        ['the useexternalstorage header with ClickHouse enabled for Group', group(), HEADER, CLICKHOUSE_FOR_GROUP, DUPLICATE_MEMBERS],
        ['the useexternalstorage header with ClickHouse disabled', group(), HEADER, CLICKHOUSE_DISABLED, MERGED_MEMBERS],
        [
            'the useexternalstorage header on an extended Group with ClickHouse enabled for Group',
            group({ [MONGO_GROUP_EXTENDED_FIELD]: true }),
            HEADER,
            CLICKHOUSE_FOR_GROUP,
            MERGED_MEMBERS
        ],
        ['the useexternalstorage header with ClickHouse enabled for other resources', group(), HEADER, CLICKHOUSE_FOR_OTHER_RESOURCES, MERGED_MEMBERS],
        [
            'the external storage member tag and no header',
            group({ meta: { tag: [{ system: EXTERNAL_STORAGE_TAG_SYSTEM, code: EXTERNAL_STORAGE_TAG_CODE }] } }),
            NO_HEADER,
            CLICKHOUSE_FOR_GROUP,
            MERGED_MEMBERS
        ],
        ['an embedded Group with duplicate members', group(), NO_HEADER, CLICKHOUSE_FOR_GROUP, MERGED_MEMBERS]
    ])('for %s leaves member[] as expected', (_label, resource, requestInfo, configManager, expectedMember) => {
        const merger = new GroupMemberMerger({ configManager });

        const result = merger.mergeMembers({ resource: deepcopy(resource), requestInfo });

        expect(result.member).toEqual(expectedMember);
    });

    test('entries in olderEntries are merged first, so the other entries win', () => {
        const merger = new GroupMemberMerger({ configManager: CLICKHOUSE_DISABLED });
        const storedEntry = { entity: { reference: 'Patient/a' }, period: { start: '2025-01-01' } };
        const resource = group({ member: [{ entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } }, storedEntry] });

        const result = merger.mergeMembers({ resource, requestInfo: NO_HEADER, olderEntries: new Set([storedEntry]) });

        expect(result.member).toEqual([{ entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } }]);
    });
});
