'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock logging
jestObj.mock('../../../../operations/common/logging', () => ({
    logDebug: jestObj.fn()
}));

// Mock the clickHouseGroupHandler and groupMemberRepository
jestObj.mock('../../../../dataLayer/postSaveHandlers/clickHouseGroupHandler', () => ({
    ClickHouseGroupHandler: jestObj.fn().mockImplementation((params) => ({
        type: 'ClickHouseGroupHandler',
        ...params
    }))
}));

jestObj.mock('../../../../dataLayer/repositories/groupMemberRepository', () => ({
    GroupMemberRepository: jestObj.fn().mockImplementation((params) => ({
        type: 'GroupMemberRepository',
        ...params
    }))
}));

const { PostSaveHandlerFactory } = require('../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory');
const { logDebug } = require('../../../../operations/common/logging');

describe('PostSaveHandlerFactory', () => {
    let factory;
    let mockConfigManager;
    let mockClickHouseClientManager;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockConfigManager = {
            enableClickHouse: true,
            mongoWithClickHouseResources: ['Group', 'Patient']
        };

        mockClickHouseClientManager = {
            query: jestObj.fn()
        };

        factory = new PostSaveHandlerFactory({
            configManager: mockConfigManager,
            clickHouseClientManager: mockClickHouseClientManager
        });
    });

    describe('constructor', () => {
        test('assigns configManager', () => {
            expect(factory.configManager).toBe(mockConfigManager);
        });

        test('assigns clickHouseClientManager', () => {
            expect(factory.clickHouseClientManager).toBe(mockClickHouseClientManager);
        });

        test('works without clickHouseClientManager', () => {
            const f = new PostSaveHandlerFactory({
                configManager: mockConfigManager
            });
            expect(f.clickHouseClientManager).toBeUndefined();
        });
    });

    describe('getHandlers', () => {
        test('returns ClickHouseGroupHandler for resource types in mongoWithClickHouseResources', () => {
            const handlers = factory.getHandlers('Group');
            expect(handlers).toHaveLength(1);
            expect(handlers[0].type).toBe('ClickHouseGroupHandler');
        });

        test('returns empty array when resource type is not in mongoWithClickHouseResources', () => {
            const handlers = factory.getHandlers('Observation');
            expect(handlers).toHaveLength(0);
        });

        test('returns empty array when enableClickHouse is false', () => {
            mockConfigManager.enableClickHouse = false;
            const handlers = factory.getHandlers('Group');
            expect(handlers).toHaveLength(0);
        });

        test('returns empty array when mongoWithClickHouseResources is null', () => {
            mockConfigManager.mongoWithClickHouseResources = null;
            const handlers = factory.getHandlers('Group');
            expect(handlers).toHaveLength(0);
        });

        test('returns empty array when mongoWithClickHouseResources is undefined', () => {
            mockConfigManager.mongoWithClickHouseResources = undefined;
            const handlers = factory.getHandlers('Group');
            expect(handlers).toHaveLength(0);
        });

        test('logs debug message when creating ClickHouse handler', () => {
            factory.getHandlers('Group');
            expect(logDebug).toHaveBeenCalledWith('Creating storage sync handler for Group');
        });

        test('does not log when ClickHouse handler is not created', () => {
            factory.getHandlers('Observation');
            expect(logDebug).not.toHaveBeenCalled();
        });

        test('passes clickHouseClientManager to the handler', () => {
            const handlers = factory.getHandlers('Group');
            expect(handlers[0].clickHouseClientManager).toBe(mockClickHouseClientManager);
        });

        test('passes configManager to the handler', () => {
            const handlers = factory.getHandlers('Group');
            expect(handlers[0].configManager).toBe(mockConfigManager);
        });

        test('creates GroupMemberRepository with clickHouseClient', () => {
            const { GroupMemberRepository } = require('../../../../dataLayer/repositories/groupMemberRepository');
            factory.getHandlers('Patient');
            expect(GroupMemberRepository).toHaveBeenCalledWith({
                clickHouseClient: mockClickHouseClientManager
            });
        });
    });

    describe('_shouldUseClickHouseHandler', () => {
        test('returns true when enableClickHouse is true and resource is in list', () => {
            expect(factory._shouldUseClickHouseHandler('Group')).toBe(true);
        });

        test('returns false when enableClickHouse is false', () => {
            mockConfigManager.enableClickHouse = false;
            expect(factory._shouldUseClickHouseHandler('Group')).toBe(false);
        });

        test('returns falsy when mongoWithClickHouseResources is null', () => {
            mockConfigManager.mongoWithClickHouseResources = null;
            expect(factory._shouldUseClickHouseHandler('Group')).toBeFalsy();
        });

        test('returns false when resource type is not in list', () => {
            expect(factory._shouldUseClickHouseHandler('Encounter')).toBe(false);
        });

        test('returns false when mongoWithClickHouseResources is empty array', () => {
            mockConfigManager.mongoWithClickHouseResources = [];
            expect(factory._shouldUseClickHouseHandler('Group')).toBe(false);
        });
    });
});
