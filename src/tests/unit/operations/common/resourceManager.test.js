'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');
const { ResourceManager } = require('../../../../operations/common/resourceManager');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');
const { FhirResponseUrlBuilder } = require('../../../../utils/url/fhirResponseUrlBuilder');
const { FhirBasePath } = require('../../../../utils/url/fhirBasePath');

function createPrototypedMock(RealClass) {
    const mock = Object.create(RealClass.prototype);
    return mock;
}

function createResourceManager(searchParamsMap = new Map()) {
    const searchParametersManager = createPrototypedMock(SearchParametersManager);
    searchParametersManager.getAllSearchParameters = jestObj.fn().mockReturnValue(
        Array.from(searchParamsMap.entries())
    );

    const mgr = new ResourceManager({ searchParametersManager });
    mgr._mockSearchParametersManager = searchParametersManager;
    return mgr;
}

describe('ResourceManager', () => {
    describe('constructor', () => {
        test('throws if searchParametersManager is not the correct type', () => {
            expect(() => new ResourceManager({ searchParametersManager: {} })).toThrow();
        });

        test('creates instance with valid searchParametersManager', () => {
            const searchParametersManager = createPrototypedMock(SearchParametersManager);
            searchParametersManager.getAllSearchParameters = jestObj.fn().mockReturnValue([]);
            const mgr = new ResourceManager({ searchParametersManager });
            expect(mgr).toBeInstanceOf(ResourceManager);
        });
    });

    describe('getPatientFieldNameFromResource', () => {
        test('returns "id" for Patient resourceType', () => {
            const mgr = createResourceManager();
            const result = mgr.getPatientFieldNameFromResource('Patient');
            expect(result).toBe('id');
        });

        test('returns the firstField for resources with a patient search parameter', () => {
            const searchParams = new Map([
                ['Observation', {
                    patient: { firstField: 'subject' },
                    code: { firstField: 'code' }
                }]
            ]);
            const mgr = createResourceManager(searchParams);

            const result = mgr.getPatientFieldNameFromResource('Observation');
            expect(result).toBe('subject');
        });

        test('returns null for resources without a patient search parameter', () => {
            const searchParams = new Map([
                ['Medication', {
                    code: { firstField: 'code' },
                    status: { firstField: 'status' }
                }]
            ]);
            const mgr = createResourceManager(searchParams);

            const result = mgr.getPatientFieldNameFromResource('Medication');
            expect(result).toBeNull();
        });

        test('returns null for unknown resource types', () => {
            const searchParams = new Map([
                ['Observation', {
                    patient: { firstField: 'subject' }
                }]
            ]);
            const mgr = createResourceManager(searchParams);

            const result = mgr.getPatientFieldNameFromResource('UnknownType');
            expect(result).toBeNull();
        });
    });

    describe('getPatientIdFromResourceAsync', () => {
        test('returns patient id for Patient resource', async () => {
            const mgr = createResourceManager();
            const resource = { id: 'patient-123' };

            const result = await mgr.getPatientIdFromResourceAsync('Patient', resource);
            expect(result).toBe('patient-123');
        });

        test('returns null when no patient field name is found', async () => {
            const searchParams = new Map([
                ['Medication', { code: { firstField: 'code' } }]
            ]);
            const mgr = createResourceManager(searchParams);
            const resource = { id: 'med-1', code: 'abc' };

            const result = await mgr.getPatientIdFromResourceAsync('Medication', resource);
            expect(result).toBeNull();
        });

        test('extracts patient id from a reference object', async () => {
            const searchParams = new Map([
                ['Observation', { patient: { firstField: 'subject' } }]
            ]);
            const mgr = createResourceManager(searchParams);
            const resource = {
                subject: { reference: 'Patient/p-456' }
            };

            const result = await mgr.getPatientIdFromResourceAsync('Observation', resource);
            expect(result).toBe('p-456');
        });

        test('returns raw value if patient field is a string (not a reference object)', async () => {
            const searchParams = new Map([
                ['Claim', { patient: { firstField: 'patient' } }]
            ]);
            const mgr = createResourceManager(searchParams);
            const resource = {
                patient: 'patient-789'
            };

            const result = await mgr.getPatientIdFromResourceAsync('Claim', resource);
            expect(result).toBe('patient-789');
        });

        test('returns null when patient field is null/undefined on resource', async () => {
            const searchParams = new Map([
                ['Observation', { patient: { firstField: 'subject' } }]
            ]);
            const mgr = createResourceManager(searchParams);
            const resource = { id: 'obs-1' }; // no subject field

            const result = await mgr.getPatientIdFromResourceAsync('Observation', resource);
            expect(result).toBeNull();
        });
    });

    describe('getFullUrlForResource', () => {
        test('delegates to responseUrls.build with "resourceType/id" (collaborator contract)', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Patient', id: 'p1' };
            const build = jestObj.fn().mockReturnValue('fake-built-url');
            const responseUrls = { build };

            const result = mgr.getFullUrlForResource({ resource, responseUrls });

            expect(build).toHaveBeenCalledTimes(1);
            expect(build).toHaveBeenCalledWith('Patient/p1');
            expect(result).toBe('fake-built-url');
        });

        test('generates full URL with protocol and host (real builder, canonical)', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Patient', id: 'p1' };
            const responseUrls = new FhirResponseUrlBuilder({ protocol: 'https', host: 'example.com' });

            const result = mgr.getFullUrlForResource({ resource, responseUrls });

            expect(result).toBe('https://example.com/4_0_0/Patient/p1');
        });

        test('uses externalUrlPrefix when set on the builder (real builder)', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Observation', id: 'obs-1' };
            const responseUrls = new FhirResponseUrlBuilder({
                protocol: 'https',
                host: 'example.com',
                externalUrlPrefix: 'https://proxy.example.com/fhir'
            });

            const result = mgr.getFullUrlForResource({ resource, responseUrls });

            expect(result).toBe('https://proxy.example.com/fhir/Observation/obs-1');
        });

        test('mirrors the alias base path when set on the builder (real builder)', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Patient', id: 'p2' };
            const responseUrls = new FhirResponseUrlBuilder({
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' })
            });

            const result = mgr.getFullUrlForResource({ resource, responseUrls });

            expect(result).toBe('https://fhir.icanbwell.com/fhir/r4/Patient/p2');
        });
    });
});
