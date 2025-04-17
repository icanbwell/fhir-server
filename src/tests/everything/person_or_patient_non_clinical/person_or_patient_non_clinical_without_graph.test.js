const env = require('var');
// test file
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patient3Resource = require('./fixtures/Patient/patient3.json');

const accountResource = require('./fixtures/Account/account.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

const biologicallyDerivedProductResource = require('./fixtures/BiologicallyDerivedProduct/biologicallyDerivedProduct.json');
const carePlanResource = require('./fixtures/CarePlan/carePlan.json');
const medicationResource = require('./fixtures/Medication/medication.json');
const conditionResource = require('./fixtures/Condition/condition.json');
const practitionerResource = require('./fixtures/Practitioner/practitioner.json');
const organizationResource1 = require('./fixtures/Organization/organization1.json');
const organizationResource2 = require('./fixtures/Organization/organization2.json');
const linkageResource1 = require('./fixtures/Linkage/linkage.json');
const paymentNoticeResource1 = require('./fixtures/PaymentNotice/paymentNotice.json');
const binary1 = require('./fixtures/Binary/binary1.json');
const binary2 = require('./fixtures/Binary/binary2.json');
const documentReference1 = require('./fixtures/DocumentReference/documentReference1.json');
const documentReference2 = require('./fixtures/DocumentReference/documentReference2.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');

const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');

const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');

// expected
const expectedPersonResourcesWithNonClinicalDepth1 = require('./fixtures/expected/expected_Person_with_non_clinical_depth_1.json');
const expectedPersonResourcesWithNonClinicalDepth2 = require('./fixtures/expected/expected_Person_with_non_clinical_depth_2.json');
const expectedPersonResourcesWithNonClinicalDepthType = require('./fixtures/expected/expected_Person_with_non_clinical_depth_type.json');
const expectedPersonResourcesWithoutNonClinical = require('./fixtures/expected/expected_Person_without_non_clinical.json');

const expectedPatientResourcesWithNonClinicalDepth3 = require('./fixtures/expected/expected_Patient_with_non_clinical_depth_3_without_graph.json');
const expectedPatientResourcesWithNonClinicalDepth3GlobalId = require('./fixtures/expected/expected_Patient_with_non_clinical_depth_3_without_graph_global_id.json');
const expectedPatientResourcesWithNonClinicalDepth3AndIncludeHidden = require('./fixtures/expected/expected_Patient_with_non_clinical_depth_3_without_graph_and_inlcude_hidden.json');

const expectedPatientEverythingWithPatientScope = require('./fixtures/expected/expected_patient_everything_with_patient_scope.json');
const expectedPatientEverythingWithPatientScopeAndIncludeHidden = require('./fixtures/expected/expected_patient_everything_with_patient_scope_and_include_hidden.json');
const expectedPatientEverythingForTwoPatients = require('./fixtures/expected/expected_patient_everything_for_two_patients.json');
const expectedPatientEverythingForTwoPatientsWithPatientScope = require('./fixtures/expected/expected_patient_everything_for_two_patients_with_patient_scope.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('everything _includeNonClinicalResources Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Person and Patient $everything with _includeNonClinicalResources', async () => {
        const DISABLE_GRAPH_IN_EVERYTHING_OP = env.DISABLE_GRAPH_IN_EVERYTHING_OP;
        const ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP;

        env.DISABLE_GRAPH_IN_EVERYTHING_OP = '1';
        env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = '1';
        const request = await createTestRequest();
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(topLevelPersonResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient3Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(accountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(observation2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Medication/1/$merge?validate=true')
            .send(medicationResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/BiologicallyDerivedProduct/1/$merge?validate=true')
            .send(biologicallyDerivedProductResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/CarePlan/1/$merge?validate=true')
            .send(carePlanResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Organization/1/$merge?validate=true')
            .send(organizationResource1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Organization/1/$merge?validate=true')
            .send(organizationResource2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Practitioner/1/$merge?validate=true')
            .send(practitionerResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Condition/1/$merge?validate=true')
            .send(conditionResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Subscription/subscription1/$merge?validate=true')
            .send(subscription1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Subscription/subscription2/$merge?validate=true')
            .send(subscription2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionStatus/1/$merge?validate=true')
            .send(subscriptionStatus2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/SubscriptionTopic/1/$merge?validate=true')
            .send(subscriptionTopic2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Linkage/1/$merge?validate=true')
            .send(linkageResource1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/PaymentNotice/1/$merge?validate=true')
            .send(paymentNoticeResource1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Binary/1/$merge?validate=true')
            .send(binary1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Binary/1/$merge?validate=true')
            .send(binary2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/1/$merge?validate=true')
            .send(documentReference1)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/1/$merge?validate=true')
            .send(documentReference2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        // First get patient everything
        resp = await request
            .get(
                '/4_0_0/Patient/patient1/$everything?_debug=true'
            )
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        // noinspection JSUnresolvedFunction
        let expected = deepcopy(expectedPatientResourcesWithNonClinicalDepth3)
        expect(resp).toHaveMongoQuery(expected);
        expect(resp).toHaveResponse(expected);

        // patient everything with global id
        resp = await request
            .get(
                '/4_0_0/Patient/patient1/$everything?_debug=true'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMongoQuery(expectedPatientResourcesWithNonClinicalDepth3GlobalId);
        expect(resp).toHaveResponse(expectedPatientResourcesWithNonClinicalDepth3GlobalId);

        // get patient everything with _includeHidden true
        resp = await request
            .get(
                '/4_0_0/Patient/patient1/$everything?_debug=true&_includeHidden=1'
            )
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMongoQuery(expectedPatientResourcesWithNonClinicalDepth3AndIncludeHidden);
        expect(resp).toHaveResponse(expectedPatientResourcesWithNonClinicalDepth3AndIncludeHidden);

        // patient everything with ignores params _includeNonClinicalResources & _nonClinicalResourcesDepth
        resp = await request.get('/4_0_0/Patient/patient1/$everything?_debug=true&_includeNonClinicalResources=false&_nonClinicalResourcesDepth=4')
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        // noinspection JSUnresolvedFunction
        expected = deepcopy(expectedPatientResourcesWithNonClinicalDepth3)
        expect(resp).toHaveMongoQuery(expected);
        expect(resp).toHaveResponse(expected);

        // get person everything with non-clinical resources upto depth 2
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?_includeNonClinicalResources=true&_nonClinicalResourcesDepth=2'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepth2);

        // get patient everything with _type param as CarePlan and non-clinical are fetched by default
        resp = await request
            .get(
                '/4_0_0/Patient/patient1/$everything?_type=CarePlan'
            )
            .set({
                ...getHeaders(),
                prefer: 'global_id=false'
            });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepthType);

        // get person everything with non-clinical resources upto default depth 1 with _type param as CarePlan
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?_includeNonClinicalResources=true&_type=CarePlan'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepthType);

        // get person everything with non-clinical resources upto default depth 1
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?_includeNonClinicalResources=true'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepth1);

        // get person everything without non-clinical resources
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?_includeNonClinicalResources=false'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithoutNonClinical);

        // get person everything without non-clinical resources when only depth param is ignored
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?_nonClinicalResourcesDepth=2'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithoutNonClinical);


        // get person everything when _nonClinicalResourcesDepth is invalid
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?_includeNonClinicalResources=true&_nonClinicalResourcesDepth=abc'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp.body.entry[0].resource.issue[0].details.text).toEqual(
            'Unexpected Error: _nonClinicalResourcesDepth: Depth for linked non-clinical resources must be a number between 1 and 3'
        );

        // patient everything with patient scope
        let jwtPayload = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: '5f3ca115-8630-5e55-a97d-4d6ee26c0adc',
            clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
            bwellFhirPersonId: 'master-person',
            bwellFhirPatientId: 'master-patient',
            token_use: 'access'
        };
        let patientHeader = getHeadersWithCustomPayload(jwtPayload);

        resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_debug=true')
            .set(patientHeader);
        expect(resp).toHaveMongoQuery(expectedPatientEverythingWithPatientScope);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientEverythingWithPatientScope);


        resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_debug=true&_includeHidden=1')
            .set(patientHeader);
        expect(resp).toHaveMongoQuery(expectedPatientEverythingWithPatientScopeAndIncludeHidden);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientEverythingWithPatientScopeAndIncludeHidden);

        resp = await request.get('/4_0_0/Patient/$everything?_debug=true&id=patient1,patient2')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMongoQuery(expectedPatientEverythingForTwoPatients);
        expect(resp).toHaveResponse(expectedPatientEverythingForTwoPatients);

        // test with patient scope when access to one patient only
        resp = await request.get('/4_0_0/Patient/$everything?_debug=true&id=patient1,patient2')
            .set(patientHeader);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMongoQuery(expectedPatientEverythingForTwoPatientsWithPatientScope);
        expect(resp).toHaveResponse(expectedPatientEverythingForTwoPatientsWithPatientScope);

        env.DISABLE_GRAPH_IN_EVERYTHING_OP = DISABLE_GRAPH_IN_EVERYTHING_OP;
        env.ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP = ENABLE_RAW_BUNDLE_IN_EVERYTHING_OP;
    });
});
