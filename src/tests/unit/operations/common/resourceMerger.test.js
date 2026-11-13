'use strict';

/**
 * Unit tests for ResourceMerger
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { GroupMemberMerger } = require('../../../../operations/common/groupMemberMerger');
const { ConfigManager } = require('../../../../utils/configManager');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

describe('ResourceMerger', () => {
    let resourceMerger;
    let mockPreSaveManager;

    beforeEach(() => {
        mockPreSaveManager = Object.create(PreSaveManager.prototype);
        mockPreSaveManager.preSaveAsync = jest.fn().mockImplementation(async ({ resource }) => {
            if (!resource._uuid) {
                resource._uuid = 'generated-uuid';
            }
            return resource;
        });

        resourceMerger = new ResourceMerger({
            preSaveManager: mockPreSaveManager,
            groupMemberMerger: new GroupMemberMerger({ configManager: new ConfigManager() })
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('updateSecurityTag', () => {
        it('copies security tag from current resource to resource to merge', () => {
            const currentResource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client-a' }
                    ]
                }
            };
            const resourceToMerge = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'different-code' }
                    ]
                }
            };

            resourceMerger.updateSecurityTag({
                system: 'https://www.icanbwell.com/sourceAssigningAuthority',
                currentResource,
                resourceToMerge
            });

            const tag = resourceToMerge.meta.security.find(s => s.system === 'https://www.icanbwell.com/sourceAssigningAuthority');
            expect(tag.code).toBe('client-a');
        });

        it('sets _sourceAssigningAuthority when system is sourceAssigningAuthority', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }] }
            };
            const resourceToMerge = {
                meta: { security: [{ system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'other' }] }
            };

            resourceMerger.updateSecurityTag({
                system: 'https://www.icanbwell.com/sourceAssigningAuthority',
                currentResource,
                resourceToMerge
            });

            expect(resourceToMerge._sourceAssigningAuthority).toBe('bwell');
        });

        it('adds security tag when resourceToMerge has no meta.security', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };
            const resourceToMerge = { meta: {} };

            resourceMerger.updateSecurityTag({
                system: 'https://www.icanbwell.com/owner',
                currentResource,
                resourceToMerge
            });

            expect(resourceToMerge.meta.security).toEqual([{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]);
        });

        it('pushes security tag when system not already in resourceToMerge', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };
            const resourceToMerge = {
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'read' }] }
            };

            resourceMerger.updateSecurityTag({
                system: 'https://www.icanbwell.com/owner',
                currentResource,
                resourceToMerge
            });

            expect(resourceToMerge.meta.security.length).toBe(2);
        });

        it('returns early when currentValue is not found in current resource', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/access', code: 'read' }] }
            };
            const resourceToMerge = { meta: { security: [] } };

            resourceMerger.updateSecurityTag({
                system: 'https://www.icanbwell.com/owner',
                currentResource,
                resourceToMerge
            });

            expect(resourceToMerge.meta.security).toEqual([]);
        });

        it('merges owner display field when missing in currentResource', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };
            const resourceToMerge = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell', display: 'B.Well' }] }
            };

            resourceMerger.updateSecurityTag({
                system: 'https://www.icanbwell.com/owner',
                currentResource,
                resourceToMerge
            });

            // The merged result should have the display from resourceToMerge since currentResource lacks it
            const ownerTag = resourceToMerge.meta.security.find(s => s.system === 'https://www.icanbwell.com/owner');
            expect(ownerTag.display).toBe('B.Well');
        });
    });

    describe('overWriteNonWritableFields', () => {
        it('overwrites id, versionId, lastUpdated, and source from currentResource', () => {
            const currentResource = {
                id: 'original-id',
                _uuid: 'uuid-1',
                meta: {
                    versionId: '5',
                    lastUpdated: '2024-01-01',
                    source: 'http://source.com',
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' },
                        { system: 'https://www.icanbwell.com/owner', code: 'client-a' }
                    ]
                },
                identifier: [{ system: 'https://www.icanbwell.com/sourceId', value: 'src-1' }]
            };
            const resourceToMerge = {
                id: 'new-id',
                _uuid: 'uuid-1',
                meta: {
                    versionId: '1',
                    lastUpdated: '2024-06-01',
                    source: 'http://new-source.com',
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'read' }
                    ]
                },
                identifier: [{ system: 'https://www.icanbwell.com/sourceId', value: 'src-1' }]
            };

            const result = resourceMerger.overWriteNonWritableFields({ currentResource, resourceToMerge });

            expect(result.id).toBe('original-id');
            expect(result.meta.versionId).toBe('5');
            expect(result.meta.lastUpdated).toBe('2024-01-01');
            expect(result.meta.source).toBe('http://source.com');
        });

        it('creates meta if not present on resourceToMerge', () => {
            const currentResource = {
                id: 'original-id',
                _uuid: 'uuid-1',
                meta: {
                    versionId: '1', lastUpdated: '2024-01-01', source: 'src',
                    security: []
                },
                identifier: []
            };
            const resourceToMerge = { id: 'new-id', _uuid: 'uuid-1' };

            const result = resourceMerger.overWriteNonWritableFields({ currentResource, resourceToMerge });
            expect(result.meta).toBeDefined();
            expect(result.meta.versionId).toBe('1');
        });

        it('copies uuid identifier from currentResource when missing in resourceToMerge', () => {
            const currentResource = {
                id: 'original-id',
                _uuid: 'uuid-1',
                meta: { versionId: '1', lastUpdated: '2024-01-01', source: 'src', security: [] },
                identifier: [
                    { system: 'https://www.icanbwell.com/sourceId', value: 'src-1' },
                    { system: 'https://www.icanbwell.com/uuid', value: 'uuid-1' }
                ]
            };
            const resourceToMerge = {
                id: 'new-id',
                _uuid: 'uuid-1',
                meta: { security: [] },
                identifier: [{ system: 'https://www.icanbwell.com/sourceId', value: 'src-1' }]
            };

            const result = resourceMerger.overWriteNonWritableFields({ currentResource, resourceToMerge });
            const uuidIdentifier = result.identifier.find(i => i.system === 'https://www.icanbwell.com/uuid');
            expect(uuidIdentifier).toBeDefined();
            expect(uuidIdentifier.value).toBe('uuid-1');
        });
    });

    describe('compareObjects', () => {
        it('returns patches for differences between objects', () => {
            const currentObject = { status: 'active', code: 'A' };
            const mergedObject = { status: 'inactive', code: 'A' };

            const patches = resourceMerger.compareObjects({ currentObject, mergedObject });

            expect(patches.length).toBe(1);
            expect(patches[0].op).toBe('replace');
            expect(patches[0].path).toBe('/status');
            expect(patches[0].value).toBe('inactive');
        });

        it('ignores _id and id changes', () => {
            const currentObject = { _id: 'mongo-id', id: 'fhir-id', status: 'active' };
            const mergedObject = { _id: 'new-mongo-id', id: 'new-fhir-id', status: 'active' };

            const patches = resourceMerger.compareObjects({ currentObject, mergedObject });
            expect(patches.length).toBe(0);
        });

        it('ignores identifier add operations for uuid and sourceId systems', () => {
            const currentObject = {
                identifier: []
            };
            const mergedObject = {
                identifier: [{ system: 'https://www.icanbwell.com/uuid', value: 'new' }]
            };

            const patches = resourceMerger.compareObjects({ currentObject, mergedObject });
            // The filter removes 'add' operations where value.system is uuid or sourceId
            expect(patches.every(p => !(p.op === 'add' && p.value && p.value.system === 'https://www.icanbwell.com/uuid'))).toBe(true);
        });

        it('returns empty patches when objects are identical', () => {
            const obj = { status: 'active', code: 'A' };
            const patches = resourceMerger.compareObjects({ currentObject: obj, mergedObject: { ...obj } });
            expect(patches.length).toBe(0);
        });

        it('respects limitToPaths filter', () => {
            const currentObject = { status: 'active', code: 'A', category: 'lab' };
            const mergedObject = { status: 'inactive', code: 'B', category: 'lab' };

            const patches = resourceMerger.compareObjects({
                currentObject,
                mergedObject,
                limitToPaths: ['/status']
            });

            expect(patches.length).toBe(1);
            expect(patches[0].path).toBe('/status');
        });
    });

    describe('fastUpdateMeta', () => {
        it('increments versionId and sets lastUpdated', () => {
            const patched_resource_incoming = {};
            const currentResource = { meta: { versionId: '5', lastUpdated: '2024-01-01', security: [] } };

            const result = resourceMerger.fastUpdateMeta({
                patched_resource_incoming,
                currentResource,
                original_source: 'src',
                incrementVersion: true
            });

            expect(result.meta.versionId).toBe('6');
            expect(result.meta.lastUpdated).toBeDefined();
        });

        it('handles NaN versionId gracefully', () => {
            const patched_resource_incoming = {};
            const currentResource = { meta: { versionId: 'invalid', lastUpdated: '2024-01-01', security: [] } };

            const result = resourceMerger.fastUpdateMeta({
                patched_resource_incoming,
                currentResource,
                original_source: 'src',
                incrementVersion: true
            });

            expect(result.meta.versionId).toBe('1');
        });

        it('does not increment versionId when incrementVersion is false', () => {
            const currentResource = {
                meta: { versionId: '3', lastUpdated: '2024-01-01', source: 'src', security: [] }
            };

            const result = resourceMerger.fastUpdateMeta({
                patched_resource_incoming: { meta: {} },
                currentResource,
                original_source: 'new-source',
                incrementVersion: false
            });

            expect(result.meta.versionId).toBe('3');
        });

        it('uses original_source when patched_resource_incoming has no source', () => {
            const currentResource = {
                meta: { versionId: '1', lastUpdated: '2024-01-01', source: 'old-src', security: [] }
            };

            const result = resourceMerger.fastUpdateMeta({
                patched_resource_incoming: { meta: {} },
                currentResource,
                original_source: 'incoming-src',
                incrementVersion: true
            });

            expect(result.meta.source).toBe('incoming-src');
        });

        it('preserves existing source on patched_resource_incoming', () => {
            const currentResource = {
                meta: { versionId: '1', lastUpdated: '2024-01-01', source: 'old-src', security: [] }
            };

            const result = resourceMerger.fastUpdateMeta({
                patched_resource_incoming: { meta: { source: 'keep-me' } },
                currentResource,
                original_source: 'incoming-src',
                incrementVersion: true
            });

            expect(result.meta.source).toBe('keep-me');
        });
    });

    describe('removeOwnerTagIfDisplayFieldMissing', () => {
        it('removes owner tag from currentResource when resourceToMerge has display but currentResource does not', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };
            const resourceToMerge = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell', display: 'B.Well' }] }
            };

            const result = resourceMerger.removeOwnerTagIfDisplayFieldMissing({ currentResource, resourceToMerge });
            const ownerTag = result.meta.security.find(s => s.system === 'https://www.icanbwell.com/owner');
            expect(ownerTag).toBeUndefined();
        });

        it('keeps owner tag when currentResource also has display', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell', display: 'B.Well' }] }
            };
            const resourceToMerge = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell', display: 'B.Well' }] }
            };

            const result = resourceMerger.removeOwnerTagIfDisplayFieldMissing({ currentResource, resourceToMerge });
            const ownerTag = result.meta.security.find(s => s.system === 'https://www.icanbwell.com/owner');
            expect(ownerTag).toBeDefined();
        });

        it('keeps owner tag when resourceToMerge has no display', () => {
            const currentResource = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };
            const resourceToMerge = {
                meta: { security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };

            const result = resourceMerger.removeOwnerTagIfDisplayFieldMissing({ currentResource, resourceToMerge });
            const ownerTag = result.meta.security.find(s => s.system === 'https://www.icanbwell.com/owner');
            expect(ownerTag).toBeDefined();
        });
    });

    describe('compareObjects when date-only changes are ignored', () => {
        const composition = (overrides = {}) => ({
            resourceType: 'Composition',
            id: 'c1',
            status: 'final',
            title: 'Summary',
            date: '2026-01-01T00:00:00.000Z',
            ...overrides
        });
        const mergerIgnoring = (resourceTypes) => new ResourceMerger({
            preSaveManager: mockPreSaveManager,
            configManager: { mergeIgnoreDateOnlyChangeResourceTypes: resourceTypes },
            groupMemberMerger: new GroupMemberMerger({ configManager: new ConfigManager() })
        });

        it.each([
            ['only the date changed', { date: '2026-02-02T00:00:00.000Z' }, []],
            ['the date was removed', { date: undefined }, []],
            ['the title changed', { title: 'Other' }, ['/title']],
            ['the title and the date changed', { title: 'Other', date: '2026-02-02T00:00:00.000Z' }, ['/date', '/title']],
            ['nothing changed', {}, []]
        ])('Composition: %s', (_name, change, expectedPaths) => {
            const merger = mergerIgnoring(['Composition']);
            const current = composition();
            const merged = composition(change);
            if (change.date === undefined && 'date' in change) {
                delete merged.date;
            }

            const patches = merger.compareObjects({
                currentObject: current,
                mergedObject: merged,
                ignoreDateOnlyChange: true
            });

            expect(patches.map(p => p.path).sort()).toEqual(expectedPaths);
        });

        it.each([
            ['the type is not listed', () => mergerIgnoring(['Observation'])],
            ['the list is empty', () => mergerIgnoring([])],
            [
                'no config manager is injected',
                () => new ResourceMerger({
                    preSaveManager: mockPreSaveManager,
                    groupMemberMerger: new GroupMemberMerger({ configManager: new ConfigManager() })
                })
            ]
        ])('still reports a date-only change when %s', (_name, buildMerger) => {
            const patches = buildMerger().compareObjects({
                currentObject: composition(),
                mergedObject: composition({ date: '2026-02-02T00:00:00.000Z' }),
                ignoreDateOnlyChange: true
            });

            expect(patches.map(p => p.path)).toEqual(['/date']);
        });

        it('only ignores the top-level date, not a nested one', () => {
            const merger = mergerIgnoring(['Composition']);
            const current = composition({ section: [{ title: 'a', text: { div: 'x' } }] });
            const merged = composition({ section: [{ title: 'b', text: { div: 'x' } }] });

            const patches = merger.compareObjects({
                currentObject: current,
                mergedObject: merged,
                ignoreDateOnlyChange: true
            });

            expect(patches.map(p => p.path)).toEqual(['/section/0/title']);
        });

        it('reports a date-only change when the caller does not ask to ignore it (PATCH)', () => {
            const patches = mergerIgnoring(['Composition']).compareObjects({
                currentObject: composition(),
                mergedObject: composition({ date: '2026-02-02T00:00:00.000Z' })
            });

            expect(patches.map(p => p.path)).toEqual(['/date']);
        });
    });
});
