const mainPatient = require('./fixtures/Patient/mainPatient.json');
const mainPerson = require('./fixtures/Person/mainPerson.json');
const linkedPerson1 = require('./fixtures/Person/linkedPerson1.json');
const linkedPerson2 = require('./fixtures/Person/linkedPerson2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer
} = require('../../common');
const { describe, test, beforeEach, afterEach, expect } = require('@jest/globals');

describe('personToPatientIdsExpanders Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('All patient ids are fetched from person links', async () => {
        const request = await createTestRequest();
        const personToPatientIdsExpander = getTestContainer().personToPatientIdsExpander;
        let resp = await request
            .post('/4_0_0/Patient/$merge/?validate=true')
            .send(mainPatient)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        let result = await personToPatientIdsExpander.getPatientProxyIdsAsync({
            base_version: '4_0_0',
            ids: 'person.00701751-032e-5b40-94c1-7265c0d547fe',
            includePatientPrefix: true
        });
        expect(result).toEqual('person.00701751-032e-5b40-94c1-7265c0d547fe');

        resp = await request
            .post('/4_0_0/Person/$merge/?validate=true')
            .send(mainPerson)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        result = await personToPatientIdsExpander.getPatientProxyIdsAsync({
            base_version: '4_0_0',
            ids: 'person.00701751-032e-5b40-94c1-7265c0d547fe',
            includePatientPrefix: true
        });
        expect(result.length).toEqual(2);
        expect(result).toEqual([
            'Patient/person.00701751-032e-5b40-94c1-7265c0d547fe',
            'Patient/006d4074-e6d3-5829-ba9b-8e3ab3b7c283'
        ]);

        resp = await request
            .post('/4_0_0/Person/$merge/?validate=true')
            .send(linkedPerson1)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/$merge/?validate=true')
            .send(linkedPerson2)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        result = await personToPatientIdsExpander.getPatientProxyIdsAsync({
            base_version: '4_0_0',
            ids: 'person.00701751-032e-5b40-94c1-7265c0d547fe',
            includePatientPrefix: true
        });
        expect(result.length).toEqual(4);
        expect(result).toEqual([
            'Patient/person.00701751-032e-5b40-94c1-7265c0d547fe',
            'Patient/006d4074-e6d3-5829-ba9b-8e3ab3b7c283',
            'Patient/000000ae-d0ed-429e-8af7-30e535db8059',
            'Patient/f31e6f0a-a0fc-500d-8e6a-e017d633391d'
        ]);
    });
});
