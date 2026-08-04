const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
const mockIsUuid = jestObj.fn();
const mockGenerateUUIDv5 = jestObj.fn();

jestObj.mock('../../../utils/uid.util', () => ({
    isUuid: mockIsUuid,
    generateUUIDv5: mockGenerateUUIDv5
}));

jestObj.mock('../../../utils/securityTagSystem', () => ({
    SecurityTagSystem: {
        sourceAssigningAuthority: 'https://www.icanbwell.com/sourceAssigningAuthority'
    }
}));

jestObj.mock('../../../utils/identifierSystem', () => ({
    IdentifierSystem: {
        uuid: 'https://www.icanbwell.com/uuid',
        sourceId: 'https://www.icanbwell.com/sourceId'
    }
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((value, message) => {
        if (!value) {
            throw new Error(message || 'Assertion failed');
        }
    })
}));

jestObj.mock('../../../utils/resourceUpdater', () => ({
    resourceReferenceUpdater: jestObj.fn(async (resource, fn) => {
        // Simulate iterating over references in the resource
        if (resource._references) {
            for (const ref of resource._references) {
                await fn(ref);
            }
        }
    })
}));

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => {
    return class Resource {};
});

jestObj.mock('../../../fhir/classes/4_0_0/complex_types/reference', () => {
    return class Reference {};
});

const { ReferenceGlobalIdHandler } = require('../../../preSaveHandlers/handlers/referenceGlobalIdHandler');
const Resource = require('../../../fhir/classes/4_0_0/resources/resource');
const Reference = require('../../../fhir/classes/4_0_0/complex_types/reference');

describe('ReferenceGlobalIdHandler', () => {
    let handler;

    beforeEach(() => {
        handler = new ReferenceGlobalIdHandler();
        mockIsUuid.mockReset();
        mockGenerateUUIDv5.mockReset();
        mockGenerateUUIDv5.mockImplementation((input) => `uuid-for-${input}`);
    });

    describe('preSaveAsync', () => {
        test('throws when resource has no _sourceAssigningAuthority', async () => {
            const resource = {
                resourceType: 'Patient',
                id: '123'
            };

            await expect(handler.preSaveAsync({ resource })).rejects.toThrow(
                'sourceAssigningAuthority is null'
            );
        });

        test('uses updateReferencesAsync for Resource instances', async () => {
            const mockUpdateReferencesAsync = jestObj.fn(async ({ fnUpdateReferenceAsync }) => {
                const ref = { reference: 'Patient/123' };
                mockIsUuid.mockReturnValue(false);
                await fnUpdateReferenceAsync(ref);
            });

            const resource = Object.create(Resource.prototype);
            Object.assign(resource, {
                resourceType: 'Observation',
                id: 'obs-1',
                _sourceAssigningAuthority: 'testAuthority',
                updateReferencesAsync: mockUpdateReferencesAsync
            });

            await handler.preSaveAsync({ resource });

            expect(mockUpdateReferencesAsync).toHaveBeenCalled();
        });

        test('uses resourceReferenceUpdater for non-Resource instances', async () => {
            const { resourceReferenceUpdater } = require('../../../utils/resourceUpdater');
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/456' };
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _sourceAssigningAuthority: 'testAuthority',
                _references: [reference]
            };

            await handler.preSaveAsync({ resource });

            expect(resourceReferenceUpdater).toHaveBeenCalledWith(
                resource,
                expect.any(Function)
            );
        });

        test('returns the resource after processing', async () => {
            const resource = {
                resourceType: 'Patient',
                id: '123',
                _sourceAssigningAuthority: 'testAuthority',
                _references: []
            };

            const result = await handler.preSaveAsync({ resource });

            expect(result).toBe(resource);
        });
    });

    describe('updateReferenceAsync', () => {
        test('returns reference unchanged when reference.reference is empty', async () => {
            const reference = { reference: '' };

            const result = await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'testAuth',
                reference
            });

            expect(result).toBe(reference);
            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
        });

        test('returns reference unchanged when reference.reference is null', async () => {
            const reference = { reference: null };

            const result = await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'testAuth',
                reference
            });

            expect(result).toBe(reference);
        });

        test('returns reference unchanged when reference.reference is undefined', async () => {
            const reference = { reference: undefined };

            const result = await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'testAuth',
                reference
            });

            expect(result).toBe(reference);
        });

        test('generates UUID for non-UUID reference IDs', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/123' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'myAuthority',
                reference
            });

            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('123|myAuthority');
            expect(reference._uuid).toBe('Patient/uuid-for-123|myAuthority');
        });

        test('preserves existing UUID when reference ID is already UUID', async () => {
            mockIsUuid.mockReturnValue(true);

            const reference = { reference: 'Patient/550e8400-e29b-41d4-a716-446655440000' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'testAuth',
                reference
            });

            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
            expect(reference._uuid).toBe('Patient/550e8400-e29b-41d4-a716-446655440000');
        });

        test('sets _sourceId with resource type prefix', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Observation/obs-456' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth1',
                reference
            });

            expect(reference._sourceId).toBe('Observation/obs-456');
        });

        test('sets _sourceAssigningAuthority on reference', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/123' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'myAuth',
                reference
            });

            expect(reference._sourceAssigningAuthority).toBe('myAuth');
        });

        test('extracts sourceAssigningAuthority from pipe-separated reference ID', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/123|overrideAuth' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'parentAuth',
                reference
            });

            // Should use overrideAuth from the reference value, not parentAuth
            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('123|overrideAuth');
            expect(reference._sourceAssigningAuthority).toBe('overrideAuth');
            expect(reference._sourceId).toBe('Patient/123');
        });

        test('uses reference._sourceAssigningAuthority when no pipe in ID', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = {
                reference: 'Patient/456',
                _sourceAssigningAuthority: 'refAuth'
            };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'parentAuth',
                reference
            });

            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('456|refAuth');
            expect(reference._sourceAssigningAuthority).toBe('refAuth');
        });

        test('falls back to parent sourceAssigningAuthority when no override', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/789' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'parentAuth',
                reference
            });

            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('789|parentAuth');
            expect(reference._sourceAssigningAuthority).toBe('parentAuth');
        });

        test('handles references without resource type prefix', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'simpleId' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // No resource type prefix, so _uuid and _sourceId have no prefix
            expect(reference._uuid).toBe('uuid-for-simpleId|auth');
            expect(reference._sourceId).toBe('simpleId');
        });

        test('removes uuid extension from reference', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = {
                reference: 'Patient/123',
                extension: [
                    { url: 'https://www.icanbwell.com/uuid', valueString: 'old-uuid' },
                    { url: 'http://other.com/ext', valueString: 'keep' }
                ]
            };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            expect(reference.extension).toHaveLength(1);
            expect(reference.extension[0].url).toBe('http://other.com/ext');
        });

        test('removes sourceId extension from reference', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = {
                reference: 'Patient/123',
                extension: [
                    { url: 'https://www.icanbwell.com/sourceId', valueString: 'old-source' },
                    { url: 'http://custom.com/ext', valueString: 'stay' }
                ]
            };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            expect(reference.extension).toHaveLength(1);
            expect(reference.extension[0].url).toBe('http://custom.com/ext');
        });

        test('removes sourceAssigningAuthority extension from reference', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = {
                reference: 'Patient/123',
                extension: [
                    { url: 'https://www.icanbwell.com/sourceAssigningAuthority', valueString: 'old' },
                    { url: 'http://keep.com/ext', valueString: 'val' }
                ]
            };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            expect(reference.extension).toHaveLength(1);
            expect(reference.extension[0].url).toBe('http://keep.com/ext');
        });

        test('removes all three excluded extensions at once', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = {
                reference: 'Patient/123',
                extension: [
                    { url: 'https://www.icanbwell.com/uuid', valueString: 'u' },
                    { url: 'https://www.icanbwell.com/sourceId', valueString: 's' },
                    { url: 'https://www.icanbwell.com/sourceAssigningAuthority', valueString: 'a' },
                    { url: 'http://other.com/ext', valueString: 'keep' }
                ]
            };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            expect(reference.extension).toHaveLength(1);
            expect(reference.extension[0].url).toBe('http://other.com/ext');
        });

        test('deletes extension array for non-Reference when all extensions removed', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = {
                reference: 'Patient/123',
                extension: [
                    { url: 'https://www.icanbwell.com/uuid', valueString: 'u' }
                ]
            };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // For non-Reference instances, empty extension array is deleted
            expect(reference.extension).toBeUndefined();
        });

        test('does NOT delete extension array for Reference instances when empty', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = Object.create(Reference.prototype);
            Object.assign(reference, {
                reference: 'Patient/123',
                extension: [
                    { url: 'https://www.icanbwell.com/uuid', valueString: 'u' }
                ]
            });

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // For Reference instances, empty array is preserved (not deleted)
            expect(reference.extension).toEqual([]);
        });

        test('handles reference with no extensions property', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/123' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // Should not throw, and should set _uuid and _sourceId
            expect(reference._uuid).toBeDefined();
            expect(reference._sourceId).toBe('Patient/123');
        });

        test('handles reference with empty extensions array', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/123', extension: [] };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // Empty array with length 0 should not enter filter block
            expect(reference._uuid).toBeDefined();
        });

        test('throws when sourceAssigningAuthority is null', async () => {
            const reference = { reference: 'Patient/123' };

            await expect(
                handler.updateReferenceAsync({
                    sourceAssigningAuthority: null,
                    reference
                })
            ).rejects.toThrow('sourceAssigningAuthority is null');
        });

        test('throws when sourceAssigningAuthority is empty string', async () => {
            const reference = { reference: 'Patient/123' };

            await expect(
                handler.updateReferenceAsync({
                    sourceAssigningAuthority: '',
                    reference
                })
            ).rejects.toThrow('sourceAssigningAuthority is null');
        });
    });

    describe('reference parsing edge cases', () => {
        test('handles reference with multiple slashes (e.g., contained reference path)', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/some/path/123' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // Only the first part before first / is resourceType
            // The last part after last / is the id
            expect(reference._sourceId).toBe('Patient/123');
        });

        test('handles reference with pipe in ID extracting auth correctly', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Organization/org-1|clientAuth' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'defaultAuth',
                reference
            });

            expect(reference._sourceId).toBe('Organization/org-1');
            expect(reference._sourceAssigningAuthority).toBe('clientAuth');
            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('org-1|clientAuth');
        });

        test('correctly identifies resourceType from reference parts', async () => {
            mockIsUuid.mockReturnValue(false);
            mockGenerateUUIDv5.mockReturnValue('generated-uuid');

            const reference = { reference: 'Encounter/enc-789' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            expect(reference._uuid).toBe('Encounter/generated-uuid');
            expect(reference._sourceId).toBe('Encounter/enc-789');
        });

        test('handles UUID reference ID - does not regenerate UUID', async () => {
            mockIsUuid.mockReturnValue(true);

            const existingUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            const reference = { reference: `Patient/${existingUuid}` };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            expect(reference._uuid).toBe(`Patient/${existingUuid}`);
            expect(reference._sourceId).toBe(`Patient/${existingUuid}`);
            expect(mockGenerateUUIDv5).not.toHaveBeenCalled();
        });

        test('handles pipe in reference ID with UUID id part', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'Patient/abc|myAuth' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'defaultAuth',
                reference
            });

            // Pipe splits: id=abc, authority=myAuth
            expect(mockGenerateUUIDv5).toHaveBeenCalledWith('abc|myAuth');
            expect(reference._sourceAssigningAuthority).toBe('myAuth');
            expect(reference._sourceId).toBe('Patient/abc');
        });

        test('handles reference with only ID (no resource type, no pipe)', async () => {
            mockIsUuid.mockReturnValue(false);

            const reference = { reference: 'justAnId' };

            await handler.updateReferenceAsync({
                sourceAssigningAuthority: 'auth',
                reference
            });

            // No slash means referenceResourceType is null, prefix is ''
            expect(reference._uuid).toBe('uuid-for-justAnId|auth');
            expect(reference._sourceId).toBe('justAnId');
        });
    });
});
