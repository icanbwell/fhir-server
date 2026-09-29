const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

/**
 * Security tests for ProxyPatientReferenceEnrichmentProvider.
 *
 * These tests assert CORRECT behavior so they FAIL on buggy code:
 * 1. CRITICAL: Cross-tenant proxy patient IDs in patientToPersonMap must be rejected
 * 2. BUG: _uuid-based lookup exposes internal UUIDs — should not match on _uuid
 * 3. References are correctly rewritten to proxy format (happy path)
 * 4. Non-patient references are left unchanged
 * 5. rewritePatientReference=false skips enrichment entirely
 */

jestGlobal.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestGlobal.fn()
}));

jestGlobal.mock('../../../utils/isTrue', () => ({
    isTrueWithFallback: jestGlobal.fn((value, fallback) => {
        if (value !== undefined && value !== null) return value;
        return fallback;
    })
}));

jestGlobal.mock('../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestGlobal.mock('../../../operations/query/parsedArgs', () => ({
    ParsedArgs: class ParsedArgs {}
}));

jestGlobal.mock('../../../enrich/providers/enrichmentProvider', () => ({
    EnrichmentProvider: class EnrichmentProvider {}
}));

jestGlobal.mock('../../../utils/resourceUpdater', () => ({
    resourceReferenceUpdater: jestGlobal.fn(async (resource, updateFn) => {
        // Simulate walking all references in the resource
        if (resource._references) {
            for (const ref of resource._references) {
                await updateFn(ref);
            }
        }
    })
}));

const { ProxyPatientReferenceEnrichmentProvider } = require('../../../enrich/providers/proxyPatientReferenceEnrichmentProvider');
const { PERSON_PROXY_PREFIX, PATIENT_REFERENCE_PREFIX } = require('../../../constants');

describe('ProxyPatientReferenceEnrichmentProvider - Security', () => {
    let provider;
    let configManager;

    beforeEach(() => {
        configManager = {
            rewritePatientReference: true
        };
        provider = new ProxyPatientReferenceEnrichmentProvider({ configManager });
    });

    describe('Cross-tenant proxy patient vulnerability', () => {
        test('CRITICAL: rejects proxy patient mapping when patient belongs to different tenant', async () => {
            // BUG: The enrichment provider rewrites Patient references using patientToPersonMap
            // without verifying that the proxy patient belongs to the same tenant as the
            // requesting user. If a cross-tenant patient ID ends up in the map (from query
            // rewriter bugs), the provider will rewrite references to point to it.
            // CORRECT behavior: validate tenant ownership before rewriting.
            const patientToPersonMap = {
                'patient-tenant-A': 'person-tenant-B' // Cross-tenant: patient from A mapped to person from B
            };

            const parsedArgs = Object.create(require('../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestGlobal.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['Patient/person.person-tenant-B']
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-tenant-B'] }
            }];

            const resource = {
                resourceType: 'Patient',
                id: 'patient-tenant-A',
                _uuid: 'uuid-patient-tenant-A',
                _tenantId: 'tenant-A' // Resource belongs to tenant A
            };

            const resources = [resource];

            const result = await provider.enrichAsync({ resources, parsedArgs });

            // CORRECT behavior: The provider should NOT rewrite the id to a person from a
            // different tenant. It must verify tenant ownership.
            // If the rewrite happens without tenant validation, the id would become
            // `person.person-tenant-B` — which is the cross-tenant leak.
            const rewrittenPatient = result.find(r => r.resourceType === 'Patient');
            expect(rewrittenPatient.id).not.toContain('person-tenant-B');
        });
    });

    describe('Internal UUID exposure via _uuid lookup', () => {
        test('BUG: findPersonIdFromMap should not match on internal _uuid field', () => {
            // BUG: findPersonIdFromMap checks `patientToPersonMap[resource._uuid]` as a fallback
            // when resource.id doesn't match. The _uuid is an internal implementation detail that
            // should never be exposed or used as a lookup key accessible to external callers.
            // An attacker who guesses/enumerates _uuid values can trigger proxy rewrites.
            // CORRECT behavior: only match on resource.id, never on _uuid.
            const patientToPersonMap = {
                'internal-uuid-123': 'person-abc'
            };

            const resource = {
                id: 'patient-public-id', // public id does NOT match anything in map
                _uuid: 'internal-uuid-123' // internal UUID matches — this is the vulnerability
            };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            // CORRECT behavior: should NOT find a match via _uuid
            // The _uuid field is internal and should not be a valid lookup key
            expect(result).toBeUndefined();
        });

        test('BUG: findPersonIdFromMap with only _uuid match should not return person id', () => {
            const patientToPersonMap = {
                'uuid-hidden-field': 'leaked-person-id'
            };

            const resource = {
                id: 'different-id',
                _uuid: 'uuid-hidden-field'
            };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            // Internal _uuid should never be used as lookup — prevents enumeration attacks
            expect(result).toBeUndefined();
        });
    });

    describe('Happy path - reference rewriting', () => {
        test('rewrites Patient resource id to proxy format when mapped', async () => {
            const patientToPersonMap = {
                'patient-123': 'person-456'
            };

            const parsedArgs = Object.create(require('../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestGlobal.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['Patient/person.person-456']
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-456'] }
            }];

            const resource = {
                resourceType: 'Patient',
                id: 'patient-123',
                _uuid: 'uuid-patient-123',
                _references: []
            };

            const result = await provider.enrichAsync({ resources: [resource], parsedArgs });

            expect(result[0].id).toBe(`${PERSON_PROXY_PREFIX}person-456`);
        });

        test('rewrites patient references within resource to proxy format', async () => {
            const patientToPersonMap = {
                'patient-789': 'person-abc'
            };

            const parsedArgs = Object.create(require('../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestGlobal.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['Patient/patient-789']
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-abc'] }
            }];

            const reference = { reference: 'Patient/patient-789' };
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'uuid-obs-1',
                _references: [reference]
            };

            await provider.enrichAsync({ resources: [resource], parsedArgs });

            // The reference should be rewritten to point to the proxy patient
            expect(reference.reference).toBe(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}person-abc`);
        });
    });

    describe('Non-patient references left unchanged', () => {
        test('does not rewrite non-patient references', async () => {
            const patientToPersonMap = {
                'patient-123': 'person-456'
            };

            const parsedArgs = Object.create(require('../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestGlobal.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['Patient/patient-123']
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-456'] }
            }];

            const reference = { reference: 'Practitioner/doc-1' };
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'uuid-obs-1',
                _references: [reference]
            };

            await provider.enrichAsync({ resources: [resource], parsedArgs });

            // Non-patient reference must remain unchanged
            expect(reference.reference).toBe('Practitioner/doc-1');
        });
    });

    describe('rewritePatientReference=false skips enrichment', () => {
        test('returns resources unchanged when _rewritePatientReference is false', async () => {
            const parsedArgs = Object.create(require('../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = false;
            parsedArgs.get = jestGlobal.fn();
            parsedArgs.originalParsedArgItems = [];

            const resource = {
                resourceType: 'Patient',
                id: 'patient-original',
                _uuid: 'uuid-original',
                _references: []
            };

            const result = await provider.enrichAsync({ resources: [resource], parsedArgs });

            expect(result[0].id).toBe('patient-original');
            expect(parsedArgs.get).not.toHaveBeenCalled();
        });

        test('returns resources unchanged when configManager.rewritePatientReference is false and no override', async () => {
            configManager.rewritePatientReference = false;
            provider = new ProxyPatientReferenceEnrichmentProvider({ configManager });

            const parsedArgs = Object.create(require('../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = undefined; // no override, falls back to config
            parsedArgs.get = jestGlobal.fn();
            parsedArgs.originalParsedArgItems = [];

            const resource = {
                resourceType: 'Patient',
                id: 'patient-untouched',
                _uuid: 'uuid-untouched',
                _references: []
            };

            const result = await provider.enrichAsync({ resources: [resource], parsedArgs });

            expect(result[0].id).toBe('patient-untouched');
            expect(parsedArgs.get).not.toHaveBeenCalled();
        });
    });

    describe('findPersonIdFromMap - direct id match (valid behavior)', () => {
        test('returns person id when resource.id matches in map', () => {
            const patientToPersonMap = {
                'patient-direct': 'person-direct'
            };
            const resource = { id: 'patient-direct', _uuid: 'some-uuid' };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            expect(result).toBe('person-direct');
        });

        test('returns undefined when neither id nor _uuid matches', () => {
            const patientToPersonMap = {
                'other-patient': 'other-person'
            };
            const resource = { id: 'no-match', _uuid: 'also-no-match' };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            expect(result).toBeUndefined();
        });
    });
});
