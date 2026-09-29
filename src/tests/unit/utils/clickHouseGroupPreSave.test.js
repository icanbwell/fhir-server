'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: jestObj.fn(() => 'mock-uuid')
}));

// Mock Resource as a class we can use for instanceof checks
class MockResource {
    constructor(data) {
        Object.assign(this, data);
    }
}

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => MockResource);

class MockCoding {
    constructor(data) {
        Object.assign(this, data);
    }
}

jestObj.mock('../../../fhir/classes/4_0_0/complex_types/coding', () => MockCoding);

const {
    addExternalStorageTagIfNeeded,
    stripMembersIfNeeded,
    handleClickHouseGroupPreSave,
    EXTERNAL_STORAGE_TAG_SYSTEM,
    EXTERNAL_STORAGE_TAG_CODE
} = require('../../../utils/clickHouseGroupPreSave');

describe('clickHouseGroupPreSave', () => {
    describe('addExternalStorageTagIfNeeded', () => {
        test('adds tag to Group resource when useExternalStorage is true', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] }
            };
            const contextData = { useExternalStorage: true };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta.tag).toHaveLength(1);
            expect(doc.meta.tag[0]).toEqual({
                id: 'mock-uuid',
                system: EXTERNAL_STORAGE_TAG_SYSTEM,
                code: EXTERNAL_STORAGE_TAG_CODE
            });
        });

        test('skips if tag already present', () => {
            const doc = {
                resourceType: 'Group',
                meta: {
                    tag: [{
                        system: EXTERNAL_STORAGE_TAG_SYSTEM,
                        code: EXTERNAL_STORAGE_TAG_CODE
                    }]
                }
            };
            const contextData = { useExternalStorage: true };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta.tag).toHaveLength(1);
        });

        test('skips non-Group resource', () => {
            const doc = {
                resourceType: 'Patient',
                meta: { tag: [] }
            };
            const contextData = { useExternalStorage: true };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta.tag).toHaveLength(0);
        });

        test('skips when useExternalStorage is false', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] }
            };
            const contextData = { useExternalStorage: false };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta.tag).toHaveLength(0);
        });

        test('skips when contextData is null', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] }
            };

            addExternalStorageTagIfNeeded(doc, null);

            expect(doc.meta.tag).toHaveLength(0);
        });

        test('skips when doc.meta is undefined', () => {
            const doc = {
                resourceType: 'Group'
            };
            const contextData = { useExternalStorage: true };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta).toBeUndefined();
        });

        test('creates Coding instance when doc is instanceof Resource', () => {
            const doc = new MockResource({
                resourceType: 'Group',
                meta: { tag: [] }
            });
            const contextData = { useExternalStorage: true };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta.tag).toHaveLength(1);
            expect(doc.meta.tag[0]).toBeInstanceOf(MockCoding);
        });

        test('appends to existing tags', () => {
            const existingTag = { system: 'http://other', code: 'existing' };
            const doc = {
                resourceType: 'Group',
                meta: { tag: [existingTag] }
            };
            const contextData = { useExternalStorage: true };

            addExternalStorageTagIfNeeded(doc, contextData);

            expect(doc.meta.tag).toHaveLength(2);
            expect(doc.meta.tag[0]).toBe(existingTag);
            expect(doc.meta.tag[1].system).toBe(EXTERNAL_STORAGE_TAG_SYSTEM);
        });
    });

    describe('stripMembersIfNeeded', () => {
        test('removes member field from Group', () => {
            const doc = {
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true };

            stripMembersIfNeeded(doc, contextData);

            expect(doc.member).toBeUndefined();
        });

        test('preserves member when groupMemberEventsWritten is true', () => {
            const doc = {
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true, groupMemberEventsWritten: true };

            stripMembersIfNeeded(doc, contextData);

            expect(doc.member).toHaveLength(1);
        });

        test('preserves member when smartMerge is true', () => {
            const doc = {
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true, smartMerge: true };

            stripMembersIfNeeded(doc, contextData);

            expect(doc.member).toHaveLength(1);
        });

        test('preserves member when useExternalStorage is false', () => {
            const doc = {
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: false };

            stripMembersIfNeeded(doc, contextData);

            expect(doc.member).toHaveLength(1);
        });

        test('does nothing for non-Group resources', () => {
            const doc = {
                resourceType: 'Patient',
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true };

            stripMembersIfNeeded(doc, contextData);

            expect(doc.member).toHaveLength(1);
        });

        test('does nothing when contextData is null', () => {
            const doc = {
                resourceType: 'Group',
                member: [{ entity: { reference: 'Patient/1' } }]
            };

            stripMembersIfNeeded(doc, null);

            expect(doc.member).toHaveLength(1);
        });
    });

    describe('handleClickHouseGroupPreSave', () => {
        test('skips when ClickHouse is disabled', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] },
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true };
            const configManager = {
                enableClickHouse: false,
                mongoWithClickHouseResources: ['Group']
            };

            handleClickHouseGroupPreSave(doc, contextData, configManager);

            expect(doc.meta.tag).toHaveLength(0);
            expect(doc.member).toHaveLength(1);
        });

        test('skips when resource type not in mongoWithClickHouseResources', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] },
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true };
            const configManager = {
                enableClickHouse: true,
                mongoWithClickHouseResources: ['Patient']
            };

            handleClickHouseGroupPreSave(doc, contextData, configManager);

            expect(doc.meta.tag).toHaveLength(0);
            expect(doc.member).toHaveLength(1);
        });

        test('calls both addExternalStorageTagIfNeeded and stripMembersIfNeeded when enabled', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] },
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true };
            const configManager = {
                enableClickHouse: true,
                mongoWithClickHouseResources: ['Group']
            };

            handleClickHouseGroupPreSave(doc, contextData, configManager);

            // Tag should be added
            expect(doc.meta.tag).toHaveLength(1);
            expect(doc.meta.tag[0].system).toBe(EXTERNAL_STORAGE_TAG_SYSTEM);
            // Member should be stripped
            expect(doc.member).toBeUndefined();
        });

        test('skips when configManager is null', () => {
            const doc = {
                resourceType: 'Group',
                meta: { tag: [] },
                member: [{ entity: { reference: 'Patient/1' } }]
            };
            const contextData = { useExternalStorage: true };

            handleClickHouseGroupPreSave(doc, contextData, null);

            expect(doc.meta.tag).toHaveLength(0);
            expect(doc.member).toHaveLength(1);
        });
    });
});
