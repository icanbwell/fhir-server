'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('fs', () => ({
    readFileSync: jestObj.fn()
}));

jestObj.mock('../../../indexes/customIndexes', () => ({
    customIndexes: {
        '*': [
            {
                keys: { 'meta.source': 1, _uuid: 1 },
                options: { name: 'meta.source_1' },
                exclude: ['AuditEvent_4_0_0']
            }
        ],
        'Patient_4_0_0': [
            {
                keys: { name: 1 },
                options: { name: 'name_1' }
            }
        ]
    }
}));

const fs = require('fs');
const { IndexProvider } = require('../../../indexes/indexProvider');

describe('IndexProvider', () => {
    let mockConfigManager;

    beforeEach(() => {
        jestObj.clearAllMocks();
        mockConfigManager = {
            customIndexesFilePath: null,
            accessTagsIndexed: jestObj.fn().mockReturnValue([])
        };
    });

    describe('constructor', () => {
        test('initializes without custom indexes file', () => {
            const provider = new IndexProvider({ configManager: mockConfigManager });
            expect(provider.configManager).toBe(mockConfigManager);
        });

        test('reads and parses custom indexes file when path is provided', () => {
            const customData = JSON.stringify({
                'Observation_4_0_0': [
                    {
                        keys: { status: 1 },
                        options: { name: 'obs_status_1' }
                    }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });
            expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/indexes.json', 'utf-8');
            expect(provider.getIndexes()).toEqual({
                'Observation_4_0_0': [
                    {
                        keys: { status: 1 },
                        options: { name: 'obs_status_1' }
                    }
                ]
            });
        });

        test('throws error when custom indexes file contains wildcard key', () => {
            const customData = JSON.stringify({
                '*': [
                    { keys: { _uuid: 1 }, options: { name: 'uuid_1' } }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/bad_indexes.json';

            expect(() => new IndexProvider({ configManager: mockConfigManager }))
                .toThrow(/unsupported "\*" key/);
        });
    });

    describe('getIndexes', () => {
        test('returns built-in customIndexes when no custom file is configured', () => {
            const provider = new IndexProvider({ configManager: mockConfigManager });
            const indexes = provider.getIndexes();
            expect(indexes).toHaveProperty('*');
            expect(indexes['*'][0].options.name).toBe('meta.source_1');
        });

        test('returns custom file indexes when custom file is configured', () => {
            const customData = JSON.stringify({
                'Encounter_4_0_0': [
                    { keys: { class: 1 }, options: { name: 'class_1' } }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });
            const indexes = provider.getIndexes();
            expect(indexes).toEqual({
                'Encounter_4_0_0': [
                    { keys: { class: 1 }, options: { name: 'class_1' } }
                ]
            });
            expect(indexes).not.toHaveProperty('*');
        });
    });

    describe('hasIndexForAccessCodes', () => {
        test('uses configManager.accessTagsIndexed when no custom file', () => {
            mockConfigManager.accessTagsIndexed.mockReturnValue(['bwell', 'client1']);
            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['bwell'],
                resourceType: 'Patient'
            });
            expect(result).toBe(true);
            expect(mockConfigManager.accessTagsIndexed).toHaveBeenCalledWith('Patient');
        });

        test('returns false when access code not in indexed list (no custom file)', () => {
            mockConfigManager.accessTagsIndexed.mockReturnValue(['bwell']);
            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['unknown_client'],
                resourceType: 'Patient'
            });
            expect(result).toBe(false);
        });

        test('returns true only when ALL access codes are indexed', () => {
            mockConfigManager.accessTagsIndexed.mockReturnValue(['bwell']);
            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['bwell', 'missing'],
                resourceType: 'Patient'
            });
            expect(result).toBe(false);
        });

        test('uses access codes map when custom file is present', () => {
            const customData = JSON.stringify({
                'Patient_4_0_0': [
                    {
                        keys: { '_access.bwell': 1, _uuid: 1 },
                        options: { name: 'access_bwell_1' }
                    },
                    {
                        keys: { '_access.client2': 1, _uuid: 1 },
                        options: { name: 'access_client2_1' }
                    }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['bwell'],
                resourceType: 'Patient'
            });
            expect(result).toBe(true);
        });

        test('returns false when access code not in custom index map', () => {
            const customData = JSON.stringify({
                'Patient_4_0_0': [
                    {
                        keys: { '_access.bwell': 1, _uuid: 1 },
                        options: { name: 'access_bwell_1' }
                    }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['unknown_client'],
                resourceType: 'Patient'
            });
            expect(result).toBe(false);
        });

        test('returns false when resource type has no indexes in custom file', () => {
            const customData = JSON.stringify({
                'Patient_4_0_0': [
                    {
                        keys: { '_access.bwell': 1 },
                        options: { name: 'access_bwell_1' }
                    }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['bwell'],
                resourceType: 'Observation'
            });
            expect(result).toBe(false);
        });

        test('skips History collections when building access codes map', () => {
            const customData = JSON.stringify({
                'Patient_4_0_0': [
                    {
                        keys: { '_access.bwell': 1 },
                        options: { name: 'access_bwell_1' }
                    }
                ],
                'Patient_4_0_0_History': [
                    {
                        keys: { '_access.histclient': 1 },
                        options: { name: 'access_histclient_1' }
                    }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });

            // histclient comes from history, should not be in map
            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['histclient'],
                resourceType: 'Patient'
            });
            expect(result).toBe(false);
        });

        test('deduplicates access codes in map', () => {
            const customData = JSON.stringify({
                'Patient_4_0_0': [
                    {
                        keys: { '_access.bwell': 1, _uuid: 1 },
                        options: { name: 'access_bwell_1' }
                    },
                    {
                        keys: { '_access.bwell': 1, status: 1 },
                        options: { name: 'access_bwell_status_1' }
                    }
                ]
            });
            fs.readFileSync.mockReturnValue(customData);
            mockConfigManager.customIndexesFilePath = '/path/to/indexes.json';

            const provider = new IndexProvider({ configManager: mockConfigManager });

            const result = provider.hasIndexForAccessCodes({
                accessCodes: ['bwell'],
                resourceType: 'Patient'
            });
            expect(result).toBe(true);
        });
    });
});
