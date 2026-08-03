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
                        url: 'https://fhir.icanbwell.com/4_0_0/StructureDefinition/patient',
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

        test('SECURITY: SubscriptionStatus identifier should not be transformed without tenant validation of sourceAssigningAuthority', async () => {
            const resource = {
                resourceType: 'SubscriptionStatus',
                _sourceAssigningAuthority: 'malicious-authority',
                identifier: [
                    {
                        system: 'https://fhir.icanbwell.com/4_0_0/StructureDefinition/patient',
                        value: 'target-patient'
                    }
                ]
            };

            await provider._preferGlobalIdInsideSelectedResources(resource);

            // CORRECT: should remain unchanged because sourceAssigningAuthority is not validated
            // FAILS: code blindly uses attacker-controlled sourceAssigningAuthority for UUID generation
            expect(resource.identifier[0].value).toBe('target-patient');
        });
    });

    describe('Prefer header parsing fragility', () => {
        test('SECURITY: header with multiple key=value pairs should not trigger global_id', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-123',
                    _uuid: 'urn:uuid:leaked-uuid'
                }
            ];
            // semicolon-separated prefer directives: "global_id=true; respond-async=true"
            // split('=') yields ['global_id', 'true; respond-async', 'true']
            // parts[0] === 'global_id' ✓ and parts.slice(-1)[0] === 'true' ✓ — false match
            const parsedArgs = { headers: { prefer: 'global_id=true; respond-async=true' } };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            // CORRECT: multi-directive header should be parsed properly and not match global_id
            // FAILS: naive split('=') parsing triggers UUID leak on multi-part Prefer headers
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
