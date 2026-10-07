'use strict';

const { describe, test, expect, jest } = require('@jest/globals');
const {
    isGroupOverLimit,
    getGroupMemberLimitError,
    promoteExistingGroupIfNeeded
} = require('../../../utils/groupPromotion');
const { EXTERNAL_STORAGE_TAG_SYSTEM, EXTERNAL_STORAGE_TAG_CODE } = require('../../../utils/clickHouseGroupPreSave');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../utils/contextDataBuilder');

function buildConfigManager ({
    enableExtendedGroup = true,
    enableClickHouse = false,
    mongoWithClickHouseResources = []
} = {}) {
    return { enableExtendedGroup, enableClickHouse, mongoWithClickHouseResources };
}

function buildGroupDoc ({ memberCount = 0, extended = false, clickHouseTagged = false } = {}) {
    return {
        resourceType: 'Group',
        member: Array.from({ length: memberCount }, (_, i) => ({ entity: { reference: `Patient/${i}` } })),
        _extended: extended,
        meta: {
            tag: clickHouseTagged
                ? [{ system: EXTERNAL_STORAGE_TAG_SYSTEM, code: EXTERNAL_STORAGE_TAG_CODE }]
                : []
        }
    };
}

function requestInfoWithHeader (headerValue) {
    return headerValue === undefined ? { headers: {} } : { headers: { [USE_EXTERNAL_STORAGE_HEADER]: headerValue } };
}

describe('isGroupOverLimit', () => {
    test('false for a non-Group resource, regardless of member count', () => {
        const doc = { ...buildGroupDoc({ memberCount: 10 }), resourceType: 'Patient' };
        expect(isGroupOverLimit({ doc, configManager: buildConfigManager(), limit: 3 })).toBe(false);
    });

    test('false when ENABLE_EXTENDED_GROUP is disabled, regardless of member count', () => {
        const doc = buildGroupDoc({ memberCount: 10 });
        const configManager = buildConfigManager({ enableExtendedGroup: false });
        expect(isGroupOverLimit({ doc, configManager, limit: 3 })).toBe(false);
    });

    test('false when the Group is already extended (Mongo-native), regardless of member count', () => {
        const doc = buildGroupDoc({ memberCount: 10, extended: true });
        expect(isGroupOverLimit({ doc, configManager: buildConfigManager(), limit: 3 })).toBe(false);
    });

    test('true when over the limit and ClickHouse is not enabled for Group', () => {
        const doc = buildGroupDoc({ memberCount: 4 });
        const configManager = buildConfigManager({ enableClickHouse: true, mongoWithClickHouseResources: ['Patient'] });
        expect(isGroupOverLimit({ doc, configManager, limit: 3 })).toBe(true);
    });

    test('false when this request opts into ClickHouse via the useexternalstorage header, even without the persisted tag', () => {
        const doc = buildGroupDoc({ memberCount: 4 });
        const configManager = buildConfigManager({ enableClickHouse: true, mongoWithClickHouseResources: ['Group'] });
        const requestInfo = requestInfoWithHeader('true');
        expect(isGroupOverLimit({ doc, configManager, limit: 3, requestInfo })).toBe(false);
    });

    test('true when ClickHouse is enabled server-wide but neither this request\'s header nor the persisted tag opts this Group in', () => {
        const doc = buildGroupDoc({ memberCount: 4 });
        const configManager = buildConfigManager({ enableClickHouse: true, mongoWithClickHouseResources: ['Group'] });
        const requestInfo = requestInfoWithHeader(undefined);
        expect(isGroupOverLimit({ doc, configManager, limit: 3, requestInfo })).toBe(true);
    });

    test('false when the Group already carries the persisted ClickHouse tag, even though this request omits the header', () => {
        const doc = buildGroupDoc({ memberCount: 4, clickHouseTagged: true });
        const configManager = buildConfigManager({ enableClickHouse: true, mongoWithClickHouseResources: ['Group'] });
        const requestInfo = requestInfoWithHeader(undefined);
        expect(isGroupOverLimit({ doc, configManager, limit: 3, requestInfo })).toBe(false);
    });

    test('false when the Group carries the persisted ClickHouse tag even with no requestInfo at all', () => {
        const doc = buildGroupDoc({ memberCount: 4, clickHouseTagged: true });
        const configManager = buildConfigManager({ enableClickHouse: true, mongoWithClickHouseResources: ['Group'] });
        expect(isGroupOverLimit({ doc, configManager, limit: 3 })).toBe(false);
    });

    test('false when under the limit', () => {
        const doc = buildGroupDoc({ memberCount: 2 });
        expect(isGroupOverLimit({ doc, configManager: buildConfigManager(), limit: 3 })).toBe(false);
    });
});

describe('getGroupMemberLimitError', () => {
    const configManager = { ...buildConfigManager(), groupMemberPromotionLimit: 3, groupMemberLimit: 100 };

    test('returns a too-costly error when member[] exceeds groupMemberPromotionLimit, regardless of groupMemberLimit', () => {
        const error = getGroupMemberLimitError({ doc: buildGroupDoc({ memberCount: 4 }), configManager });

        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Group members count exceeds maximum (4 > 3)');
        expect(error.issue[0].code).toBe('too-costly');
        expect(error.issue[0].diagnostics).toContain('PATCH');
    });

    test('returns undefined for PATCH, which promotes the Group instead', () => {
        const doc = buildGroupDoc({ memberCount: 4 });
        expect(getGroupMemberLimitError({ doc, configManager, requestInfo: { method: 'PATCH' } })).toBeUndefined();
    });

    test('returns undefined at exactly groupMemberPromotionLimit', () => {
        expect(getGroupMemberLimitError({ doc: buildGroupDoc({ memberCount: 3 }), configManager })).toBeUndefined();
    });

    test('returns undefined when ENABLE_EXTENDED_GROUP is off', () => {
        const disabledConfigManager = { ...configManager, enableExtendedGroup: false };
        expect(getGroupMemberLimitError({ doc: buildGroupDoc({ memberCount: 4 }), configManager: disabledConfigManager })).toBeUndefined();
    });

    test('returns undefined for an extended Group (its member changes are rejected separately)', () => {
        const doc = buildGroupDoc({ memberCount: 4, extended: true });
        expect(getGroupMemberLimitError({ doc, configManager })).toBeUndefined();
    });

    test('returns undefined for a ClickHouse-tracked Group', () => {
        const doc = buildGroupDoc({ memberCount: 4, clickHouseTagged: true });
        const clickHouseConfigManager = { ...configManager, enableClickHouse: true, mongoWithClickHouseResources: ['Group'] };
        expect(getGroupMemberLimitError({ doc, configManager: clickHouseConfigManager })).toBeUndefined();
    });

    // PUT and $merge bodies reach the validator before the merge carries the stored Group's
    // storage markers onto them, so the markers are also read from the stored Group.
    test('returns undefined when the stored Group is extended, even if the incoming body is not marked', () => {
        const incoming = buildGroupDoc({ memberCount: 4 });
        const currentResource = buildGroupDoc({ memberCount: 0, extended: true });
        expect(getGroupMemberLimitError({ doc: incoming, configManager, currentResource })).toBeUndefined();
    });

    test('returns undefined when the stored Group is ClickHouse-tracked, even if the incoming body is not tagged', () => {
        const incoming = buildGroupDoc({ memberCount: 4 });
        const currentResource = buildGroupDoc({ memberCount: 0, clickHouseTagged: true });
        const clickHouseConfigManager = { ...configManager, enableClickHouse: true, mongoWithClickHouseResources: ['Group'] };
        expect(getGroupMemberLimitError({ doc: incoming, configManager: clickHouseConfigManager, currentResource })).toBeUndefined();
    });

    test('still returns the error when the stored Group is an ordinary embedded one', () => {
        const incoming = buildGroupDoc({ memberCount: 4 });
        const currentResource = buildGroupDoc({ memberCount: 2 });
        expect(getGroupMemberLimitError({ doc: incoming, configManager, currentResource }).issue[0].code).toBe('too-costly');
    });
});

describe('promoteExistingGroupIfNeeded', () => {
    const requestInfo = { headers: {} };

    function buildPromotableDoc (versionId) {
        const doc = buildGroupDoc({ memberCount: 4 });
        return Object.assign(doc, {
            id: 'group-1',
            _uuid: 'group-uuid-1',
            _sourceAssigningAuthority: 'test-authority',
            meta: { versionId, lastUpdated: new Date(), security: [], tag: [] }
        });
    }

    function buildRepository () {
        return {
            removeMembersNotAtVersionAsync: jest.fn().mockResolvedValue(0),
            resolveMemberWritesAsync: jest.fn().mockResolvedValue(new Map()),
            applyResolvedMemberWritesAsync: jest.fn().mockResolvedValue([])
        };
    }

    test('deletes the rows stamped with any other version than the one it claims before writing the roster', async () => {
        const doc = buildPromotableDoc('7');
        const mongoGroupMemberRepository = buildRepository();
        const configManager = { ...buildConfigManager(), groupMemberPromotionLimit: 3 };

        await promoteExistingGroupIfNeeded({
            doc, requestInfo, base_version: '4_0_0', configManager, mongoGroupMemberRepository
        });

        expect(mongoGroupMemberRepository.removeMembersNotAtVersionAsync).toHaveBeenCalledWith({
            requestInfo, base_version: '4_0_0', groupUuid: 'group-uuid-1', versionId: 7
        });
        const deleteOrder = mongoGroupMemberRepository.removeMembersNotAtVersionAsync.mock.invocationCallOrder[0];
        const resolveOrder = mongoGroupMemberRepository.resolveMemberWritesAsync.mock.invocationCallOrder[0];
        const writeOrder = mongoGroupMemberRepository.applyResolvedMemberWritesAsync.mock.invocationCallOrder[0];
        expect(deleteOrder).toBeLessThan(resolveOrder);
        expect(resolveOrder).toBeLessThan(writeOrder);
        expect(doc._extended).toBe(true);
        expect(doc.member).toBeUndefined();
    });

    test('does nothing, and deletes nothing, when the Group is not over the limit', async () => {
        const doc = buildGroupDoc({ memberCount: 3 });
        const mongoGroupMemberRepository = buildRepository();
        const configManager = { ...buildConfigManager(), groupMemberPromotionLimit: 3 };

        const result = await promoteExistingGroupIfNeeded({
            doc, requestInfo, base_version: '4_0_0', configManager, mongoGroupMemberRepository
        });

        expect(result).toBeUndefined();
        expect(mongoGroupMemberRepository.removeMembersNotAtVersionAsync).not.toHaveBeenCalled();
    });

    test('does nothing for an already-extended Group', async () => {
        const doc = buildGroupDoc({ memberCount: 4, extended: true });
        const mongoGroupMemberRepository = buildRepository();
        const configManager = { ...buildConfigManager(), groupMemberPromotionLimit: 3 };

        await promoteExistingGroupIfNeeded({
            doc, requestInfo, base_version: '4_0_0', configManager, mongoGroupMemberRepository
        });

        expect(mongoGroupMemberRepository.removeMembersNotAtVersionAsync).not.toHaveBeenCalled();
    });
});
