'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

const { GlobalIdEnrichmentProvider } = require('../../../enrich/providers/globalIdEnrichmentProvider');

describe('GlobalIdEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new GlobalIdEnrichmentProvider();
    });

    describe('enrichAsync - client-controlled header exposure', () => {
        test('Prefer: global_id=true replaces resource.id with internal _uuid', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-123',
                    _uuid: 'urn:uuid:internal-secret-uuid-value'
                }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('urn:uuid:internal-secret-uuid-value');
        });

        test('without Prefer header, resource id remains unchanged', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-123',
                    _uuid: 'urn:uuid:internal-secret-uuid-value'
                }
            ];
            const parsedArgs = { headers: {} };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('patient-123');
        });

        test('SECURITY: any client can request global_id=true to leak _uuid values', async () => {
            const resources = [
                {
                    resourceType: 'Observation',
                    id: 'obs-1',
                    _uuid: 'urn:uuid:cross-tenant-targeting-uuid'
                }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('urn:uuid:cross-tenant-targeting-uuid');
        });
    });

    describe('updateReferenceAsync - internal UUID leakage in references', () => {
        test('SECURITY: replaces reference with internal _uuid exposing cross-tenant identifiers', async () => {
            const reference = {
                reference: 'Patient/patient-123',
                _uuid: 'urn:uuid:secret-ref-uuid'
            };

            const result = await provider.updateReferenceAsync({ reference });

            expect(result.reference).toBe('urn:uuid:secret-ref-uuid');
        });

        test('reference without _uuid is left unchanged', async () => {
            const reference = { reference: 'Patient/patient-123' };

            const result = await provider.updateReferenceAsync({ reference });

            expect(result.reference).toBe('Patient/patient-123');
        });
    });

    describe('_preferGlobalIdInsideSelectedResources - sourceAssigningAuthority trust', () => {
        test('SECURITY: uses _sourceAssigningAuthority from resource to generate UUIDs without tenant validation', async () => {
            const resource = {
                resourceType: 'Subscription',
                _sourceAssigningAuthority: 'attacker-tenant',
                extension: [
                    {
                        url: 'https://icanbwell.com/codes/source_patient_id',
                        valueString: 'victim-patient-id'
                    }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(resource.extension[0].valueString).not.toBe('victim-patient-id');
            expect(resource.extension[0].valueString).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
        });

        test('non-Subscription resources are not affected', async () => {
            const resource = {
                resourceType: 'Patient',
                _sourceAssigningAuthority: 'some-authority',
                extension: [
                    {
                        url: 'https://fhir.icanbwell.com/4_0_0/StructureDefinition/patient',
                        valueString: 'patient-id'
                    }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(resource.extension[0].valueString).toBe('patient-id');
        });

        test('SECURITY: SubscriptionStatus identifier is transformed using resource-controlled sourceAssigningAuthority', async () => {
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'malicious-authority',
                identifier: [
                    {
                        system: 'https://icanbwell.com/codes/source_patient_id',
                        value: 'target-patient'
                    }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            expect(resource.identifier[0].value).not.toBe('target-patient');
            expect(resource.identifier[0].value).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            );
        });
    });

    describe('Prefer header parsing fragility', () => {
        test('SECURITY: header with global_id=true among multiple directives correctly triggers enrichment', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-123',
                    _uuid: 'urn:uuid:leaked-uuid'
                }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true; respond-async=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('urn:uuid:leaked-uuid');
        });

        test('SECURITY: crafted header without valid global_id=true directive should not trigger enrichment', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-123',
                    _uuid: 'urn:uuid:leaked-uuid'
                }
            ];
            const parsedArgs = { headers: { prefer: 'respond-async=true; return=representation' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('patient-123');
        });

        test('header parsing uses slice(-1) which checks last segment after split on =', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-123',
                    _uuid: 'urn:uuid:leaked-uuid'
                }
            ];
            // Crafted header: first part after split is not 'global_id' so won't match
            const parsedArgs = { headers: { prefer: 'something=global_id=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].id).toBe('patient-123');
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('propagates global_id enrichment to bundle entries', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        _uuid: 'urn:uuid:bundle-uuid'
                    }
                }
            ];
            const parsedArgs = { headers: { prefer: 'global_id=true' } };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource.id).toBe('urn:uuid:bundle-uuid');
            expect(result[0].id).toBe('urn:uuid:bundle-uuid');
        });
    });
});
