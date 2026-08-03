'use strict';

/**
 * Unit tests for BundleManager
 *
 * Top 3 largest methods:
 * 1. createBundleFromEntries (lines 458-639)
 * 2. createRawBundleFromEntries (lines 240-431)
 * 3. createBundle (lines 59-123)
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

const { BundleManager } = require('../../../../operations/common/bundleManager');
const { ResourceManager } = require('../../../../operations/common/resourceManager');
const { QueryItem } = require('../../../../operations/graph/queryItem');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

describe('BundleManager', () => {
    let bundleManager;
    let mockResourceManager;

    beforeEach(() => {
        mockResourceManager = Object.create(ResourceManager.prototype);
        mockResourceManager.getFullUrlForResource = jest.fn().mockImplementation(({ protocol, host, base_version, resource }) => {
            return `${protocol}://${host}/${base_version}/${resource.resourceType}/${resource.id}`;
        });

        bundleManager = new BundleManager({ resourceManager: mockResourceManager });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('createBundle', () => {
        it('creates bundle with entries from resources', () => {
            const resources = [
                { id: 'obs-1', resourceType: 'Observation', _uuid: 'uuid-1' },
                { id: 'obs-2', resourceType: 'Observation', _uuid: 'uuid-2' }
            ];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createBundle({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: null,
                resources,
                base_version: '4_0_0',
                total_count: 2,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 1000,
                startTime: 0,
                user: 'test-user',
                explanations: []
            });

            expect(result.id).toBe('req-1');
            expect(result.total).toBe(2);
            expect(result.type).toBe('searchset');
            expect(mockResourceManager.getFullUrlForResource).toHaveBeenCalledTimes(2);
        });

        it('creates bundle with 0 resources', () => {
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createBundle({
                requestId: 'req-2',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                resources: [],
                base_version: '4_0_0',
                total_count: 0,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.total).toBe(0);
        });

        it('creates bundle with single resource', () => {
            const resources = [{ id: 'obs-1', resourceType: 'Observation', _uuid: 'uuid-1' }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createBundle({
                requestId: 'req-3',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                resources,
                base_version: '4_0_0',
                total_count: 1,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.total).toBe(1);
        });
    });

    describe('createRawBundleFromEntries', () => {
        it('creates raw bundle with self link when no last_id', () => {
            const entries = [{ id: 'obs-1', resource: { id: 'obs-1', resourceType: 'Observation' }, fullUrl: 'http://localhost/Observation/obs-1' }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: null,
                entries,
                total_count: 1,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.resourceType).toBe('Bundle');
            expect(result.link).toBeDefined();
            expect(result.link.length).toBe(1);
            expect(result.link[0].relation).toBe('self');
        });

        it('creates raw bundle with next link when last_id is present', () => {
            const entries = [{ id: 'obs-1', resource: { id: 'obs-1', resourceType: 'Observation' }, fullUrl: 'http://localhost/Observation/obs-1' }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: 'obs-1',
                entries,
                total_count: 10,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.link.length).toBe(2);
            expect(result.link[0].relation).toBe('self');
            expect(result.link[1].relation).toBe('next');
            expect(result.link[1].url).toContain('id%3Aabove=obs-1');
        });

        it('sets null entry when entries is empty', () => {
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                entries: [],
                total_count: 0,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.entry).toBeNull();
        });

        it('omits link when originalUrl is null', () => {
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: null,
                host: null,
                protocol: null,
                entries: [],
                total_count: null,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.link).toBeNull();
        });

        it('uses externalReqUrlPrefix in link URLs when provided', () => {
            const entries = [{ id: 'obs-1', resource: { id: 'obs-1', resourceType: 'Observation' }, fullUrl: 'http://example.com/Observation/obs-1' }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: 'obs-1',
                entries,
                total_count: 1,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: [],
                externalReqUrlPrefix: 'https://api.example.com/fhir'
            });

            expect(result.link[0].url).toContain('https://api.example.com/fhir');
            expect(result.link[0].url).not.toContain('localhost');
        });

        it('uses lastResourceLastUpdated for next link when provided', () => {
            const entries = [{ id: 'obs-1', resource: { id: 'obs-1', resourceType: 'Observation' } }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: null,
                entries,
                total_count: 10,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: [],
                lastResourceLastUpdated: '2024-01-15T10:00:00.000Z'
            });

            expect(result.link.length).toBe(2);
            expect(result.link[1].url).toContain('_lastUpdated=lt2024-01-15T10%3A00%3A00.000Z');
        });

        it('omits link for $everything operations', () => {
            const entries = [{ id: 'obs-1', resource: { id: 'obs-1', resourceType: 'Observation' } }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Patient/123/$everything',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: 'obs-1',
                entries,
                total_count: 10,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 100,
                startTime: 0,
                user: null,
                explanations: []
            });

            // For $everything, link is null since the url condition excludes everything operations
            expect(result.link).toBeNull();
        });

        it('includes debug/explain tags when _explain is true', () => {
            const entries = [];
            const originalQuery = new QueryItem({ query: { a: 1 }, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: true, _debug: false };

            const result = bundleManager.createRawBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                entries,
                total_count: 0,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(['_uuid', 'meta.security']),
                stopTime: 1000,
                startTime: 0,
                user: null,
                explanations: []
            });

            expect(result.meta).toBeDefined();
            expect(result.meta.tag).toBeDefined();
            const queryTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/query');
            expect(queryTag).toBeDefined();
        });
    });

    describe('createBundleFromEntries', () => {
        it('creates Bundle with next link when last_id provided', () => {
            const entries = [{ id: 'obs-1', resource: { id: 'obs-1', resourceType: 'Observation' } }];
            const originalQuery = new QueryItem({ query: {}, resourceType: 'Observation', collectionName: 'Observation_4_0_0' });
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                last_id: 'obs-last',
                entries,
                total_count: 50,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 200,
                startTime: 100,
                user: null,
                explanations: []
            });

            expect(result.type).toBe('searchset');
            expect(result.total).toBe(50);
        });

        it('handles array of QueryItems', () => {
            const entries = [];
            const originalQuery = [
                new QueryItem({ query: { a: 1 }, resourceType: 'Observation', collectionName: 'Observation_4_0_0' }),
                new QueryItem({ query: { b: 2 }, resourceType: 'Condition', collectionName: 'Condition_4_0_0' })
            ];
            const parsedArgs = { _explain: false, _debug: false };

            const result = bundleManager.createBundleFromEntries({
                requestId: 'req-1',
                type: 'searchset',
                originalUrl: '/4_0_0/Observation',
                host: 'localhost:3000',
                protocol: 'http',
                entries,
                total_count: 0,
                parsedArgs,
                originalQuery,
                originalOptions: {},
                columns: new Set(),
                stopTime: 200,
                startTime: 100,
                user: null,
                explanations: []
            });

            expect(result).toBeDefined();
        });
    });

    describe('removeDuplicateEntries', () => {
        it('returns empty array for empty input', () => {
            const result = bundleManager.removeDuplicateEntries({ entries: [] });
            expect(result).toEqual([]);
        });

        it('removes duplicates based on resourceType and _uuid', () => {
            const entries = [
                { id: 'e1', resource: { resourceType: 'Observation', _uuid: 'uuid-1' } },
                { id: 'e2', resource: { resourceType: 'Observation', _uuid: 'uuid-1' } },
                { id: 'e3', resource: { resourceType: 'Observation', _uuid: 'uuid-2' } }
            ];

            const result = bundleManager.removeDuplicateEntries({ entries });
            expect(result.length).toBe(2);
        });

        it('keeps entries with different resourceTypes even if same uuid', () => {
            const entries = [
                { id: 'e1', resource: { resourceType: 'Observation', _uuid: 'uuid-1' } },
                { id: 'e2', resource: { resourceType: 'Condition', _uuid: 'uuid-1' } }
            ];

            const result = bundleManager.removeDuplicateEntries({ entries });
            expect(result.length).toBe(2);
        });

        it('handles single entry', () => {
            const entries = [{ id: 'e1', resource: { resourceType: 'Observation', _uuid: 'uuid-1' } }];
            const result = bundleManager.removeDuplicateEntries({ entries });
            expect(result.length).toBe(1);
        });
    });

    describe('getQueryCollection', () => {
        it('returns joined collection names when allCollectionsToSearch is provided', () => {
            const result = bundleManager.getQueryCollection(['Observation_4_0_0', 'Condition_4_0_0'], 'default');
            expect(result).toBe('Observation_4_0_0,Condition_4_0_0');
        });

        it('returns collectionName when allCollectionsToSearch is undefined', () => {
            const result = bundleManager.getQueryCollection(undefined, 'Observation_4_0_0');
            expect(result).toBe('Observation_4_0_0');
        });
    });

    describe('getQueryOptions', () => {
        it('returns stringified options', () => {
            const result = bundleManager.getQueryOptions({ limit: 10, skip: 0 });
            expect(result).toContain('limit');
        });

        it('returns null for null input', () => {
            const result = bundleManager.getQueryOptions(null);
            expect(result).toBeNull();
        });
    });

    describe('getQueryFields', () => {
        it('returns stringified columns set', () => {
            const result = bundleManager.getQueryFields(new Set(['_uuid', 'meta.security']));
            expect(result).toContain('_uuid');
        });

        it('returns null for undefined columns', () => {
            const result = bundleManager.getQueryFields(undefined);
            expect(result).toBeNull();
        });
    });
});
