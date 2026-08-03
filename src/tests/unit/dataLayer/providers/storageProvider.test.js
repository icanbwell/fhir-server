'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { StorageProvider } = require('../../../../dataLayer/providers/storageProvider');

describe('StorageProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new StorageProvider();
    });

    describe('findAsync', () => {
        test('should throw "Not implemented" error', async () => {
            await expect(provider.findAsync({ query: {}, options: {} }))
                .rejects.toThrow('Not implemented: findAsync must be implemented by subclass');
        });

        test('should throw error even with empty params', async () => {
            await expect(provider.findAsync({}))
                .rejects.toThrow('Not implemented: findAsync must be implemented by subclass');
        });

        test('should throw Error instance', async () => {
            await expect(provider.findAsync({ query: { _id: '123' } }))
                .rejects.toBeInstanceOf(Error);
        });
    });

    describe('findOneAsync', () => {
        test('should throw "Not implemented" error', async () => {
            await expect(provider.findOneAsync({ query: {}, options: {} }))
                .rejects.toThrow('Not implemented: findOneAsync must be implemented by subclass');
        });

        test('should throw error even with empty params', async () => {
            await expect(provider.findOneAsync({}))
                .rejects.toThrow('Not implemented: findOneAsync must be implemented by subclass');
        });

        test('should throw Error instance', async () => {
            await expect(provider.findOneAsync({ query: { _id: '123' } }))
                .rejects.toBeInstanceOf(Error);
        });
    });

    describe('fastFindOneAsync', () => {
        test('should throw "Not implemented" error', async () => {
            await expect(provider.fastFindOneAsync({ query: {}, options: {} }))
                .rejects.toThrow('Not implemented: fastFindOneAsync must be implemented by subclass');
        });

        test('should throw error even with empty params', async () => {
            await expect(provider.fastFindOneAsync({}))
                .rejects.toThrow('Not implemented: fastFindOneAsync must be implemented by subclass');
        });

        test('should throw Error instance', async () => {
            await expect(provider.fastFindOneAsync({ query: { _id: '123' } }))
                .rejects.toBeInstanceOf(Error);
        });
    });

    describe('upsertAsync', () => {
        test('should throw "Not implemented" error', async () => {
            await expect(provider.upsertAsync({ resources: [], options: {} }))
                .rejects.toThrow('Not implemented: upsertAsync must be implemented by subclass');
        });

        test('should throw error even with empty params', async () => {
            await expect(provider.upsertAsync({}))
                .rejects.toThrow('Not implemented: upsertAsync must be implemented by subclass');
        });

        test('should throw Error instance', async () => {
            await expect(provider.upsertAsync({ resources: [{ id: '123' }] }))
                .rejects.toBeInstanceOf(Error);
        });
    });

    describe('countAsync', () => {
        test('should throw "Not implemented" error', async () => {
            await expect(provider.countAsync({ query: {} }))
                .rejects.toThrow('Not implemented: countAsync must be implemented by subclass');
        });

        test('should throw error even with empty params', async () => {
            await expect(provider.countAsync({}))
                .rejects.toThrow('Not implemented: countAsync must be implemented by subclass');
        });

        test('should throw Error instance', async () => {
            await expect(provider.countAsync({ query: { resourceType: 'Patient' } }))
                .rejects.toBeInstanceOf(Error);
        });
    });

    describe('getStorageType', () => {
        test('should throw "Not implemented" error', () => {
            expect(() => provider.getStorageType())
                .toThrow('Not implemented: getStorageType must be implemented by subclass');
        });

        test('should throw Error instance', () => {
            expect(() => provider.getStorageType())
                .toThrow(Error);
        });
    });

    describe('subclass implementation', () => {
        test('subclass can override findAsync', async () => {
            class TestProvider extends StorageProvider {
                async findAsync({ query, options }) {
                    return { results: [], query };
                }
            }

            const testProvider = new TestProvider();
            const result = await testProvider.findAsync({ query: { _id: '1' }, options: {} });
            expect(result).toEqual({ results: [], query: { _id: '1' } });
        });

        test('subclass can override findOneAsync', async () => {
            class TestProvider extends StorageProvider {
                async findOneAsync({ query }) {
                    return { id: '1', resourceType: 'Patient' };
                }
            }

            const testProvider = new TestProvider();
            const result = await testProvider.findOneAsync({ query: { _id: '1' } });
            expect(result).toEqual({ id: '1', resourceType: 'Patient' });
        });

        test('subclass can override fastFindOneAsync', async () => {
            class TestProvider extends StorageProvider {
                async fastFindOneAsync({ query }) {
                    return { id: '1', raw: true };
                }
            }

            const testProvider = new TestProvider();
            const result = await testProvider.fastFindOneAsync({ query: { _id: '1' } });
            expect(result).toEqual({ id: '1', raw: true });
        });

        test('subclass can override upsertAsync', async () => {
            class TestProvider extends StorageProvider {
                async upsertAsync({ resources }) {
                    return { inserted: resources.length };
                }
            }

            const testProvider = new TestProvider();
            const result = await testProvider.upsertAsync({ resources: [{ id: '1' }, { id: '2' }] });
            expect(result).toEqual({ inserted: 2 });
        });

        test('subclass can override countAsync', async () => {
            class TestProvider extends StorageProvider {
                async countAsync({ query }) {
                    return 42;
                }
            }

            const testProvider = new TestProvider();
            const result = await testProvider.countAsync({ query: {} });
            expect(result).toBe(42);
        });

        test('subclass can override getStorageType', () => {
            class TestProvider extends StorageProvider {
                getStorageType() {
                    return 'custom-storage';
                }
            }

            const testProvider = new TestProvider();
            expect(testProvider.getStorageType()).toBe('custom-storage');
        });

        test('subclass is instanceof StorageProvider', () => {
            class TestProvider extends StorageProvider {
                getStorageType() {
                    return 'test';
                }
            }

            const testProvider = new TestProvider();
            expect(testProvider).toBeInstanceOf(StorageProvider);
        });

        test('partial subclass still throws for unimplemented methods', async () => {
            class PartialProvider extends StorageProvider {
                async findAsync({ query }) {
                    return { results: [] };
                }

                getStorageType() {
                    return 'partial';
                }
            }

            const partialProvider = new PartialProvider();

            // Implemented methods work
            const findResult = await partialProvider.findAsync({ query: {} });
            expect(findResult).toEqual({ results: [] });
            expect(partialProvider.getStorageType()).toBe('partial');

            // Unimplemented methods still throw
            await expect(partialProvider.findOneAsync({ query: {} }))
                .rejects.toThrow('Not implemented: findOneAsync must be implemented by subclass');
            await expect(partialProvider.fastFindOneAsync({ query: {} }))
                .rejects.toThrow('Not implemented: fastFindOneAsync must be implemented by subclass');
            await expect(partialProvider.upsertAsync({ resources: [] }))
                .rejects.toThrow('Not implemented: upsertAsync must be implemented by subclass');
            await expect(partialProvider.countAsync({ query: {} }))
                .rejects.toThrow('Not implemented: countAsync must be implemented by subclass');
        });
    });
});
