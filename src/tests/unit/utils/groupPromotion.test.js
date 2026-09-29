'use strict';

const { describe, test, expect } = require('@jest/globals');
const { isGroupOverLimit, getGroupMemberLimitError, rejectGroupOverMemberLimit } = require('../../../utils/groupPromotion');
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
    const configManager = { ...buildConfigManager(), groupMemberLimit: 3, groupMemberPromotionLimit: 100 };

    test('returns a too-costly error when member[] exceeds groupMemberLimit, regardless of groupMemberPromotionLimit', () => {
        const error = getGroupMemberLimitError({ doc: buildGroupDoc({ memberCount: 4 }), configManager });

        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Group members count exceeds maximum (4 > 3)');
        expect(error.issue[0].code).toBe('too-costly');
        expect(error.issue[0].diagnostics).toContain('PATCH');
    });

    test('returns undefined at exactly groupMemberLimit', () => {
        expect(getGroupMemberLimitError({ doc: buildGroupDoc({ memberCount: 3 }), configManager })).toBeUndefined();
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
});

describe('rejectGroupOverMemberLimit', () => {
    const configManager = { ...buildConfigManager(), groupMemberLimit: 3 };

    test('throws the too-costly error when over the limit', () => {
        expect(() => rejectGroupOverMemberLimit({ doc: buildGroupDoc({ memberCount: 4 }), configManager }))
            .toThrow('Group members count exceeds maximum (4 > 3)');
    });

    test('does not throw when within the limit', () => {
        expect(() => rejectGroupOverMemberLimit({ doc: buildGroupDoc({ memberCount: 3 }), configManager })).not.toThrow();
    });
});
