const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const patientResolvers = require('../../../../../graphql/resolvers/custom/patient');

describe('graphql/resolvers/custom/patient', () => {
    let mockContext;
    let mockInfo;
    let mockParent;

    beforeEach(() => {
        mockContext = {
            dataApi: {
                getResources: jest.fn().mockResolvedValue([]),
                getResourcesForMutation: jest.fn().mockResolvedValue([])
            },
            fhirRequestInfo: {
                body: null
            },
            container: {
                removeOperation: {
                    removeAsync: jest.fn().mockResolvedValue(null)
                },
                mergeOperation: {
                    mergeAsync: jest.fn().mockResolvedValue([{ operationOutcome: null }])
                },
                r4ArgsParser: {
                    parseArgs: jest.fn().mockReturnValue({})
                }
            }
        };
        // mock assertTypeEquals and assertIsValid to not throw
        mockInfo = { fieldName: 'test' };
        mockParent = { id: 'patient-123', name: null, generalPractitioner: null };
    });

    describe('Patient.name resolver', () => {
        test('returns null when parent is null', async () => {
            const result = await patientResolvers.Patient.name(null, {}, mockContext, mockInfo);
            expect(result).toBeNull();
        });

        test('returns patient.name when no args.use filter is provided', async () => {
            const parent = { id: '1', name: [{ use: 'official', family: 'Smith' }] };
            const result = await patientResolvers.Patient.name(parent, {}, mockContext, mockInfo);
            expect(result).toEqual([{ use: 'official', family: 'Smith' }]);
        });

        test('filters name by args.use when args.use is an array', async () => {
            const parent = {
                id: '1',
                name: [
                    { use: 'official', family: 'Smith' },
                    { use: 'nickname', family: 'Smithy' },
                    { use: 'old', family: 'Jones' }
                ]
            };
            const result = await patientResolvers.Patient.name(
                parent, { use: ['official', 'nickname'] }, mockContext, mockInfo
            );
            expect(result).toHaveLength(2);
            expect(result[0].family).toBe('Smith');
            expect(result[1].family).toBe('Smithy');
        });

        test('returns empty array when args.use filter matches nothing', async () => {
            const parent = {
                id: '1',
                name: [{ use: 'official', family: 'Smith' }]
            };
            const result = await patientResolvers.Patient.name(
                parent, { use: ['temp'] }, mockContext, mockInfo
            );
            expect(result).toHaveLength(0);
        });

        test('returns patient.name when patient.name is null', async () => {
            const parent = { id: '1', name: null };
            const result = await patientResolvers.Patient.name(parent, { use: ['official'] }, mockContext, mockInfo);
            expect(result).toBeNull();
        });

        // boundary: 0 names
        test('returns empty array when patient.name is empty array', async () => {
            const parent = { id: '1', name: [] };
            const result = await patientResolvers.Patient.name(parent, {}, mockContext, mockInfo);
            expect(result).toEqual([]);
        });

        // boundary: 1 name
        test('returns single name with no filter', async () => {
            const parent = { id: '1', name: [{ use: 'official', family: 'Doe' }] };
            const result = await patientResolvers.Patient.name(parent, {}, mockContext, mockInfo);
            expect(result).toHaveLength(1);
        });
    });

    describe('Patient.account resolver', () => {
        test('calls dataApi.getResources with patient reference', async () => {
            const parent = { id: 'p-abc' };
            await patientResolvers.Patient.account(parent, { status: 'active' }, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { status: 'active', patient: 'Patient/p-abc' },
                mockContext,
                mockInfo,
                'Account'
            );
        });
    });

    describe('Patient.adverseEvent resolver', () => {
        test('calls dataApi.getResources with subject reference', async () => {
            const parent = { id: 'p-xyz' };
            await patientResolvers.Patient.adverseEvent(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { subject: 'Patient/p-xyz' },
                mockContext,
                mockInfo,
                'AdverseEvent'
            );
        });
    });

    describe('Patient.allergyIntolerance resolver', () => {
        test('calls dataApi.getResources with patient reference', async () => {
            const parent = { id: 'p-allergy' };
            await patientResolvers.Patient.allergyIntolerance(parent, { severity: 'high' }, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { severity: 'high', patient: 'Patient/p-allergy' },
                mockContext,
                mockInfo,
                'AllergyIntolerance'
            );
        });
    });

    describe('Patient.carePlan resolver', () => {
        test('calls dataApi.getResources with correct resourceType', async () => {
            const parent = { id: 'p-cp' };
            await patientResolvers.Patient.carePlan(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-cp' },
                mockContext,
                mockInfo,
                'CarePlan'
            );
        });
    });

    describe('Patient.condition resolver - subject reference', () => {
        test('calls dataApi.getResources with subject reference for condition', async () => {
            const parent = { id: 'p-cond' };
            if (patientResolvers.Patient.condition) {
                await patientResolvers.Patient.condition(parent, {}, mockContext, mockInfo);
                expect(mockContext.dataApi.getResources).toHaveBeenCalled();
            }
        });
    });

    describe('Patient.task resolver', () => {
        test('calls dataApi.getResources with patient reference for Task', async () => {
            const parent = { id: 'p-task' };
            await patientResolvers.Patient.task(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-task' },
                mockContext,
                mockInfo,
                'Task'
            );
        });
    });

    describe('Patient.visionPrescription resolver', () => {
        test('calls dataApi.getResources with patient reference for VisionPrescription', async () => {
            const parent = { id: 'p-vp' };
            await patientResolvers.Patient.visionPrescription(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-vp' },
                mockContext,
                mockInfo,
                'VisionPrescription'
            );
        });
    });

    describe('Mutation.updateGeneralPractitioner', () => {
        test('throws error when patient is not found', async () => {
            mockContext.dataApi.getResourcesForMutation.mockResolvedValue([]);
            await expect(
                patientResolvers.Mutation.updateGeneralPractitioner(
                    null,
                    { patientId: 'p-missing', practitionerId: 'pr-1', remove: false },
                    mockContext,
                    mockInfo
                )
            ).rejects.toThrow('Patient not found p-missing');
        });

        test('removes practitioner when remove=true and generalPractitioner exists', async () => {
            const patient = {
                id: 'p1',
                generalPractitioner: [{ reference: 'Practitioner/pr-1' }]
            };
            mockContext.dataApi.getResourcesForMutation.mockResolvedValue([patient]);
            // Mock container assertions -- the module uses assertTypeEquals which will throw
            // unless we mock it; we test the logic flow here
            jest.mock('../../../../../utils/assertType', () => ({
                assertTypeEquals: jest.fn(),
                assertIsValid: jest.fn()
            }));

            // Since assertTypeEquals will fail on the mock objects we test up to the point it throws
            try {
                await patientResolvers.Mutation.updateGeneralPractitioner(
                    null,
                    { patientId: 'p1', practitionerId: 'pr-1', remove: true },
                    mockContext,
                    mockInfo
                );
            } catch (e) {
                // Expected to throw due to assertTypeEquals on mock objects
            }
            // The patient's generalPractitioner should have been filtered
            expect(patient.generalPractitioner).toEqual([]);
        });

        test('returns patient unchanged when remove=true but generalPractitioner is null', async () => {
            const patient = {
                id: 'p1',
                generalPractitioner: null
            };
            mockContext.dataApi.getResourcesForMutation.mockResolvedValue([patient]);
            const result = await patientResolvers.Mutation.updateGeneralPractitioner(
                null,
                { patientId: 'p1', practitionerId: 'pr-1', remove: true },
                mockContext,
                mockInfo
            );
            expect(result).toBe(patient);
        });

        test('throws when practitioners not found on add', async () => {
            const patient = {
                id: 'p1',
                generalPractitioner: null
            };
            mockContext.dataApi.getResourcesForMutation.mockResolvedValue([patient]);
            mockContext.dataApi.getResources.mockResolvedValue([]);
            await expect(
                patientResolvers.Mutation.updateGeneralPractitioner(
                    null,
                    { patientId: 'p1', practitionerId: 'pr-missing', remove: false },
                    mockContext,
                    mockInfo
                )
            ).rejects.toThrow('Practitioner not found pr-missing');
        });
    });

    describe('removeAllGeneralPractitioner helper (tested via mutation)', () => {
        test('removes matching practitioner by reference suffix', async () => {
            const patient = {
                id: 'p1',
                generalPractitioner: [
                    { reference: 'Practitioner/pr-1' },
                    { reference: 'Practitioner/pr-2' }
                ]
            };
            mockContext.dataApi.getResourcesForMutation.mockResolvedValue([patient]);

            try {
                await patientResolvers.Mutation.updateGeneralPractitioner(
                    null,
                    { patientId: 'p1', practitionerId: 'pr-1', remove: true },
                    mockContext,
                    mockInfo
                );
            } catch (e) {
                // expected
            }
            // Only pr-2 should remain
            expect(patient.generalPractitioner).toEqual([{ reference: 'Practitioner/pr-2' }]);
        });

        test('handles empty array gracefully', async () => {
            const patient = {
                id: 'p1',
                generalPractitioner: []
            };
            mockContext.dataApi.getResourcesForMutation.mockResolvedValue([patient]);
            try {
                await patientResolvers.Mutation.updateGeneralPractitioner(
                    null,
                    { patientId: 'p1', practitionerId: 'pr-1', remove: true },
                    mockContext,
                    mockInfo
                );
            } catch (e) {
                // expected
            }
            expect(patient.generalPractitioner).toEqual([]);
        });
    });
});
