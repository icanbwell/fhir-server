const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { ParametersResourceValidator } = require('../../../../../operations/merge/validators/parameterResourceValidator');

describe('ParametersResourceValidator', () => {
    let validator;

    beforeEach(() => {
        validator = new ParametersResourceValidator();
    });

    describe('when input is a Parameters resource', () => {
        test('returns error when parameter array is empty', async () => {
            const incomingResources = {
                resourceType: 'Parameters',
                parameter: []
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.wasAList).toBe(true);
        });

        test('returns error when parameter is undefined', async () => {
            const incomingResources = {
                resourceType: 'Parameters',
                parameter: undefined
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.wasAList).toBe(true);
        });

        test('returns error when no parameter entries have a resource property', async () => {
            const incomingResources = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'param1', valueString: 'test' },
                    { name: 'param2', valueBoolean: true }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.wasAList).toBe(true);
        });

        test('extracts resources from parameters with resource property', async () => {
            const patient = { resourceType: 'Patient', id: 'patient-1' };
            const observation = { resourceType: 'Observation', id: 'obs-1' };
            const incomingResources = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: patient },
                    { name: 'resource', resource: observation }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([patient, observation]);
            expect(result.preCheckErrors).toEqual([]);
            expect(result.wasAList).toBe(true);
        });

        test('only extracts parameters that have a resource property', async () => {
            const patient = { resourceType: 'Patient', id: 'patient-1' };
            const incomingResources = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource: patient },
                    { name: 'other', valueString: 'not-a-resource' }
                ]
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([patient]);
            expect(result.preCheckErrors).toEqual([]);
        });
    });

    describe('when input is an array of resources', () => {
        test('returns the array directly with wasAList true', async () => {
            const resources = [
                { resourceType: 'Patient', id: 'p1' },
                { resourceType: 'Observation', id: 'o1' }
            ];

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual(resources);
            expect(result.preCheckErrors).toEqual([]);
            expect(result.wasAList).toBe(true);
        });

        test('filters out nested Parameters resources and adds errors', async () => {
            const patient = { resourceType: 'Patient', id: 'p1' };
            const nestedParameters = { resourceType: 'Parameters', id: 'params-1' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: [patient, nestedParameters],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([patient]);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.preCheckErrors[0].resourceType).toBe('Parameters');
            expect(result.preCheckErrors[0].id).toBe('params-1');
            expect(result.preCheckErrors[0].created).toBe(false);
            expect(result.preCheckErrors[0].updated).toBe(false);
        });

        test('filters out null/undefined entries in the array', async () => {
            const patient = { resourceType: 'Patient', id: 'p1' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: [patient, null, undefined],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([patient]);
            expect(result.preCheckErrors).toEqual([]);
        });

        test('reports errors for each nested Parameters resource', async () => {
            const params1 = { resourceType: 'Parameters', id: 'params-1' };
            const params2 = { resourceType: 'Parameters', id: 'params-2' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: [params1, params2],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toHaveLength(2);
            expect(result.preCheckErrors[0].id).toBe('params-1');
            expect(result.preCheckErrors[1].id).toBe('params-2');
        });
    });

    describe('when input is a single non-Parameters resource', () => {
        test('returns it directly with wasAList false', async () => {
            const resource = { resourceType: 'Patient', id: 'p1' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: resource,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual(resource);
            expect(result.preCheckErrors).toEqual([]);
            expect(result.wasAList).toBe(false);
        });
    });

    describe('error structure validation', () => {
        test('error for empty parameters has correct OperationOutcome structure', async () => {
            const incomingResources = {
                resourceType: 'Parameters',
                parameter: []
            };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            const errorOutcome = result.preCheckErrors[0];
            // The error is wrapped in an array
            expect(Array.isArray(errorOutcome)).toBe(true);
            expect(errorOutcome[0].id).toBe('validationfail');
            expect(errorOutcome[0].issue[0].severity).toBe('error');
            expect(errorOutcome[0].issue[0].code).toBe('structure');
            expect(errorOutcome[0].issue[0].details.text).toBe('Invalid parameter list');
        });

        test('error for nested Parameters has MergeResultEntry with operationOutcome', async () => {
            const nestedParameters = { resourceType: 'Parameters', id: 'params-1' };

            const result = await validator.validate({
                requestInfo: {},
                incomingResources: [nestedParameters],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            const error = result.preCheckErrors[0];
            expect(error.operationOutcome).toBeDefined();
            expect(error.operationOutcome.issue[0].details.text).toBe('Invalid resource type: Parameters');
            expect(error.issue).toBeDefined();
            expect(error.issue.severity).toBe('error');
            expect(error.issue.code).toBe('structure');
        });
    });
});
