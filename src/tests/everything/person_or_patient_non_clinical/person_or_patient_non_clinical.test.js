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

const carePlanResource = require('./fixtures/CarePlan/carePlan.json');
const medicationResource = require('./fixtures/Medication/medication.json');
const conditionResource = require('./fixtures/Condition/condition.json');
const practitionerResource = require('./fixtures/Practitioner/practitioner.json');
const organizationResource1 = require('./fixtures/Organization/organization1.json');
const organizationResource2 = require('./fixtures/Organization/organization2.json');

// expected
const expectedPersonResourcesWithNonClinicalDepth1 = require('./fixtures/expected/expected_Person_with_non_clinical_depth_1.json');
const expectedPersonResourcesWithNonClinicalDepth2 = require('./fixtures/expected/expected_Person_with_non_clinical_depth_2.json');
const expectedPersonResourcesWithNonClinicalDepthType = require('./fixtures/expected/expected_Person_with_non_clinical_depth_type.json');
const expectedPersonResourcesWithoutNonClinical = require('./fixtures/expected/expected_Person_without_non_clinical.json');

const expectedPatientResourcesWithNonClinicalDepth3 = require('./fixtures/expected/expected_Patient_with_non_clinical_depth_3.json');
const expectedPatientResourcesWithNonClinicalDepth3Contained = require('./fixtures/expected/expected_Patient_with_non_clinical_depth_3_contained.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('everything includeNonClinicalResources Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Person and Patient $everything with includeNonClinicalResources', async () => {
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

        // ACT & ASSERT
        // First get patient everything with depth 3
        resp = await request
            .get(
                '/4_0_0/Patient/patient1/$everything?_debug=true&includeNonClinicalResources=true&nonClinicalResourcesDepth=3'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp.body.meta).toBeDefined();
        expect(resp.body.meta.tag).toBeDefined();

        // in nested resources, the order for resources is not fixed for each run of test cases
        // to handle that we are comparing query and collections seperately
        let receivedQuery = [];
        let receivedQueryCollection = [];
        resp.body.meta.tag.forEach((t) => {
            if (t.system === 'https://www.icanbwell.com/query') {
                receivedQuery = t.display;
                t.display = '';
            } else if (t.system === 'https://www.icanbwell.com/queryCollection') {
                receivedQueryCollection = t.code;
                t.code = '';
            }
        });

        let expectedQuery = [];
        let expectedQueryCollection = [];
        expectedPatientResourcesWithNonClinicalDepth3.meta.tag.forEach((t) => {
            if (t.system === 'https://www.icanbwell.com/query') {
                expectedQuery = t.display;
                t.display = '';
            } else if (t.system === 'https://www.icanbwell.com/queryCollection') {
                expectedQueryCollection = t.code;
                t.code = '';
            }
        });

        expect(receivedQuery.split('|').sort()).toEqual(expectedQuery.split('|').sort());
        expect(receivedQueryCollection.split('|').sort()).toEqual(
            expectedQueryCollection.split('|').sort()
        );
        expect(resp).toHaveResponse(expectedPatientResourcesWithNonClinicalDepth3);

        // get patient everything with non-clinical resources upto depth 3 when contained param is true
        resp = await request
            .get(
                '/4_0_0/Patient/patient1/$everything?includeNonClinicalResources=true&nonClinicalResourcesDepth=3&contained=true'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPatientResourcesWithNonClinicalDepth3Contained);

        // get person everything with non-clinical resources upto depth 2
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?includeNonClinicalResources=true&nonClinicalResourcesDepth=2'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepth2);

        // get person everything with non-clinical resources upto default depth 1 with _type param as CarePlan
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?includeNonClinicalResources=true&_type=CarePlan'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepthType);

        // get person everything with non-clinical resources upto default depth 1
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?includeNonClinicalResources=true'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithNonClinicalDepth1);

        // get person everything without non-clinical resources
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?includeNonClinicalResources=false'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithoutNonClinical);

        // get person everything without non-clinical resources when only depth param is ignored
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?nonClinicalResourcesDepth=2'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPersonResourcesWithoutNonClinical);


        // get person everything when nonClinicalResourcesDepth is invalid
        resp = await request
            .get(
                '/4_0_0/Person/person1/$everything?includeNonClinicalResources=true&nonClinicalResourcesDepth=abc'
            )
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp.body.entry[0].resource.issue[0].details.text).toEqual(
            'Unexpected Error: nonClinicalResourcesDepth: Depth for linked non-clinical resources must be a number between 1 and 3'
        );
    });
});
