const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock FhirResourceCreator to avoid deep FHIR class instantiation
jestGlobal.mock('../../../../fhir/fhirResourceCreator', () => {
    return {
        FhirResourceCreator: {
            create: (doc) => {
                const resource = { ...doc };
                resource.clone = () => {
                    const cloned = { ...resource };
                    cloned.clone = resource.clone;
                    cloned.toJSONInternal = resource.toJSONInternal;
                    return cloned;
                };
                resource.toJSONInternal = () => {
                    const copy = { ...resource };
                    delete copy.clone;
                    delete copy.toJSONInternal;
                    return copy;
                };
                return resource;
            }
        }
    };
});

const { FixPersonLinksRunner } = require('../../../../admin/runners/fixPersonLinksRunner');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { ResourceLocatorFactory } = require('../../../../operations/common/resourceLocatorFactory');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');

// Create mock instances that pass assertTypeEquals checks
function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('FixPersonLinksRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockPreSaveManager;
    let mockResourceLocatorFactory;
    let mockDatabaseQueryFactory;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.getAuditConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.getDatabaseForResourceAsync = jestGlobal.fn().mockResolvedValue({
            collection: jestGlobal.fn().mockReturnValue({
                aggregate: jestGlobal.fn().mockReturnValue({ toArray: jestGlobal.fn().mockResolvedValue([]) })
            })
        });

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory);
        mockResourceLocatorFactory.createResourceLocator = jestGlobal.fn().mockReturnValue({
            getCollectionName: () => 'Person_4_0_0'
        });

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
            findOneAsync: jestGlobal.fn().mockResolvedValue(null)
        });

        runner = new FixPersonLinksRunner({
            batchSize: 100,
            beforeLastUpdatedDate: undefined,
            databaseQueryFactory: mockDatabaseQueryFactory,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            preSaveManager: mockPreSaveManager,
            preloadCollections: ['Person_4_0_0'],
            resourceLocatorFactory: mockResourceLocatorFactory,
            limit: undefined,
            skip: undefined,
            minLinks: 20
        });
    });

    // =====================================================
    // Tests for isPersonSame
    // =====================================================
    describe('isPersonSame', () => {
        test('returns true when emails match', () => {
            const resource = { telecom: [{ system: 'email', value: 'test@example.com' }] };
            const linkedResource = { telecom: [{ system: 'email', value: 'test@example.com' }] };
            expect(runner.isPersonSame(resource, linkedResource)).toBe(true);
        });

        test('returns false when emails do not match', () => {
            const resource = { telecom: [{ system: 'email', value: 'a@example.com' }] };
            const linkedResource = { telecom: [{ system: 'email', value: 'b@example.com' }] };
            expect(runner.isPersonSame(resource, linkedResource)).toBe(false);
        });

        test('falls back to name comparison when no emails', () => {
            const resource = { name: [{ family: 'Smith', given: ['John'] }] };
            const linkedResource = { name: [{ family: 'Smith', given: ['John'] }] };
            expect(runner.isPersonSame(resource, linkedResource)).toBe(true);
        });

        test('returns false when names differ', () => {
            const resource = { name: [{ family: 'Smith', given: ['John'] }] };
            const linkedResource = { name: [{ family: 'Doe', given: ['Jane'] }] };
            expect(runner.isPersonSame(resource, linkedResource)).toBe(false);
        });

        test('returns false when neither telecom nor name present', () => {
            const resource = {};
            const linkedResource = {};
            expect(runner.isPersonSame(resource, linkedResource)).toBe(false);
        });

        // BUG TEST: name[0].given is null/undefined - causes TypeError
        test('BUG: crashes when name exists but given is null', () => {
            const resource = { name: [{ family: 'Smith', given: null }] };
            const linkedResource = { name: [{ family: 'Smith', given: ['John'] }] };
            // line 115: currentPersonName.given.join(',') throws TypeError: Cannot read properties of null
            expect(() => {
                runner.isPersonSame(resource, linkedResource);
            }).toThrow(TypeError);
        });

        // BUG TEST: name[0].given is undefined - causes TypeError
        test('BUG: crashes when name exists but given is undefined', () => {
            const resource = { name: [{ family: 'Smith' }] };
            const linkedResource = { name: [{ family: 'Smith', given: ['John'] }] };
            // line 115: currentPersonName.given.join(',') throws TypeError: Cannot read properties of undefined
            expect(() => {
                runner.isPersonSame(resource, linkedResource);
            }).toThrow(TypeError);
        });

        // BUG TEST: linkedResource name[0].given is undefined
        test('BUG: crashes when linkedResource name has given undefined', () => {
            const resource = { name: [{ family: 'Smith', given: ['John'] }] };
            const linkedResource = { name: [{ family: 'Smith' }] };
            // line 115: linkedPersonName.given.join(',') throws TypeError
            expect(() => {
                runner.isPersonSame(resource, linkedResource);
            }).toThrow(TypeError);
        });
    });

    // =====================================================
    // Tests for fixLinks
    // =====================================================
    describe('fixLinks', () => {
        test('returns resource unchanged when no links', async () => {
            const resource = { link: null };
            const result = await runner.fixLinks(resource);
            expect(result).toBe(resource);
        });

        test('returns resource unchanged when links array is empty', async () => {
            const resource = { link: [] };
            const result = await runner.fixLinks(resource);
            expect(result.link).toEqual([]);
        });

        test('keeps links that are not Person references', async () => {
            const resource = {
                link: [
                    { target: { reference: 'Patient/p-1', type: 'Patient' } }
                ]
            };
            const result = await runner.fixLinks(resource);
            expect(result.link).toHaveLength(1);
        });

        test('skips links where reference.reference is falsy', async () => {
            const resource = {
                link: [
                    { target: { reference: null, type: 'Person' } }
                ]
            };
            const result = await runner.fixLinks(resource);
            expect(result.link).toHaveLength(0);
        });

        test('removes Person links when uuid not in cache and DB lookup returns null', async () => {
            const resource = {
                name: [{ family: 'Smith', given: ['John'] }],
                link: [
                    {
                        target: {
                            reference: 'Person/p-1',
                            _uuid: 'Person/uuid-1',
                            type: 'Person'
                        }
                    }
                ]
            };

            const result = await runner.fixLinks(resource);
            // Should be removed since DB lookup returns null
            expect(result.link).toHaveLength(0);
        });

        test('keeps Person links when found in cache and person is same', async () => {
            const resource = {
                telecom: [{ system: 'email', value: 'test@example.com' }],
                link: [
                    {
                        target: {
                            reference: 'Person/p-1',
                            _uuid: 'Person/uuid-1',
                            type: 'Person'
                        }
                    }
                ]
            };

            // Set up cache
            runner.caches.set('Person_4_0_0', new Map([
                ['uuid-1', { _uuid: 'uuid-1', telecom: [{ system: 'email', value: 'test@example.com' }], name: [] }]
            ]));

            const result = await runner.fixLinks(resource);
            expect(result.link).toHaveLength(1);
        });
    });

    // =====================================================
    // Tests for processRecordAsync
    // =====================================================
    describe('processRecordAsync', () => {
        test('returns empty operations when doc has no meta', async () => {
            const doc = { resourceType: 'Person' };
            const result = await runner.processRecordAsync(doc);
            expect(result).toEqual([]);
        });

        test('returns empty operations when doc has no meta.security', async () => {
            const doc = { resourceType: 'Person', meta: {} };
            const result = await runner.processRecordAsync(doc);
            expect(result).toEqual([]);
        });
    });

    // =====================================================
    // Tests for preloadCollectionAsync - cursor.next() null safety
    // =====================================================
    describe('preloadCollectionAsync', () => {
        test('BUG: crashes when cursor.next() returns null', async () => {
            // When cursor.hasNext() returns true but next() returns null (edge case)
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn().mockResolvedValueOnce(null)
            };
            const mockSourceCollection = {
                find: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            runner.createConnectionAsync = jestGlobal.fn().mockResolvedValue({
                sourceCollection: mockSourceCollection
            });

            const mongoConfig = { connection: 'mongodb://localhost', db_name: 'test', options: {} };

            // Line 298: doc._uuid will crash if doc is null
            await expect(async () => {
                await runner.preloadCollectionAsync({ mongoConfig, collectionName: 'Person_4_0_0' });
            }).rejects.toThrow(TypeError);
        });

        test('successfully caches documents from cursor', async () => {
            const mockDoc = { _uuid: 'uuid-1', telecom: [{ system: 'email', value: 'test@example.com' }], name: [{ family: 'Smith' }] };
            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn().mockResolvedValueOnce(mockDoc)
            };
            const mockSourceCollection = {
                find: jestGlobal.fn().mockReturnValue(mockCursor)
            };

            runner.createConnectionAsync = jestGlobal.fn().mockResolvedValue({
                sourceCollection: mockSourceCollection
            });

            const mongoConfig = { connection: 'mongodb://localhost', db_name: 'test', options: {} };
            await runner.preloadCollectionAsync({ mongoConfig, collectionName: 'Person_4_0_0' });

            const cache = runner.getCacheForResourceType({ collectionName: 'Person_4_0_0' });
            expect(cache.has('uuid-1')).toBe(true);
            expect(cache.get('uuid-1').telecom).toEqual([{ system: 'email', value: 'test@example.com' }]);
        });
    });

    // =====================================================
    // Tests for getCacheForResourceType
    // =====================================================
    describe('getCacheForResourceType', () => {
        test('creates new cache when not existing', () => {
            const cache = runner.getCacheForResourceType({ collectionName: 'New_Collection' });
            expect(cache).toBeInstanceOf(Map);
            expect(cache.size).toBe(0);
        });

        test('returns same cache on subsequent calls', () => {
            const cache1 = runner.getCacheForResourceType({ collectionName: 'Test_Collection' });
            cache1.set('key1', 'val1');
            const cache2 = runner.getCacheForResourceType({ collectionName: 'Test_Collection' });
            expect(cache2.get('key1')).toBe('val1');
        });
    });
});
