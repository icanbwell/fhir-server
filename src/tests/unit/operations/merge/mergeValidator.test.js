const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

const mockSerialize = jestObj.fn();
jestObj.mock('../../../../fhir/fhirResourceWriteSerializer', () => ({
    FhirResourceWriteSerializer: {
        serialize: mockSerialize
    }
}));

const { MergeValidator } = require('../../../../operations/merge/mergeValidator');

describe('MergeValidator', () => {
    let mergeValidator;
    let mockValidator1;
    let mockValidator2;
    let mockConfigManager;
    let mockCustomTracer;

    beforeEach(() => {
        mockSerialize.mockReset();
        mockSerialize.mockImplementation(({ obj }) => ({ ...obj, serialized: true }));

        mockValidator1 = {
            constructor: { name: 'Validator1' },
            validate: jestObj.fn()
        };

        mockValidator2 = {
            constructor: { name: 'Validator2' },
            validate: jestObj.fn()
        };

        mockConfigManager = {};

        mockCustomTracer = {
            trace: jestObj.fn().mockImplementation(({ func }) => func())
        };

        mergeValidator = new MergeValidator({
            validators: [mockValidator1, mockValidator2],
            configManager: mockConfigManager,
            customTracer: mockCustomTracer
        });
    });

    describe('constructor', () => {
        test('stores validators array', () => {
            expect(mergeValidator.validators).toEqual([mockValidator1, mockValidator2]);
        });

        test('stores configManager', () => {
            expect(mergeValidator.configManager).toBe(mockConfigManager);
        });

        test('stores customTracer', () => {
            expect(mergeValidator.customTracer).toBe(mockCustomTracer);
        });
    });

    describe('validateAsync', () => {
        const defaultParams = {
            base_version: '4_0_0',
            incomingObjects: [{ resourceType: 'Patient', id: '1' }],
            resourceType: 'Patient',
            requestInfo: { method: 'POST' },
            effectiveSmartMerge: false
        };

        test('calls each validator in order with correct params', async () => {
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1', validated1: true }],
                preCheckErrors: [],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1', validated1: true, validated2: true }],
                preCheckErrors: [],
                wasAList: false
            });

            await mergeValidator.validateAsync(defaultParams);

            expect(mockValidator1.validate).toHaveBeenCalledWith({
                base_version: '4_0_0',
                incomingResources: [{ resourceType: 'Patient', id: '1' }],
                resourceType: 'Patient',
                requestInfo: { method: 'POST' },
                effectiveSmartMerge: false
            });

            // Second validator receives output from first
            expect(mockValidator2.validate).toHaveBeenCalledWith({
                base_version: '4_0_0',
                incomingResources: [{ resourceType: 'Patient', id: '1', validated1: true }],
                resourceType: 'Patient',
                requestInfo: { method: 'POST' },
                effectiveSmartMerge: false
            });
        });

        test('accumulates preCheckErrors from all validators', async () => {
            const error1 = { id: '1', issue: 'Error from validator 1' };
            const error2 = { id: '2', issue: 'Error from validator 2' };

            mockValidator1.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1' }],
                preCheckErrors: [error1],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1' }],
                preCheckErrors: [error2],
                wasAList: false
            });

            const result = await mergeValidator.validateAsync(defaultParams);

            expect(result.mergePreCheckErrors).toEqual([error1, error2]);
        });

        test('sets wasIncomingAList to true if any validator returns wasAList=true', async () => {
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1' }],
                preCheckErrors: [],
                wasAList: true
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1' }],
                preCheckErrors: [],
                wasAList: false
            });

            const result = await mergeValidator.validateAsync(defaultParams);

            expect(result.wasIncomingAList).toBe(true);
        });

        test('sets wasIncomingAList to false if no validator returns wasAList=true', async () => {
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1' }],
                preCheckErrors: [],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: [{ resourceType: 'Patient', id: '1' }],
                preCheckErrors: [],
                wasAList: false
            });

            const result = await mergeValidator.validateAsync(defaultParams);

            expect(result.wasIncomingAList).toBe(false);
        });

        test('serializes array of resources using FhirResourceWriteSerializer', async () => {
            const validatedResources = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: validatedResources,
                preCheckErrors: [],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: validatedResources,
                preCheckErrors: [],
                wasAList: false
            });

            const result = await mergeValidator.validateAsync(defaultParams);

            expect(mockSerialize).toHaveBeenCalledTimes(2);
            expect(mockSerialize).toHaveBeenCalledWith({ obj: validatedResources[0] });
            expect(mockSerialize).toHaveBeenCalledWith({ obj: validatedResources[1] });
            expect(result.resourcesIncomingArray).toHaveLength(2);
        });

        test('serializes single non-array resource', async () => {
            const singleResource = { resourceType: 'Patient', id: '1' };
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: singleResource,
                preCheckErrors: [],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: singleResource,
                preCheckErrors: [],
                wasAList: false
            });

            const params = { ...defaultParams, incomingObjects: singleResource };

            const result = await mergeValidator.validateAsync(params);

            expect(mockSerialize).toHaveBeenCalledWith({ obj: singleResource });
            expect(result.resourcesIncomingArray).toEqual({ ...singleResource, serialized: true });
        });

        test('uses customTracer.trace to wrap validator calls', async () => {
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: [],
                preCheckErrors: [],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: [],
                preCheckErrors: [],
                wasAList: false
            });

            await mergeValidator.validateAsync(defaultParams);

            expect(mockCustomTracer.trace).toHaveBeenCalledTimes(2);
            expect(mockCustomTracer.trace).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'MergeValidator.validate.Validator1'
                })
            );
            expect(mockCustomTracer.trace).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'MergeValidator.validate.Validator2'
                })
            );
        });

        test('works with empty validators array', async () => {
            mergeValidator = new MergeValidator({
                validators: [],
                configManager: mockConfigManager,
                customTracer: mockCustomTracer
            });

            const params = {
                ...defaultParams,
                incomingObjects: [{ resourceType: 'Patient', id: '1' }]
            };

            const result = await mergeValidator.validateAsync(params);

            expect(result.mergePreCheckErrors).toEqual([]);
            expect(result.wasIncomingAList).toBe(false);
            // Serialization still happens
            expect(mockSerialize).toHaveBeenCalledTimes(1);
        });

        test('passes effectiveSmartMerge to validators', async () => {
            mockValidator1.validate.mockResolvedValue({
                validatedObjects: [{ id: '1' }],
                preCheckErrors: [],
                wasAList: false
            });
            mockValidator2.validate.mockResolvedValue({
                validatedObjects: [{ id: '1' }],
                preCheckErrors: [],
                wasAList: false
            });

            const params = { ...defaultParams, effectiveSmartMerge: true };
            await mergeValidator.validateAsync(params);

            expect(mockValidator1.validate).toHaveBeenCalledWith(
                expect.objectContaining({ effectiveSmartMerge: true })
            );
        });
    });
});
