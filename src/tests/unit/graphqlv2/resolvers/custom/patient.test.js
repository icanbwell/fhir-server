const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const patientResolvers = require('../../../../../graphqlv2/resolvers/custom/patient');

describe('graphqlv2/resolvers/custom/patient', () => {
    let mockContext;
    let mockInfo;

    beforeEach(() => {
        mockContext = {
            dataApi: {
                getResources: jest.fn().mockResolvedValue([])
            }
        };
        mockInfo = { fieldName: 'test' };
    });

    describe('Patient.accounts resolver', () => {
        test('calls dataApi.getResources with patient reference for Account', async () => {
            const parent = { id: 'p-1' };
            await patientResolvers.Patient.accounts(parent, { status: 'active' }, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { status: 'active', patient: 'Patient/p-1' },
                mockContext,
                mockInfo,
                'Account'
            );
        });

        test('uses empty args correctly', async () => {
            const parent = { id: 'p-2' };
            await patientResolvers.Patient.accounts(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-2' },
                mockContext,
                mockInfo,
                'Account'
            );
        });
    });

    describe('Patient.adverseEvents resolver', () => {
        test('calls dataApi.getResources with subject reference for AdverseEvent', async () => {
            const parent = { id: 'p-ae' };
            await patientResolvers.Patient.adverseEvents(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { subject: 'Patient/p-ae' },
                mockContext,
                mockInfo,
                'AdverseEvent'
            );
        });
    });

    describe('Patient.allergyIntolerances resolver', () => {
        test('calls dataApi.getResources with patient reference for AllergyIntolerance', async () => {
            const parent = { id: 'p-ai' };
            await patientResolvers.Patient.allergyIntolerances(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-ai' },
                mockContext,
                mockInfo,
                'AllergyIntolerance'
            );
        });
    });

    describe('Patient.appointments resolver', () => {
        test('calls dataApi.getResources with patient reference for Appointment', async () => {
            const parent = { id: 'p-appt' };
            await patientResolvers.Patient.appointments(parent, { date: '2024-01-01' }, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { date: '2024-01-01', patient: 'Patient/p-appt' },
                mockContext,
                mockInfo,
                'Appointment'
            );
        });
    });

    describe('Patient.appointmentResponses resolver', () => {
        test('calls dataApi.getResources with patient reference for AppointmentResponse', async () => {
            const parent = { id: 'p-ar' };
            await patientResolvers.Patient.appointmentResponses(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-ar' },
                mockContext,
                mockInfo,
                'AppointmentResponse'
            );
        });
    });

    describe('Patient.tasks resolver', () => {
        test('calls dataApi.getResources with patient reference for Task', async () => {
            const parent = { id: 'p-task' };
            await patientResolvers.Patient.tasks(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-task' },
                mockContext,
                mockInfo,
                'Task'
            );
        });
    });

    describe('Patient.visionPrescriptions resolver', () => {
        test('calls dataApi.getResources with patient reference for VisionPrescription', async () => {
            const parent = { id: 'p-vp' };
            await patientResolvers.Patient.visionPrescriptions(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-vp' },
                mockContext,
                mockInfo,
                'VisionPrescription'
            );
        });
    });

    describe('Patient.supplyRequests resolver', () => {
        test('calls dataApi.getResources with requester reference for SupplyRequest', async () => {
            const parent = { id: 'p-sr' };
            await patientResolvers.Patient.supplyRequests(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { requester: 'Patient/p-sr' },
                mockContext,
                mockInfo,
                'SupplyRequest'
            );
        });
    });

    describe('Patient.supplyDeliveries resolver', () => {
        test('calls dataApi.getResources with patient reference for SupplyDelivery', async () => {
            const parent = { id: 'p-sd' };
            await patientResolvers.Patient.supplyDeliveries(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/p-sd' },
                mockContext,
                mockInfo,
                'SupplyDelivery'
            );
        });
    });

    describe('Patient.subscriptionTopics resolver', () => {
        test('calls dataApi.getResources with identifier for SubscriptionTopic', async () => {
            const parent = { id: 'p-st' };
            await patientResolvers.Patient.subscriptionTopics(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { identifier: 'https://icanbwell.com/codes/source_patient_id|p-st' },
                mockContext,
                mockInfo,
                'SubscriptionTopic'
            );
        });
    });

    describe('args spreading preserves existing args', () => {
        test('existing args are not overwritten by patient reference', async () => {
            const parent = { id: 'p-spread' };
            const args = { _count: 10, _sort: 'date' };
            await patientResolvers.Patient.accounts(parent, args, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { _count: 10, _sort: 'date', patient: 'Patient/p-spread' },
                mockContext,
                mockInfo,
                'Account'
            );
        });
    });

    describe('boundary: varying parent.id values', () => {
        test('handles parent with special characters in id', async () => {
            const parent = { id: 'uuid-123-abc.def' };
            await patientResolvers.Patient.tasks(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/uuid-123-abc.def' },
                mockContext,
                mockInfo,
                'Task'
            );
        });

        test('handles parent with empty string id', async () => {
            const parent = { id: '' };
            await patientResolvers.Patient.accounts(parent, {}, mockContext, mockInfo);
            expect(mockContext.dataApi.getResources).toHaveBeenCalledWith(
                parent,
                { patient: 'Patient/' },
                mockContext,
                mockInfo,
                'Account'
            );
        });
    });
});
