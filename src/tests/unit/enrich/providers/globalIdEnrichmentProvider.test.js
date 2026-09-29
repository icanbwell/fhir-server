const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/uid.util', () => ({
    isUuid: jestObj.fn(),
    generateUUIDv5: jestObj.fn()
}));

jestObj.mock('../../../../utils/resourceUpdater', () => ({
    resourceReferenceUpdater: jestObj.fn()
}));

const { GlobalIdEnrichmentProvider } = require('../../../../enrich/providers/globalIdEnrichmentProvider');
const { isUuid, generateUUIDv5 } = require('../../../../utils/uid.util');
const { resourceReferenceUpdater } = require('../../../../utils/resourceUpdater');
const { SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM } = require('../../../../constants');

describe('GlobalIdEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new GlobalIdEnrichmentProvider();
        jestObj.clearAllMocks();
        resourceReferenceUpdater.mockResolvedValue(undefined);
    });

    describe('enrichAsync', () => {
        test('does nothing when no prefer header is present', async () => {
            const resources = [{ id: 'test-id', _uuid: 'uuid-123' }];
            const parsedArgs = { headers: {} };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('test-id');
        });

        test('does nothing when parsedArgs has no headers', async () => {
            const resources = [{ id: 'test-id', _uuid: 'uuid-123' }];
            const parsedArgs = {};

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('test-id');
        });

        test('does nothing when prefer header is not global_id=true', async () => {
            const resources = [{ id: 'test-id', _uuid: 'uuid-123' }];
            const parsedArgs = { headers: { prefer: 'return=minimal' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('test-id');
        });

        test('does nothing when global_id is false', async () => {
            const resources = [{ id: 'test-id', _uuid: 'uuid-123' }];
            const parsedArgs = { headers: { prefer: 'global_id=false' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('test-id');
        });

        test('replaces id with _uuid when prefer header is global_id=true and id is not a uuid', async () => {
            isUuid.mockReturnValue(false);
            const resources = [{ id: 'Patient/123', _uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        });

        test('does NOT replace id when id is already a uuid', async () => {
            isUuid.mockReturnValue(true);
            const resources = [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', _uuid: 'new-uuid' }];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        });

        test('does NOT replace id when _uuid is not present', async () => {
            isUuid.mockReturnValue(false);
            const resources = [{ id: 'test-id' }];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('test-id');
        });

        test('handles Prefer header with capital P', async () => {
            isUuid.mockReturnValue(false);
            const resources = [{ id: 'test-id', _uuid: 'uuid-value' }];
            const parsedArgs = { headers: { Prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('uuid-value');
        });

        test('processes contained resources recursively', async () => {
            isUuid.mockReturnValue(false);
            const resources = [{
                id: 'parent-id',
                _uuid: 'parent-uuid',
                contained: [
                    { id: 'child-id', _uuid: 'child-uuid' }
                ]
            }];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('parent-uuid');
            expect(result[0].contained[0].id).toBe('child-uuid');
        });

        test('does NOT process contained when array is empty', async () => {
            isUuid.mockReturnValue(false);
            const resources = [{
                id: 'parent-id',
                _uuid: 'parent-uuid',
                contained: []
            }];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('parent-uuid');
        });

        test('calls resourceReferenceUpdater for each resource', async () => {
            isUuid.mockReturnValue(false);
            const resources = [
                { id: 'id-1', _uuid: 'uuid-1' },
                { id: 'id-2', _uuid: 'uuid-2' }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            await provider.enrichAsync({ resources, parsedArgs });

            expect(resourceReferenceUpdater).toHaveBeenCalledTimes(2);
        });

        test('handles resource without id field', async () => {
            isUuid.mockReturnValue(false);
            const resources = [{ _uuid: 'uuid-value' }];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            // id is undefined so the condition `resource.id && !isUuid(resource.id)` is false
            expect(result[0].id).toBeUndefined();
        });
    });

    describe('_preferGlobalIdInsideSelectedResources', () => {
        test('does nothing for non-Subscription resourceType', async () => {
            const resource = {
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'auth1',
                extension: [{ url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, valueString: 'val1' }]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('does nothing when no _sourceAssigningAuthority', async () => {
            const resource = {
                resourceType: 'SubscriptionStatus',
                extension: [{ url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, valueString: 'val1' }]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('does nothing when no resourceType', async () => {
            const resource = {
                _sourceAssigningAuthority: 'auth1',
                extension: [{ url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, valueString: 'val1' }]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('updates extension valueString for patient reference system on Subscription resource', async () => {
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue('generated-uuid');
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                extension: [
                    { url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, valueString: 'patient-123' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).toHaveBeenCalledWith('patient-123|auth1');
            expect(resource.extension[0].valueString).toBe('generated-uuid');
        });

        test('updates extension valueString for person reference system on Subscription resource', async () => {
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue('generated-uuid-person');
            const resource = {
                resourceType: 'SubscriptionTopic',
                _sourceAssigningAuthority: 'auth2',
                extension: [
                    { url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person, valueString: 'person-456' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).toHaveBeenCalledWith('person-456|auth2');
            expect(resource.extension[0].valueString).toBe('generated-uuid-person');
        });

        test('does NOT update extension valueString when it is already a uuid', async () => {
            isUuid.mockReturnValue(true);
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                extension: [
                    { url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, valueString: 'already-a-uuid' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
            expect(resource.extension[0].valueString).toBe('already-a-uuid');
        });

        test('does NOT update extension with non-matching url', async () => {
            isUuid.mockReturnValue(false);
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                extension: [
                    { url: 'http://other-system.com', valueString: 'val1' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('updates identifier value for patient reference system', async () => {
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue('gen-uuid-ident');
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                identifier: [
                    { system: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, value: 'patient-id-1' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).toHaveBeenCalledWith('patient-id-1|auth1');
            expect(resource.identifier[0].value).toBe('gen-uuid-ident');
        });

        test('updates identifier value for person reference system', async () => {
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue('gen-uuid-person-ident');
            const resource = {
                resourceType: 'SubscriptionTopic',
                _sourceAssigningAuthority: 'auth1',
                identifier: [
                    { system: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.person, value: 'person-id-1' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).toHaveBeenCalledWith('person-id-1|auth1');
            expect(resource.identifier[0].value).toBe('gen-uuid-person-ident');
        });

        test('does NOT update identifier when value is already a uuid', async () => {
            isUuid.mockReturnValue(true);
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                identifier: [
                    { system: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient, value: 'existing-uuid' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('does NOT update identifier with non-matching system', async () => {
            isUuid.mockReturnValue(false);
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                identifier: [
                    { system: 'http://other.system', value: 'some-id' }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('handles missing extension field', async () => {
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1'
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('handles missing identifier field', async () => {
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1'
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('handles extension without valueString', async () => {
            isUuid.mockReturnValue(false);
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                extension: [
                    { url: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });

        test('handles identifier without value', async () => {
            isUuid.mockReturnValue(false);
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'auth1',
                identifier: [
                    { system: SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM.patient }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(generateUUIDv5).not.toHaveBeenCalled();
        });
    });

    describe('updateReferenceAsync', () => {
        test('updates reference.reference with reference._uuid when both exist', async () => {
            const reference = { reference: 'Patient/123', _uuid: 'Patient/uuid-123' };

            const result = await provider.updateReferenceAsync({ reference });

            expect(result.reference).toBe('Patient/uuid-123');
        });

        test('does NOT update when reference.reference is missing', async () => {
            const reference = { _uuid: 'Patient/uuid-123' };

            const result = await provider.updateReferenceAsync({ reference });

            expect(result.reference).toBeUndefined();
        });

        test('does NOT update when reference._uuid is missing', async () => {
            const reference = { reference: 'Patient/123' };

            const result = await provider.updateReferenceAsync({ reference });

            expect(result.reference).toBe('Patient/123');
        });

        test('does NOT update when both are missing', async () => {
            const reference = {};

            const result = await provider.updateReferenceAsync({ reference });

            expect(result.reference).toBeUndefined();
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('enriches each bundle entry resource and updates entry.id', async () => {
            isUuid.mockReturnValue(false);
            const entries = [
                { resource: { id: 'res-1', _uuid: 'uuid-1' } },
                { resource: { id: 'res-2', _uuid: 'uuid-2' } }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource.id).toBe('uuid-1');
            expect(result[0].id).toBe('uuid-1');
            expect(result[1].resource.id).toBe('uuid-2');
            expect(result[1].id).toBe('uuid-2');
        });

        test('sets entry.id from resource.id even when not enriched', async () => {
            const entries = [
                { resource: { id: 'unchanged-id' } }
            ];
            const parsedArgs = { headers: {} };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].id).toBe('unchanged-id');
        });

        test('handles entries with no resource', async () => {
            isUuid.mockReturnValue(false);
            const entries = [
                { resource: { id: 'res-1', _uuid: 'uuid-1' } },
                { fullUrl: 'http://example.com' }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            // The second entry has no resource, so accessing entry.resource.id would throw
            // But the code checks `if (entry.resource)` first, then sets entry.id = entry.resource.id
            // For entries without resource, entry.resource is falsy so the assignment after the if block will fail
            // Actually looking at the code: the entry.id = entry.resource.id is OUTSIDE the if block
            // So it will throw if entry.resource is undefined
            await expect(
                provider.enrichBundleEntriesAsync({ entries, parsedArgs })
            ).rejects.toThrow();
        });
    });
});
