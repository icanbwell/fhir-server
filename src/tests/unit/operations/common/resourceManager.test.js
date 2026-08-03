'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');
const { ResourceManager } = require('../../../../operations/common/resourceManager');
const { SearchParametersManager } = require('../../../../searchParameters/searchParametersManager');

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
        test('generates full URL with protocol and host', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Patient', id: 'p1' };

            const result = mgr.getFullUrlForResource({
                protocol: 'https',
                host: 'example.com',
                base_version: '4_0_0',
                resource
            });

            expect(result).toBe('https://example.com/4_0_0/Patient/p1');
        });

        test('uses externalReqUrlPrefix when provided', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Observation', id: 'obs-1' };

            const result = mgr.getFullUrlForResource({
                protocol: 'https',
                host: 'example.com',
                base_version: '4_0_0',
                resource,
                externalReqUrlPrefix: 'https://proxy.example.com/fhir'
            });

            expect(result).toBe('https://proxy.example.com/fhir/Observation/obs-1');
        });

        test('prioritizes externalReqUrlPrefix over protocol/host', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Patient', id: 'p2' };

            const result = mgr.getFullUrlForResource({
                protocol: 'http',
                host: 'internal.server',
                base_version: '4_0_0',
                resource,
                externalReqUrlPrefix: 'https://external.com/api'
            });

            // Should use externalReqUrlPrefix, not protocol://host/base_version
            expect(result).toBe('https://external.com/api/Patient/p2');
            expect(result).not.toContain('internal.server');
        });

        test('handles undefined externalReqUrlPrefix', () => {
            const mgr = createResourceManager();
            const resource = { resourceType: 'Condition', id: 'c1' };

            const result = mgr.getFullUrlForResource({
                protocol: 'http',
                host: 'localhost:3000',
                base_version: '4_0_0',
                resource,
                externalReqUrlPrefix: undefined
            });

            expect(result).toBe('http://localhost:3000/4_0_0/Condition/c1');
        });
    });
});
