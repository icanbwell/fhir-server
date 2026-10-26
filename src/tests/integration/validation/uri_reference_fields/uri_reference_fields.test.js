const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, mockHttpContext } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const immunizationPayload = (educationReference) => ({
    resourceType: 'Immunization',
    id: 'uri-reference-immunization',
    status: 'completed',
    vaccineCode: { coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '08' }] },
    patient: { reference: 'Patient/5b804b54-0ff5-5dc4-9e42-6ac45c6a5f69' },
    occurrenceDateTime: '2021-06-01',
    education: [{ documentType: 'VIS', reference: educationReference }],
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' }
        ]
    }
});

describe('uri fields named reference are not validated as References', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each(['urn:oid:2.16.840.1.113883.6.1', 'hepb-vis.pdf'])(
        '$merge creates and updates an Immunization whose education.reference is %s',
        async (educationReference) => {
            const request = await createTestRequest();
            const created = await request
                .post('/4_0_0/Immunization/$merge')
                .send(immunizationPayload(educationReference))
                .set(getHeaders());
            expect(created).toHaveMergeResponse({ created: true });

            const updatedPayload = immunizationPayload(educationReference);
            updatedPayload.status = 'not-done';
            updatedPayload.statusReason = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'MEDPREC' }] };
            const updated = await request
                .post('/4_0_0/Immunization/$merge')
                .send(updatedPayload)
                .set(getHeaders());
            expect(updated).toHaveMergeResponse({ updated: true });

            const getResp = await request
                .get('/4_0_0/Immunization/uri-reference-immunization')
                .set(getHeaders());
            expect(getResp).toHaveStatusCode(200);
            expect(getResp.body.education[0].reference).toStrictEqual(educationReference);
        }
    );

    test('$merge still rejects an invalid reference in a real Reference element', async () => {
        const request = await createTestRequest();
        const payload = immunizationPayload('urn:oid:2.16.840.1.113883.6.1');
        payload.patient = { reference: 'invalidReference' };
        const resp = await request.post('/4_0_0/Immunization/$merge').send(payload).set(getHeaders());
        expect(resp.status).toStrictEqual(200);
        expect(resp.body.created).toStrictEqual(false);
        expect(resp.body.updated).toStrictEqual(false);
        expect(resp.body.issue.details.text).toStrictEqual('patient.reference: invalidReference is an invalid reference');
    });

    test('POST and PUT accept an Immunization whose education.reference is a uri', async () => {
        const request = await createTestRequest();
        const payload = immunizationPayload('urn:oid:2.16.840.1.113883.6.1');
        delete payload.id;
        const postResp = await request.post('/4_0_0/Immunization').send(payload).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);

        const putPayload = immunizationPayload('hepb-vis.pdf');
        putPayload.id = postResp.body.id;
        const putResp = await request
            .put(`/4_0_0/Immunization/${postResp.body.id}`)
            .send(putPayload)
            .set(getHeaders());
        expect(putResp).toHaveStatusCode(200);
        expect(putResp.body.education[0].reference).toStrictEqual('hepb-vis.pdf');
    });
});
