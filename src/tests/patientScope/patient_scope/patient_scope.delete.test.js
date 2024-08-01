// const AccountResource1 = require('./fixtures/Account/Account1.json');
const AdverseEventResource1 = require('./fixtures/AdverseEvent/AdverseEvent1.json');
const AllergyIntoleranceResource1 = require('./fixtures/AllergyIntolerance/AllergyIntolerance1.json');
// const AppointmentResource1 = require('./fixtures/Appointment/Appointment1.json');
const AppointmentResponseResource1 = require('./fixtures/AppointmentResponse/AppointmentResponse1.json');
const BasicResource1 = require('./fixtures/Basic/Basic1.json');
const BodyStructureResource1 = require('./fixtures/BodyStructure/BodyStructure1.json');
const CarePlanResource1 = require('./fixtures/CarePlan/CarePlan1.json');
const CareTeamResource1 = require('./fixtures/CareTeam/CareTeam1.json');
const ChargeItemResource1 = require('./fixtures/ChargeItem/ChargeItem1.json');
const ClaimResource1 = require('./fixtures/Claim/Claim1.json');
const ClaimResponseResource1 = require('./fixtures/ClaimResponse/ClaimResponse1.json');
const ClinicalImpressionResource1 = require('./fixtures/ClinicalImpression/ClinicalImpression1.json');
const CommunicationResource1 = require('./fixtures/Communication/Communication1.json');
const CommunicationRequestResource1 = require('./fixtures/CommunicationRequest/CommunicationRequest1.json');
const CompositionResource1 = require('./fixtures/Composition/Composition1.json');
const ConditionResource1 = require('./fixtures/Condition/Condition1.json');
const ConsentResource1 = require('./fixtures/Consent/Consent1.json');
// const ContractResource1 = require('./fixtures/Contract/Contract1.json');
const CoverageResource1 = require('./fixtures/Coverage/Coverage1.json');
const CoverageEligibilityRequestResource1 = require('./fixtures/CoverageEligibilityRequest/CoverageEligibilityRequest1.json');
const CoverageEligibilityResponseResource1 = require('./fixtures/CoverageEligibilityResponse/CoverageEligibilityResponse1.json');
const DetectedIssueResource1 = require('./fixtures/DetectedIssue/DetectedIssue1.json');
const DeviceResource1 = require('./fixtures/Device/Device1.json');
const DeviceRequestResource1 = require('./fixtures/DeviceRequest/DeviceRequest1.json');
const DeviceUseStatementResource1 = require('./fixtures/DeviceUseStatement/DeviceUseStatement1.json');
const DiagnosticReportResource1 = require('./fixtures/DiagnosticReport/DiagnosticReport1.json');
const DocumentManifestResource1 = require('./fixtures/DocumentManifest/DocumentManifest1.json');
const DocumentReferenceResource1 = require('./fixtures/DocumentReference/DocumentReference1.json');
const EncounterResource1 = require('./fixtures/Encounter/Encounter1.json');
const EnrollmentRequestResource1 = require('./fixtures/EnrollmentRequest/EnrollmentRequest1.json');
const EpisodeOfCareResource1 = require('./fixtures/EpisodeOfCare/EpisodeOfCare1.json');
const ExplanationOfBenefitResource1 = require('./fixtures/ExplanationOfBenefit/ExplanationOfBenefit1.json');
const FamilyMemberHistoryResource1 = require('./fixtures/FamilyMemberHistory/FamilyMemberHistory1.json');
const FlagResource1 = require('./fixtures/Flag/Flag1.json');
const GoalResource1 = require('./fixtures/Goal/Goal1.json');
// const GroupResource1 = require('./fixtures/Group/Group1.json');
const GuidanceResponseResource1 = require('./fixtures/GuidanceResponse/GuidanceResponse1.json');
const ImagingStudyResource1 = require('./fixtures/ImagingStudy/ImagingStudy1.json');
const ImmunizationResource1 = require('./fixtures/Immunization/Immunization1.json');
const ImmunizationEvaluationResource1 = require('./fixtures/ImmunizationEvaluation/ImmunizationEvaluation1.json');
const ImmunizationRecommendationResource1 = require('./fixtures/ImmunizationRecommendation/ImmunizationRecommendation1.json');
const InvoiceResource1 = require('./fixtures/Invoice/Invoice1.json');
const ListResource1 = require('./fixtures/List/List1.json');
const MeasureReportResource1 = require('./fixtures/MeasureReport/MeasureReport1.json');
const MediaResource1 = require('./fixtures/Media/Media1.json');
const MedicationAdministrationResource1 = require('./fixtures/MedicationAdministration/MedicationAdministration1.json');
const MedicationDispenseResource1 = require('./fixtures/MedicationDispense/MedicationDispense1.json');
const MedicationRequestResource1 = require('./fixtures/MedicationRequest/MedicationRequest1.json');
const MedicationStatementResource1 = require('./fixtures/MedicationStatement/MedicationStatement1.json');
const MolecularSequenceResource1 = require('./fixtures/MolecularSequence/MolecularSequence1.json');
const ObservationResource1 = require('./fixtures/Observation/Observation1.json');
const PatientResource1 = require('./fixtures/Patient/Patient1.json');
const BwellPersonResource = require('./fixtures/Person/bwellPerson.json');
const PersonResource1 = require('./fixtures/Person/Person1.json');
const PersonResource2 = require('./fixtures/Person/Person2.json');
const ProcedureResource1 = require('./fixtures/Procedure/Procedure1.json');
// const ProvenanceResource1 = require('./fixtures/Provenance/Provenance1.json');
const QuestionnaireResponseResource1 = require('./fixtures/QuestionnaireResponse/QuestionnaireResponse1.json');
const RelatedPersonResource1 = require('./fixtures/RelatedPerson/RelatedPerson1.json');
const RequestGroupResource1 = require('./fixtures/RequestGroup/RequestGroup1.json');
const ResearchSubjectResource1 = require('./fixtures/ResearchSubject/ResearchSubject1.json');
const RiskAssessmentResource1 = require('./fixtures/RiskAssessment/RiskAssessment1.json');
// const ScheduleResource1 = require('./fixtures/Schedule/Schedule1.json');
const ServiceRequestResource1 = require('./fixtures/ServiceRequest/ServiceRequest1.json');
const SpecimenResource1 = require('./fixtures/Specimen/Specimen1.json');
const SupplyDeliveryResource1 = require('./fixtures/SupplyDelivery/SupplyDelivery1.json');
const SupplyRequestResource1 = require('./fixtures/SupplyRequest/SupplyRequest1.json');
const TaskResource1 = require('./fixtures/Task/Task1.json');
const VisionPrescriptionResource1 = require('./fixtures/VisionPrescription/VisionPrescription1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient scope resource testcases', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Patient everything test', async () => {
        const request = await createTestRequest();

        const person1_payload = {
            scope: 'patient/*.*',
            username: 'patient-123@example.com',
            clientFhirPersonId: 'person1',
            clientFhirPatientId: 'clientFhirPatient',
            bwellFhirPersonId: 'person1',
            bwellFhirPatientId: 'bwellFhirPatient',
            token_use: 'access'
        };
        const headers1 = getHeadersWithCustomPayload(person1_payload);

        // Add resources
        let resp = await request.post('/4_0_0/Person/$merge').send(PersonResource1).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/$merge').send(PersonResource2).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Person/$merge').send(BwellPersonResource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // resp = await request
        //     .put('/4_0_0/Account/1')
        //     .send(AccountResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Account/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Account/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Account/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/AdverseEvent/1')
            .send(AdverseEventResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/AdverseEvent/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/AdverseEvent/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/AdverseEvent/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/AllergyIntolerance/1')
            .send(AllergyIntoleranceResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/AllergyIntolerance/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/AllergyIntolerance/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/AllergyIntolerance/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        // resp = await request
        //     .put('/4_0_0/Appointment/1')
        //     .send(AppointmentResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Appointment/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Appointment/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Appointment/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/AppointmentResponse/1')
            .send(AppointmentResponseResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/AppointmentResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/AppointmentResponse/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/AppointmentResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Basic/1')
            .send(BasicResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Basic/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Basic/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Basic/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/BodyStructure/1')
            .send(BodyStructureResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/BodyStructure/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/BodyStructure/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/BodyStructure/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/CarePlan/1')
            .send(CarePlanResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/CarePlan/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/CarePlan/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/CarePlan/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/CareTeam/1')
            .send(CareTeamResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/CareTeam/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/CareTeam/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/CareTeam/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ChargeItem/1')
            .send(ChargeItemResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ChargeItem/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ChargeItem/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ChargeItem/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Claim/1')
            .send(ClaimResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Claim/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Claim/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Claim/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ClaimResponse/1')
            .send(ClaimResponseResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ClaimResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ClaimResponse/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ClaimResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ClinicalImpression/1')
            .send(ClinicalImpressionResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ClinicalImpression/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ClinicalImpression/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ClinicalImpression/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Communication/1')
            .send(CommunicationResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Communication/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Communication/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Communication/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/CommunicationRequest/1')
            .send(CommunicationRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/CommunicationRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/CommunicationRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/CommunicationRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Composition/1')
            .send(CompositionResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Composition/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Composition/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Composition/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Condition/1')
            .send(ConditionResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Condition/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Condition/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Condition/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Consent/1')
            .send(ConsentResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Consent/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Consent/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Consent/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        // resp = await request
        //     .put('/4_0_0/Contract/1')
        //     .send(ContractResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Contract/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Contract/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Contract/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Coverage/1')
            .send(CoverageResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Coverage/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Coverage/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Coverage/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/CoverageEligibilityRequest/1')
            .send(CoverageEligibilityRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/CoverageEligibilityRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/CoverageEligibilityRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/CoverageEligibilityRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/CoverageEligibilityResponse/1')
            .send(CoverageEligibilityResponseResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/CoverageEligibilityResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/CoverageEligibilityResponse/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/CoverageEligibilityResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/DetectedIssue/1')
            .send(DetectedIssueResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/DetectedIssue/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/DetectedIssue/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/DetectedIssue/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Device/1')
            .send(DeviceResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Device/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Device/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Device/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/DeviceRequest/1')
            .send(DeviceRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/DeviceRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/DeviceRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/DeviceRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/DeviceUseStatement/1')
            .send(DeviceUseStatementResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/DeviceUseStatement/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/DeviceUseStatement/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/DeviceUseStatement/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/DiagnosticReport/1')
            .send(DiagnosticReportResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/DiagnosticReport/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/DiagnosticReport/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/DiagnosticReport/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/DocumentManifest/1')
            .send(DocumentManifestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/DocumentManifest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/DocumentManifest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/DocumentManifest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/DocumentReference/1')
            .send(DocumentReferenceResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/DocumentReference/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/DocumentReference/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/DocumentReference/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Encounter/1')
            .send(EncounterResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Encounter/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Encounter/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Encounter/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/EnrollmentRequest/1')
            .send(EnrollmentRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/EnrollmentRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/EnrollmentRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/EnrollmentRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/EpisodeOfCare/1')
            .send(EpisodeOfCareResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/EpisodeOfCare/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/EpisodeOfCare/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/EpisodeOfCare/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ExplanationOfBenefit/1')
            .send(ExplanationOfBenefitResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ExplanationOfBenefit/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ExplanationOfBenefit/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ExplanationOfBenefit/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/FamilyMemberHistory/1')
            .send(FamilyMemberHistoryResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/FamilyMemberHistory/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/FamilyMemberHistory/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/FamilyMemberHistory/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Flag/1')
            .send(FlagResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Flag/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Flag/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Flag/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Goal/1')
            .send(GoalResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Goal/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Goal/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Goal/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        // resp = await request
        //     .put('/4_0_0/Group/1')
        //     .send(GroupResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Group/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Group/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Group/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/GuidanceResponse/1')
            .send(GuidanceResponseResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/GuidanceResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/GuidanceResponse/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/GuidanceResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ImagingStudy/1')
            .send(ImagingStudyResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ImagingStudy/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ImagingStudy/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ImagingStudy/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Immunization/1')
            .send(ImmunizationResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Immunization/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Immunization/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Immunization/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ImmunizationEvaluation/1')
            .send(ImmunizationEvaluationResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ImmunizationEvaluation/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ImmunizationEvaluation/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ImmunizationEvaluation/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ImmunizationRecommendation/1')
            .send(ImmunizationRecommendationResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ImmunizationRecommendation/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ImmunizationRecommendation/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ImmunizationRecommendation/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Invoice/1')
            .send(InvoiceResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Invoice/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Invoice/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Invoice/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/List/1')
            .send(ListResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/List/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/List/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/List/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/MeasureReport/1')
            .send(MeasureReportResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/MeasureReport/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/MeasureReport/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/MeasureReport/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Media/1')
            .send(MediaResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Media/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Media/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Media/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/MedicationAdministration/1')
            .send(MedicationAdministrationResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/MedicationAdministration/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/MedicationAdministration/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/MedicationAdministration/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/MedicationDispense/1')
            .send(MedicationDispenseResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/MedicationDispense/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/MedicationDispense/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/MedicationDispense/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/MedicationRequest/1')
            .send(MedicationRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/MedicationRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/MedicationRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/MedicationRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/MedicationStatement/1')
            .send(MedicationStatementResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/MedicationStatement/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/MedicationStatement/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/MedicationStatement/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/MolecularSequence/1')
            .send(MolecularSequenceResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/MolecularSequence/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/MolecularSequence/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/MolecularSequence/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Observation/1')
            .send(ObservationResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Observation/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Observation/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Observation/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Patient/1')
            .send(PatientResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Patient/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Patient/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Patient/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Procedure/1')
            .send(ProcedureResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Procedure/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Procedure/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Procedure/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        // resp = await request
        //     .put('/4_0_0/Provenance/1')
        //     .send(ProvenanceResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Provenance/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Provenance/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Provenance/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/QuestionnaireResponse/1')
            .send(QuestionnaireResponseResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/QuestionnaireResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/QuestionnaireResponse/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/QuestionnaireResponse/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/RelatedPerson/1')
            .send(RelatedPersonResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/RelatedPerson/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/RelatedPerson/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/RelatedPerson/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/RequestGroup/1')
            .send(RequestGroupResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/RequestGroup/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/RequestGroup/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/RequestGroup/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ResearchSubject/1')
            .send(ResearchSubjectResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ResearchSubject/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ResearchSubject/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ResearchSubject/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/RiskAssessment/1')
            .send(RiskAssessmentResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/RiskAssessment/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/RiskAssessment/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/RiskAssessment/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        // resp = await request
        //     .put('/4_0_0/Schedule/1')
        //     .send(ScheduleResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Schedule/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Schedule/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Schedule/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/ServiceRequest/1')
            .send(ServiceRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/ServiceRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/ServiceRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/ServiceRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        // resp = await request
        //     .put('/4_0_0/Signature/1')
        //     .send(SignatureResource1)
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(201);

        // resp = await request
        //     .get('/4_0_0/Signature/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(1);

        // resp = await request
        //     .delete('/4_0_0/Signature/1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(204);

        // resp = await request
        //     .get('/4_0_0/Signature/?_bundle=1')
        //     .set(headers1);
        // // noinspection JSUnresolvedFunction
        // expect(resp).toHaveStatusCode(200);
        // expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Specimen/1')
            .send(SpecimenResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Specimen/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Specimen/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Specimen/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/SupplyDelivery/1')
            .send(SupplyDeliveryResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/SupplyDelivery/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/SupplyDelivery/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/SupplyDelivery/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/SupplyRequest/1')
            .send(SupplyRequestResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/SupplyRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/SupplyRequest/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/SupplyRequest/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/Task/1')
            .send(TaskResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/Task/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/Task/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/Task/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);

        resp = await request
            .put('/4_0_0/VisionPrescription/1')
            .send(VisionPrescriptionResource1)
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(201);

        resp = await request
            .get('/4_0_0/VisionPrescription/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(1);

        resp = await request
            .delete('/4_0_0/VisionPrescription/1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(204);

        resp = await request
            .get('/4_0_0/VisionPrescription/?_bundle=1')
            .set(headers1);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry).toHaveLength(0);
    });
});
