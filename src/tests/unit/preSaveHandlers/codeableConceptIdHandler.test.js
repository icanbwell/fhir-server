const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
const mockGenerateUUIDv5 = jestObj.fn();
jestObj.mock('../../../utils/uid.util', () => ({
    generateUUIDv5: mockGenerateUUIDv5
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

const { CodeableConceptIdHandler } = require('../../../preSaveHandlers/handlers/codeableConceptIdHandler');
const Coding = require('../../../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');

describe('CodeableConceptIdHandler', () => {
    let handler;
    let mockConfigManager;

    beforeEach(() => {
        mockGenerateUUIDv5.mockReset();
        mockGenerateUUIDv5.mockReturnValue('generated-uuid-v5');

        mockConfigManager = {
            preSaveCodingIdUpdateResources: ['Patient', 'Observation']
        };

        handler = new CodeableConceptIdHandler({ configManager: mockConfigManager });
    });

    describe('preSaveAsync', () => {
        test('returns resource unchanged when resource is not an instance of Resource', async () => {
            const plainObject = { resourceType: 'Patient', id: '123' };

            const result = await handler.preSaveAsync({ resource: plainObject });

            expect(result).toBe(plainObject);
        });

        test('returns resource unchanged when resourceType is not in preSaveCodingIdUpdateResources', async () => {
            const resource = new Resource({ resourceType: 'Condition', id: '123' });
            // Override resourceType since Resource base class may not set it
            Object.defineProperty(resource, 'resourceType', { value: 'Condition', writable: true });

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('processes resource when resourceType is in preSaveCodingIdUpdateResources', async () => {
            const resource = new Resource({ resourceType: 'Patient', id: '123' });
            Object.defineProperty(resource, 'resourceType', { value: 'Patient', writable: true });

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });

        test('processes resource when "Resource" is in the config list', async () => {
            mockConfigManager.preSaveCodingIdUpdateResources = ['Resource'];
            const resource = new Resource({ resourceType: 'AnyType', id: '123' });
            Object.defineProperty(resource, 'resourceType', { value: 'AnyType', writable: true });

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });
    });

    describe('updateIfNeeded', () => {
        test('sets id on Coding instance with system and code but no id', () => {
            const coding = new Coding({ system: 'http://loinc.org', code: '12345' });

            const result = handler.updateIfNeeded(coding);

            expect(result).toBe(true);
            expect(coding.id).toBe('generated-uuid-v5');
            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('http://loinc.org|12345');
        });

        test('does not overwrite existing id on Coding instance', () => {
            const coding = new Coding({ system: 'http://loinc.org', code: '12345', id: 'existing-id' });

            const result = handler.updateIfNeeded(coding);

            // Should not update since id already exists
            expect(coding.id).toBe('existing-id');
            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
        });

        test('does not set id on Coding without system', () => {
            const coding = new Coding({ code: '12345' });

            handler.updateIfNeeded(coding);

            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
        });

        test('does not set id on Coding without code', () => {
            const coding = new Coding({ system: 'http://loinc.org' });

            handler.updateIfNeeded(coding);

            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
        });

        test('recursively processes nested objects with Coding instances', () => {
            const coding = new Coding({ system: 'http://snomed.info', code: '999', id: undefined });
            // Remove id property explicitly
            delete coding.id;
            const resource = {
                category: {
                    coding: [coding]
                }
            };

            const result = handler.updateIfNeeded(resource);

            expect(result).toBe(true);
            expect(coding.id).toBe('generated-uuid-v5');
            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('http://snomed.info|999');
        });

        test('recursively processes arrays containing Coding instances', () => {
            const coding1 = new Coding({ system: 'http://sys1.org', code: 'A' });
            const coding2 = new Coding({ system: 'http://sys2.org', code: 'B' });
            delete coding1.id;
            delete coding2.id;

            mockGenerateUUIDv5
                .mockReturnValueOnce('uuid-1')
                .mockReturnValueOnce('uuid-2');

            const resource = {
                codes: [coding1, coding2]
            };

            const result = handler.updateIfNeeded(resource);

            expect(result).toBe(true);
            expect(coding1.id).toBe('uuid-1');
            expect(coding2.id).toBe('uuid-2');
        });

        test('returns false when no Coding instances need updating', () => {
            const resource = {
                name: 'test',
                value: 42,
                nested: { foo: 'bar' }
            };

            const result = handler.updateIfNeeded(resource);

            expect(result).toBe(false);
            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
        });

        test('returns false for primitive values', () => {
            const result = handler.updateIfNeeded('string');

            expect(result).toBe(false);
        });

        test('handles deeply nested Coding instances', () => {
            const coding = new Coding({ system: 'http://deep.org', code: 'deep-code' });
            delete coding.id;

            const resource = {
                level1: {
                    level2: {
                        level3: {
                            coding: [coding]
                        }
                    }
                }
            };

            const result = handler.updateIfNeeded(resource);

            expect(result).toBe(true);
            expect(coding.id).toBe('generated-uuid-v5');
            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('http://deep.org|deep-code');
        });

        test('handles mixed arrays with Coding and non-Coding objects', () => {
            const coding = new Coding({ system: 'http://mix.org', code: 'mix' });
            delete coding.id;

            const resource = {
                items: [
                    { name: 'plain object' },
                    coding,
                    42,
                    'string',
                    null
                ]
            };

            const result = handler.updateIfNeeded(resource);

            expect(result).toBe(true);
            expect(coding.id).toBe('generated-uuid-v5');
        });

        test('does not process null values in objects', () => {
            const resource = {
                nullField: null,
                name: 'test'
            };

            const result = handler.updateIfNeeded(resource);

            expect(result).toBe(false);
        });

        test('processes all Coding instances in a resource, not just the first', () => {
            const coding1 = new Coding({ system: 'http://sys1.org', code: 'A' });
            const coding2 = new Coding({ system: 'http://sys2.org', code: 'B' });
            const coding3 = new Coding({ system: 'http://sys3.org', code: 'C' });
            delete coding1.id;
            delete coding2.id;
            delete coding3.id;

            mockGenerateUUIDv5
                .mockReturnValueOnce('uuid-A')
                .mockReturnValueOnce('uuid-B')
                .mockReturnValueOnce('uuid-C');

            const resource = {
                category: { coding: [coding1] },
                type: { coding: [coding2] },
                severity: { coding: [coding3] }
            };

            handler.updateIfNeeded(resource);

            expect(coding1.id).toBe('uuid-A');
            expect(coding2.id).toBe('uuid-B');
            expect(coding3.id).toBe('uuid-C');
        });
    });

    describe('processResource', () => {
        test('calls updateIfNeeded with the resource', async () => {
            const resource = new Resource({ resourceType: 'Patient', id: '123' });
            Object.defineProperty(resource, 'resourceType', { value: 'Patient', writable: true });

            const spy = jestObj.spyOn(handler, 'updateIfNeeded');

            await handler.processResource(resource);

            expect(spy).toHaveBeenCalledWith(resource);
        });
    });
});
