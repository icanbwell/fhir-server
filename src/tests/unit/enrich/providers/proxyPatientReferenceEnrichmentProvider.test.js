'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../utils/isTrue', () => ({
    isTrueWithFallback: jestObj.fn((value, fallback) => {
        if (value !== undefined && value !== null) return value;
        return fallback;
    })
}));

jestObj.mock('../../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../../operations/query/parsedArgs', () => ({
    ParsedArgs: class ParsedArgs {}
}));

jestObj.mock('../../../../enrich/providers/enrichmentProvider', () => ({
    EnrichmentProvider: class EnrichmentProvider {}
}));

jestObj.mock('../../../../utils/resourceUpdater', () => ({
    resourceReferenceUpdater: jestObj.fn(async (resource, updateFn) => {
        // Simulate walking all reference-bearing properties in the resource
        if (resource._references) {
            for (const ref of resource._references) {
                await updateFn(ref);
            }
        }
    })
}));

const { ProxyPatientReferenceEnrichmentProvider } = require('../../../../enrich/providers/proxyPatientReferenceEnrichmentProvider');
const { PERSON_PROXY_PREFIX, PATIENT_REFERENCE_PREFIX } = require('../../../../constants');

describe('ProxyPatientReferenceEnrichmentProvider', () => {
    let provider;
    let configManager;

    beforeEach(() => {
        configManager = {
            rewritePatientReference: true
        };
        provider = new ProxyPatientReferenceEnrichmentProvider({ configManager });
    });

    describe('constructor', () => {
        test('sets configManager property', () => {
            expect(provider.configManager).toBe(configManager);
        });
    });

    describe('getProxyPatientFromArgs', () => {
        test('returns proxyPatientPersonId when value starts with Patient/person.', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'patient',
                        queryParameterValue: { values: ['Patient/person.person-123'] }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBe('Patient/person.person-123');
            expect(result.proxyPatientPersonIdKey).toBe('patient');
        });

        test('returns proxyPatientPersonId when value starts with person. (without Patient/ prefix)', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'subject',
                        queryParameterValue: { values: ['person.person-456'] }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBe('person.person-456');
            expect(result.proxyPatientPersonIdKey).toBe('subject');
        });

        test('returns null when no proxy patient values found', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'patient',
                        queryParameterValue: { values: ['Patient/patient-123'] }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });

        test('returns null when parsedArgs is null', () => {
            const result = provider.getProxyPatientFromArgs({ parsedArgs: null });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });

        test('returns null when parsedArgs is undefined', () => {
            const result = provider.getProxyPatientFromArgs({ parsedArgs: undefined });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });

        test('returns null when originalParsedArgItems has empty values array', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'patient',
                        queryParameterValue: { values: [] }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });

        test('returns null when values is null', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'patient',
                        queryParameterValue: { values: null }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });

        test('takes last matching proxy patient when multiple exist', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'patient',
                        queryParameterValue: { values: ['Patient/person.first-person'] }
                    },
                    {
                        queryParameter: 'subject',
                        queryParameterValue: { values: ['Patient/person.second-person'] }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            // Last match wins (loop continues without break)
            expect(result.proxyPatientPersonId).toBe('Patient/person.second-person');
            expect(result.proxyPatientPersonIdKey).toBe('subject');
        });

        test('ignores non-string values', () => {
            const parsedArgs = {
                originalParsedArgItems: [
                    {
                        queryParameter: 'patient',
                        queryParameterValue: { values: [123, null, undefined, true] }
                    }
                ]
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });

        test('handles originalParsedArgItems as empty array', () => {
            const parsedArgs = {
                originalParsedArgItems: []
            };

            const result = provider.getProxyPatientFromArgs({ parsedArgs });

            expect(result.proxyPatientPersonId).toBeNull();
            expect(result.proxyPatientPersonIdKey).toBeNull();
        });
    });

    describe('findPersonIdFromMap', () => {
        test('returns person id when resource.id matches in map', () => {
            const patientToPersonMap = {
                'patient-direct': 'person-direct'
            };
            const resource = { id: 'patient-direct', _uuid: 'some-uuid' };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            expect(result).toBe('person-direct');
        });

        test('returns person id via _uuid fallback when id does not match', () => {
            const patientToPersonMap = {
                'uuid-123': 'person-from-uuid'
            };
            const resource = { id: 'no-match', _uuid: 'uuid-123' };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            // Current behavior: _uuid IS used as fallback lookup
            expect(result).toBe('person-from-uuid');
        });

        test('returns undefined when neither id nor _uuid matches', () => {
            const patientToPersonMap = {
                'other-patient': 'other-person'
            };
            const resource = { id: 'no-match', _uuid: 'also-no-match' };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            expect(result).toBeUndefined();
        });

        test('returns undefined when patientToPersonMap is null', () => {
            const resource = { id: 'patient-1', _uuid: 'uuid-1' };

            const result = provider.findPersonIdFromMap(null, resource);

            expect(result).toBeUndefined();
        });

        test('returns undefined when patientToPersonMap is undefined', () => {
            const resource = { id: 'patient-1', _uuid: 'uuid-1' };

            const result = provider.findPersonIdFromMap(undefined, resource);

            expect(result).toBeUndefined();
        });

        test('prefers id match over _uuid match', () => {
            const patientToPersonMap = {
                'patient-id': 'person-via-id',
                'patient-uuid': 'person-via-uuid'
            };
            const resource = { id: 'patient-id', _uuid: 'patient-uuid' };

            const result = provider.findPersonIdFromMap(patientToPersonMap, resource);

            expect(result).toBe('person-via-id');
        });

        test('handles empty patientToPersonMap', () => {
            const resource = { id: 'patient-1', _uuid: 'uuid-1' };

            const result = provider.findPersonIdFromMap({}, resource);

            expect(result).toBeUndefined();
        });
    });

    describe('updateReferenceAsync', () => {
        test('rewrites patient reference to proxy format when in patientIdsFromQueryParam', async () => {
            const reference = { reference: 'Patient/patient-1' };
            const patientIdsFromQueryParam = ['Patient/patient-1'];
            const patientToPersonMap = { 'Patient/patient-1': 'person-abc' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            expect(result.reference).toBe(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}person-abc`);
        });

        test('does not rewrite when reference is not in patientIdsFromQueryParam', async () => {
            const reference = { reference: 'Patient/patient-other' };
            const patientIdsFromQueryParam = ['Patient/patient-1'];
            const patientToPersonMap = { 'Patient/patient-1': 'person-abc' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            expect(result.reference).toBe('Patient/patient-other');
        });

        test('does not rewrite non-patient references', async () => {
            const reference = { reference: 'Practitioner/doc-1' };
            const patientIdsFromQueryParam = ['Patient/patient-1'];
            const patientToPersonMap = { 'Patient/patient-1': 'person-abc' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            expect(result.reference).toBe('Practitioner/doc-1');
        });

        test('rewrites when patientToPersonMap has entry without Patient/ prefix', async () => {
            const reference = { reference: 'Patient/patient-1' };
            const patientIdsFromQueryParam = ['Patient/patient-1'];
            // Map has entry without the Patient/ prefix
            const patientToPersonMap = { 'patient-1': 'person-xyz' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            expect(result.reference).toBe(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}person-xyz`);
        });

        test('matches on _uuid when reference._uuid is in patientIdsFromQueryParam', async () => {
            const reference = { reference: 'Patient/patient-1', _uuid: 'Patient/patient-uuid-1' };
            const patientIdsFromQueryParam = ['Patient/patient-uuid-1'];
            const patientToPersonMap = { 'Patient/patient-uuid-1': 'person-from-uuid' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            expect(result.reference).toBe(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}person-from-uuid`);
        });

        test('does not rewrite when reference matches patientIdsFromQueryParam but not in map', async () => {
            const reference = { reference: 'Patient/patient-1' };
            const patientIdsFromQueryParam = ['Patient/patient-1'];
            const patientToPersonMap = { 'Patient/different-patient': 'person-abc' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            // Not in map (neither full reference nor stripped prefix), so no rewrite
            expect(result.reference).toBe('Patient/patient-1');
        });

        test('returns the same reference object (mutates in place)', async () => {
            const reference = { reference: 'Patient/patient-1', display: 'Test Patient' };
            const patientIdsFromQueryParam = ['Patient/patient-1'];
            const patientToPersonMap = { 'Patient/patient-1': 'person-abc' };

            const result = await provider.updateReferenceAsync({
                reference,
                patientIdsFromQueryParam,
                patientToPersonMap
            });

            expect(result).toBe(reference);
            expect(result.display).toBe('Test Patient');
        });
    });

    describe('getUpdateReferenceFn', () => {
        test('returns a function', () => {
            const fn = provider.getUpdateReferenceFn(['Patient/p1'], 'Patient/person.abc');
            expect(typeof fn).toBe('function');
        });

        test('returned function rewrites matching reference to proxy patient with Patient/ prefix', () => {
            const fn = provider.getUpdateReferenceFn(['Patient/patient-1'], 'Patient/person.abc');
            const reference = { reference: 'Patient/patient-1' };

            const result = fn(reference);

            expect(result.reference).toBe('Patient/person.abc');
        });

        test('returned function rewrites matching reference adding Patient/ prefix when not present', () => {
            const fn = provider.getUpdateReferenceFn(['Patient/patient-1'], 'person.abc');
            const reference = { reference: 'Patient/patient-1' };

            const result = fn(reference);

            expect(result.reference).toBe('Patient/person.abc');
        });

        test('returned function does not rewrite non-matching reference', () => {
            const fn = provider.getUpdateReferenceFn(['Patient/patient-1'], 'Patient/person.abc');
            const reference = { reference: 'Patient/patient-2' };

            const result = fn(reference);

            expect(result.reference).toBe('Patient/patient-2');
        });

        test('returned function does not rewrite when reference.reference is undefined', () => {
            const fn = provider.getUpdateReferenceFn(['Patient/patient-1'], 'Patient/person.abc');
            const reference = { display: 'test' };

            const result = fn(reference);

            expect(result.reference).toBeUndefined();
        });

        test('returned function handles multiple proxyPatientIds', () => {
            const fn = provider.getUpdateReferenceFn(
                ['Patient/patient-1', 'Patient/patient-2'],
                'Patient/person.abc'
            );

            const ref1 = { reference: 'Patient/patient-1' };
            const ref2 = { reference: 'Patient/patient-2' };
            const ref3 = { reference: 'Patient/patient-3' };

            expect(fn(ref1).reference).toBe('Patient/person.abc');
            expect(fn(ref2).reference).toBe('Patient/person.abc');
            expect(fn(ref3).reference).toBe('Patient/patient-3');
        });
    });

    describe('enrichAsync', () => {
        test('returns resources unchanged when _rewritePatientReference is false', async () => {
            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = false;
            parsedArgs.get = jestObj.fn();
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

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = undefined;
            parsedArgs.get = jestObj.fn();
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

        test('returns resources unchanged when no proxy patient found in args', async () => {
            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn();
            parsedArgs.originalParsedArgItems = [
                {
                    queryParameter: 'patient',
                    queryParameterValue: { values: ['Patient/regular-patient'] }
                }
            ];

            const resource = {
                resourceType: 'Patient',
                id: 'patient-1',
                _uuid: 'uuid-1',
                _references: []
            };

            const result = await provider.enrichAsync({ resources: [resource], parsedArgs });

            expect(result[0].id).toBe('patient-1');
        });

        test('rewrites Patient resource id to proxy format when mapped', async () => {
            const patientToPersonMap = {
                'patient-123': 'person-456'
            };

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue({
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

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue({
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

            expect(reference.reference).toBe(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}person-abc`);
        });

        test('does not rewrite non-patient references', async () => {
            const patientToPersonMap = {
                'patient-123': 'person-456'
            };

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue({
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

            expect(reference.reference).toBe('Practitioner/doc-1');
        });

        test('does not rewrite Patient id when not in patientToPersonMap', async () => {
            const patientToPersonMap = {
                'different-patient': 'some-person'
            };

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['Patient/person.some-person']
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.some-person'] }
            }];

            const resource = {
                resourceType: 'Patient',
                id: 'unmapped-patient',
                _uuid: 'uuid-unmapped',
                _references: []
            };

            const result = await provider.enrichAsync({ resources: [resource], parsedArgs });

            // id is not in map, so it stays unchanged
            expect(result[0].id).toBe('unmapped-patient');
        });

        test('handles parsedArgs.get returning null gracefully', async () => {
            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue(null);
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-1'] }
            }];

            const resource = {
                resourceType: 'Patient',
                id: 'patient-1',
                _uuid: 'uuid-1',
                _references: []
            };

            const result = await provider.enrichAsync({ resources: [resource], parsedArgs });

            // parsedArgsItem is null, so no processing occurs
            expect(result[0].id).toBe('patient-1');
        });

        test('adds Patient/ prefix to values that do not start with it in queryParameterValue', async () => {
            const patientToPersonMap = {
                'Patient/raw-id': 'person-result'
            };

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['raw-id'] // Does not start with Patient/
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-result'] }
            }];

            const reference = { reference: 'Patient/raw-id' };
            const resource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'uuid-obs-1',
                _references: [reference]
            };

            await provider.enrichAsync({ resources: [resource], parsedArgs });

            // The value 'raw-id' gets prefixed to 'Patient/raw-id' which matches the reference
            expect(reference.reference).toBe(`${PATIENT_REFERENCE_PREFIX}${PERSON_PROXY_PREFIX}person-result`);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('enriches each entry resource and updates entry.id', async () => {
            const patientToPersonMap = {
                'patient-1': 'person-1'
            };

            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn().mockReturnValue({
                patientToPersonMap,
                queryParameterValue: {
                    values: ['Patient/person.person-1']
                }
            });
            parsedArgs.originalParsedArgItems = [{
                queryParameter: 'patient',
                queryParameterValue: { values: ['Patient/person.person-1'] }
            }];

            const entries = [
                {
                    id: 'patient-1',
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        _uuid: 'uuid-patient-1',
                        _references: []
                    }
                }
            ];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource.id).toBe(`${PERSON_PROXY_PREFIX}person-1`);
            expect(result[0].id).toBe(`${PERSON_PROXY_PREFIX}person-1`);
        });

        test('skips entries with null resource', async () => {
            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = false;
            parsedArgs.get = jestObj.fn();
            parsedArgs.originalParsedArgItems = [];

            const entries = [
                { id: 'entry-1', resource: null },
                {
                    id: 'patient-1',
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        _uuid: 'uuid-1',
                        _references: []
                    }
                }
            ];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource).toBeNull();
            expect(result[0].id).toBe('entry-1');
            expect(result[1].resource.id).toBe('patient-1');
        });

        test('returns entries unchanged when rewrite is disabled', async () => {
            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = false;
            parsedArgs.get = jestObj.fn();
            parsedArgs.originalParsedArgItems = [];

            const entries = [
                {
                    id: 'patient-1',
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        _uuid: 'uuid-1',
                        _references: []
                    }
                }
            ];

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].id).toBe('patient-1');
            expect(result[0].resource.id).toBe('patient-1');
        });

        test('handles empty entries array', async () => {
            const parsedArgs = Object.create(require('../../../../operations/query/parsedArgs').ParsedArgs.prototype);
            parsedArgs._rewritePatientReference = true;
            parsedArgs.get = jestObj.fn();
            parsedArgs.originalParsedArgItems = [];

            const entries = [];
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result).toEqual([]);
        });
    });
});
