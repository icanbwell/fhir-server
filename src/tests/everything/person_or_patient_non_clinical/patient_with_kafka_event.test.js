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
const procedureResource = require('./fixtures/Procedure/procedure.json');
const procedureResource2 = require('./fixtures/Procedure/procedure2.json');
const locationResource = require('./fixtures/Location/location.json');
const practitionerRoleResource = require('./fixtures/PractitionerRole/practitionerRole.json');

const subscription1Resource = require('./fixtures/Subscription/subscription1.json');
const subscription2Resource = require('./fixtures/Subscription/subscription2.json');

const subscriptionStatus1Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus1.json');
const subscriptionStatus2Resource = require('./fixtures/SubscriptionStatus/subscriptionStatus2.json');

const subscriptionTopic1Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic1.json');
const subscriptionTopic2Resource = require('./fixtures/SubscriptionTopic/subscriptionTopic2.json');
const excludeConsentResource = require('./fixtures/Consent/consent1.json');

// expected



const expectedPatientEverythingWithPatientScopeAndExcludeRes = require('./fixtures/expected/expected_patient_everything_with_patient_scope_and_exclude_res.json');
const expectedPatientResourcesWithNonClinicalDepth3GlobalIdAndExcludeRes = require('./fixtures/expected/expected_Patient_with_non_clinical_depth_3_without_graph_global_id_exclude_res.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const deepcopy = require('deepcopy');
const { MockKafkaClient } = require('../../mocks/mockKafkaClient');

describe('patient everything kafka events', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    async function createResources(request) {
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

        resp = await request
            .post('/4_0_0/BiologicallyDerivedProduct/1/$merge?validate=true')
            .send(biologicallyDerivedProductResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Procedure/1/$merge?validate=true')
            .send(procedureResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Location/1/$merge?validate=true')
            .send(locationResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/PractitionerRole/1/$merge?validate=true')
            .send(practitionerRoleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });
    }

    test('Patient $everything sends events whenever accessed by patient', async () => {
        const CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL =
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        const ENABLE_FHIR_USE_EVENTS = process.env.ENABLE_FHIR_USE_EVENTS;

        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'healthsystem1';
        process.env.ENABLE_FHIR_USE_EVENTS = '1';
        /**
         * @type {MockKafkaClient}
         */
        let mockKafkaClient;
        const request = await createTestRequest((c) => {
            c.register(
                'kafkaClient',
                () =>
                    new MockKafkaClient({
                        configManager: c.configManager
                    })
            );
            mockKafkaClient = c.kafkaClient;
            return c;
        });

        await createResources(request);

        // ACT & ASSERT
        let resp = await request
            .post('/4_0_0/Procedure/1/$merge?validate=true')
            .send(procedureResource2)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // make consent resource for patient1 containing deleted resources
        resp = await request
            .post('/4_0_0/Consent/1/$merge?validate=true')
            .send(excludeConsentResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // patient everything with patient scope
        let jwtPayload = {
            scope: 'patient/*.* user/*.* access/*.*',
            username: 'test',
            client_id: 'client',
            clientFhirPersonId: '5f3ca115-8630-5e55-a97d-4d6ee26c0adc',
            clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
            bwellFhirPersonId: 'master-person',
            bwellFhirPatientId: 'master-patient',
            managingOrganization: 'managing-org',
            token_use: 'access'
        };
        let patientHeader = getHeadersWithCustomPayload(jwtPayload);

        const mockHeaders = {
            'content-type': 'application/json;charset=utf-8',
            ce_type: 'EverythingAccessed',
            ce_source: 'https://www.icanbwell.com/fhir-server',
            ce_specversion: '1.0',
            ce_datacontenttype: 'application/json;charset=utf-8',
            ce_integrations: '["analytics"]'
        };
        resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_debug=true')
            .set(patientHeader);
        let expected = deepcopy(expectedPatientEverythingWithPatientScopeAndExcludeRes);
        expect(resp).toHaveMongoQuery(expected);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expected);
        expect(mockKafkaClient.cloudEventMessages.length).toBe(1);
        expect(mockKafkaClient.cloudEventMessages[0].value).toBe(
            JSON.stringify({
                managingOrganization: 'managing-org',
                bwellFhirPersonId: 'master-person',
                clientFhirPersonId: '5f3ca115-8630-5e55-a97d-4d6ee26c0adc'
            })
        );
        delete mockKafkaClient.cloudEventMessages[0].headers['ce_time'];
        delete mockKafkaClient.cloudEventMessages[0].headers['ce_id'];
        expect(mockKafkaClient.cloudEventMessages[0].headers).toStrictEqual(mockHeaders);

        mockKafkaClient.cloudEventMessages = [];

        // only works for patient scope
        resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_debug=true')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMongoQuery(
            expectedPatientResourcesWithNonClinicalDepth3GlobalIdAndExcludeRes
        );
        expect(resp).toHaveResponse(
            expectedPatientResourcesWithNonClinicalDepth3GlobalIdAndExcludeRes
        );
        // no events should be sent for this request
        expect(mockKafkaClient.cloudEventMessages.length).toBe(0);
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL =
            CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.ENABLE_FHIR_USE_EVENTS = ENABLE_FHIR_USE_EVENTS;
    });
});
