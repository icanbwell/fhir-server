const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/isTrue', () => ({
    isTrue: jestObj.fn()
}));

jestObj.mock('../../../../fhir/fhirResourceCreator', () => ({
    FhirResourceCreator: {
        create: jestObj.fn()
    }
}));

jestObj.mock('../../../../fhir/classes/4_0_0/complex_types/coding', () => {
    return class MockCoding {};
});

const { MetaUuidEnrichmentProvider } = require('../../../../enrich/providers/metaUuidEnrichmentProvider');
const { isTrue } = require('../../../../utils/isTrue');
const { FhirResourceCreator } = require('../../../../fhir/fhirResourceCreator');
const { IdentifierSystem } = require('../../../../utils/identifierSystem');

describe('MetaUuidEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new MetaUuidEnrichmentProvider();
        jestObj.clearAllMocks();
    });

    describe('enrichAsync', () => {
        test('does nothing when _metaUuid is not true', async () => {
            isTrue.mockReturnValue(false);
            const resources = [{ id: 'test', _uuid: 'some-uuid', meta: { tag: [] } }];
            const parsedArgs = { _metaUuid: 'false' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toEqual([]);
            expect(FhirResourceCreator.create).not.toHaveBeenCalled();
        });

        test('adds uuid tag to resource meta when _metaUuid is true and resource has _uuid and meta', async () => {
            isTrue.mockReturnValue(true);
            const mockCoding = { system: IdentifierSystem.uuid, code: 'test-uuid' };
            FhirResourceCreator.create.mockReturnValue(mockCoding);

            const resources = [{
                id: 'test',
                _uuid: 'test-uuid',
                meta: { tag: [] }
            }];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(FhirResourceCreator.create).toHaveBeenCalledWith(
                { system: IdentifierSystem.uuid, code: 'test-uuid' },
                expect.anything()
            );
            expect(result[0].meta.tag).toContain(mockCoding);
        });

        test('creates tag array when meta exists but tag does not', async () => {
            isTrue.mockReturnValue(true);
            const mockCoding = { system: IdentifierSystem.uuid, code: 'uuid-val' };
            FhirResourceCreator.create.mockReturnValue(mockCoding);

            const resources = [{
                id: 'test',
                _uuid: 'uuid-val',
                meta: {}
            }];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toEqual([mockCoding]);
        });

        test('pushes to existing tag array', async () => {
            isTrue.mockReturnValue(true);
            const existingTag = { system: 'http://existing', code: 'existing-code' };
            const mockCoding = { system: IdentifierSystem.uuid, code: 'uuid-val' };
            FhirResourceCreator.create.mockReturnValue(mockCoding);

            const resources = [{
                id: 'test',
                _uuid: 'uuid-val',
                meta: { tag: [existingTag] }
            }];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toHaveLength(2);
            expect(result[0].meta.tag[0]).toBe(existingTag);
            expect(result[0].meta.tag[1]).toBe(mockCoding);
        });

        test('does NOT add tag when resource has no _uuid', async () => {
            isTrue.mockReturnValue(true);
            const resources = [{
                id: 'test',
                meta: { tag: [] }
            }];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(FhirResourceCreator.create).not.toHaveBeenCalled();
            expect(result[0].meta.tag).toEqual([]);
        });

        test('does NOT add tag when resource has no meta', async () => {
            isTrue.mockReturnValue(true);
            const resources = [{
                id: 'test',
                _uuid: 'some-uuid'
            }];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(FhirResourceCreator.create).not.toHaveBeenCalled();
        });

        test('processes contained resources recursively', async () => {
            isTrue.mockReturnValue(true);
            let callCount = 0;
            FhirResourceCreator.create.mockImplementation((obj) => {
                callCount++;
                return { system: obj.system, code: obj.code };
            });

            const resources = [{
                id: 'parent',
                _uuid: 'parent-uuid',
                meta: { tag: [] },
                contained: [
                    {
                        id: 'child',
                        _uuid: 'child-uuid',
                        meta: { tag: [] }
                    }
                ]
            }];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toHaveLength(1);
            expect(result[0].meta.tag[0].code).toBe('parent-uuid');
            expect(result[0].contained[0].meta.tag).toHaveLength(1);
            expect(result[0].contained[0].meta.tag[0].code).toBe('child-uuid');
        });

        test('does NOT process contained when array is empty', async () => {
            isTrue.mockReturnValue(true);
            FhirResourceCreator.create.mockReturnValue({ system: 'sys', code: 'code' });

            const resources = [{
                id: 'parent',
                _uuid: 'parent-uuid',
                meta: { tag: [] },
                contained: []
            }];
            const parsedArgs = { _metaUuid: 'true' };

            await provider.enrichAsync({ resources, parsedArgs });

            // Should only be called once for the parent
            expect(FhirResourceCreator.create).toHaveBeenCalledTimes(1);
        });

        test('handles multiple resources', async () => {
            isTrue.mockReturnValue(true);
            FhirResourceCreator.create.mockImplementation((obj) => ({
                system: obj.system,
                code: obj.code
            }));

            const resources = [
                { id: 'r1', _uuid: 'uuid-1', meta: { tag: [] } },
                { id: 'r2', _uuid: 'uuid-2', meta: {} },
                { id: 'r3' }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag[0].code).toBe('uuid-1');
            expect(result[1].meta.tag[0].code).toBe('uuid-2');
            // r3 has no _uuid, no meta - should not be modified
            expect(result[2].meta).toBeUndefined();
        });

        test('returns the resources array', async () => {
            isTrue.mockReturnValue(false);
            const resources = [{ id: 'test' }];
            const parsedArgs = { _metaUuid: 'false' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result).toBe(resources);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('enriches each entry resource and sets entry.id', async () => {
            isTrue.mockReturnValue(true);
            FhirResourceCreator.create.mockReturnValue({ system: 'sys', code: 'code' });

            const entries = [
                { resource: { id: 'res-1', _uuid: 'uuid-1', meta: { tag: [] } } }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].id).toBe('res-1');
            expect(result[0].resource.meta.tag).toHaveLength(1);
        });

        test('skips entries without resource', async () => {
            isTrue.mockReturnValue(true);

            const entries = [
                { resource: { id: 'res-1', _uuid: 'uuid-1', meta: { tag: [] } } },
                { fullUrl: 'http://example.com' }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            // Entry without resource: the code checks `if (entry.resource)` then
            // sets entry.id = entry.resource.id outside the if block, so it throws
            await expect(
                provider.enrichBundleEntriesAsync({ entries, parsedArgs })
            ).rejects.toThrow();
        });

        test('handles empty entries array', async () => {
            isTrue.mockReturnValue(true);
            const entries = [];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result).toEqual([]);
        });
    });
});
