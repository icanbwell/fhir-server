const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');
const {
    hasGroupMembers,
    storesMembersInClickHouse,
    writesClickHouseMembers,
    membersNotStored
} = require('../../../../operations/writePipeline/groupMemberWrites');

/**
 * Builds a config manager with ClickHouse on or off and the given ClickHouse resource types.
 */
const buildConfigManager = ({ enableClickHouse, clickHouseResources }) => {
    const configManager = new ConfigManager();
    Object.defineProperty(configManager, 'enableClickHouse', { get: () => enableClickHouse });
    Object.defineProperty(configManager, 'mongoWithClickHouseResources', { get: () => clickHouseResources });
    return configManager;
};

describe('groupMemberWrites', () => {
    test.each([
        { name: 'a Group with members', resource: { resourceType: 'Group', member: [{}] }, expected: true },
        { name: 'a Group with an empty member list', resource: { resourceType: 'Group', member: [] }, expected: false },
        { name: 'a Group without member', resource: { resourceType: 'Group' }, expected: false },
        { name: 'a Group whose member is not an array', resource: { resourceType: 'Group', member: {} }, expected: false },
        { name: 'another resource type with member', resource: { resourceType: 'List', member: [{}] }, expected: false }
    ])('hasGroupMembers is $expected for $name', ({ resource, expected }) => {
        expect(hasGroupMembers(resource)).toBe(expected);
    });

    test.each([
        { name: 'ClickHouse on and the type listed', enableClickHouse: true, clickHouseResources: ['Group'], expected: true },
        { name: 'ClickHouse off', enableClickHouse: false, clickHouseResources: ['Group'], expected: false },
        { name: 'the type not listed', enableClickHouse: true, clickHouseResources: [], expected: false }
    ])('storesMembersInClickHouse is $expected with $name', ({ enableClickHouse, clickHouseResources, expected }) => {
        const configManager = buildConfigManager({ enableClickHouse, clickHouseResources });

        expect(storesMembersInClickHouse({ resourceType: 'Group', configManager })).toBe(expected);
    });

    test.each([
        {
            name: 'external storage, members sent and ClickHouse on for the type',
            contextData: { useExternalStorage: true, groupMembers: [] },
            clickHouseResources: ['Group'],
            expected: true
        },
        {
            name: 'no member field in the body',
            contextData: { useExternalStorage: true, groupMembers: undefined },
            clickHouseResources: ['Group'],
            expected: false
        },
        {
            name: 'no external storage',
            contextData: { useExternalStorage: false, groupMembers: [] },
            clickHouseResources: ['Group'],
            expected: false
        },
        {
            name: 'ClickHouse off for the type',
            contextData: { useExternalStorage: true, groupMembers: [] },
            clickHouseResources: [],
            expected: false
        },
        {
            name: 'no context data',
            contextData: null,
            clickHouseResources: ['Group'],
            expected: false
        }
    ])('writesClickHouseMembers is $expected with $name', ({ contextData, clickHouseResources, expected }) => {
        const configManager = buildConfigManager({ enableClickHouse: true, clickHouseResources });
        const item = { contextData, candidate: { resourceType: 'Group' } };

        expect(writesClickHouseMembers({ item, configManager })).toBe(expected);
    });

    test('membersNotStored returns the members whose reference is not stored, and none for no members', () => {
        const storedMembers = [
            { entity: { reference: 'Patient/1' } },
            { entity: {} }
        ];
        const members = [
            { entity: { reference: 'Patient/1' } },
            { entity: { reference: 'Patient/2' } },
            { entity: {} }
        ];

        expect(membersNotStored({ members, storedMembers })).toStrictEqual([
            { entity: { reference: 'Patient/2' } }
        ]);
        expect(membersNotStored({ members: undefined, storedMembers })).toStrictEqual([]);
    });
});
