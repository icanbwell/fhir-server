/**
 * A Binary is read by its own securityContext, not through its DocumentReference. When the
 * dataConnectionViewControl Consent hides a DocumentReference, the Binary its attachment points at
 * must be hidden too, or the content of a deleted document would still be returned.
 * consent1.json hides DocumentReference doc-ref-1 (attachment Binary/binary1) and Binary binary2.
 * All data is synthetic.
 */
const { describe, beforeAll, afterAll, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersNdJson,
    createTestRequest
} = require('../../common');
const { PERSON_ID, PATIENT_UUID, OWNER, userHeaders, ndjsonUserHeaders } = require('./viewControlUserFixtures');

const fx = (p) => require(`./fixtures/${p}`);
const SEED = [
    'Person/topLevelPerson.json',
    'Person/person1.json',
    'Patient/patient1.json',
    'DocumentReference/documentReference1.json',
    'DocumentReference/documentReference2.json',
    'Binary/binary1.json',
    'Binary/binary2.json'
];
// uuid5(<id>|healthsystem1)
const HIDDEN_DOC_REF_UUID = '94528605-a9a1-50e6-a0fe-d718d529e660';
const VISIBLE_DOC_REF_UUID = 'd7fa3119-0932-58ab-bf29-2bbed116342d';
const ATTACHMENT_OF_HIDDEN_DOC_REF_UUID = '99cdf7f4-a3ae-5f7b-a759-23a2455f11ab'; // binary1
const HIDDEN_BINARY_UUID = '2be6f9aa-62b1-509c-bafc-28f4665fa465'; // binary2

/** resources in a JSON bundle, a single resource, or an ndjson body */
function resourcesOf(resp) {
    const body = resp.body;
    if (body && Array.isArray(body.entry)) {
        return body.entry.map((e) => e.resource).filter(Boolean);
    }
    if (body && body.resourceType) {
        return [body];
    }
    return String(resp.text || '')
        .split('\n')
        .filter((line) => line.trim().startsWith('{'))
        .map((line) => JSON.parse(line));
}
const idsOf = (resp, resourceType) =>
    resourcesOf(resp).filter((r) => r.resourceType === resourceType).map((r) => r.id).sort();

describe('dataConnectionViewControl Consent on the Binary of a hidden DocumentReference', () => {
    let request;
    let savedEnrolled;

    beforeAll(async () => {
        savedEnrolled = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = OWNER;
        await commonBeforeEach();
        request = await createTestRequest();
        for (const p of [...SEED, 'Consent/consent1.json']) {
            const resp = await request.post(`/4_0_0/${p.split('/')[0]}/1/$merge`).send(fx(p)).set(getHeaders());
            expect(resp.status).toBe(200);
        }
    });

    afterAll(async () => {
        if (savedEnrolled === undefined) {
            delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        } else {
            process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = savedEnrolled;
        }
        await commonAfterEach();
    });

    test.each([
        ['Patient $everything', () => request.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`).set(userHeaders())],
        ['Patient $everything streamed', () =>
            request.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`).set(ndjsonUserHeaders())],
        ['Person $everything', () => request.get(`/4_0_0/Person/${PERSON_ID}/$everything`).set(userHeaders())]
    ])('%s does not return the attachment of a hidden DocumentReference', async (_name, send) => {
        const resp = await send();

        expect(resp.status).toBe(200);
        expect(idsOf(resp, 'DocumentReference')).toEqual([VISIBLE_DOC_REF_UUID]);
        expect(idsOf(resp, 'Binary')).toEqual([]);
    });

    test('REST read of the attachment of a hidden DocumentReference is a 404', async () => {
        const resp = await request.get('/4_0_0/Binary/binary1').set(userHeaders());

        expect(resp.status).toBe(404);
    });

    test('a service token still gets every DocumentReference and Binary', async () => {
        const resp = await request.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`).set(getHeaders());

        expect(resp.status).toBe(200);
        expect(idsOf(resp, 'DocumentReference')).toEqual([HIDDEN_DOC_REF_UUID, VISIBLE_DOC_REF_UUID]);
        expect(idsOf(resp, 'Binary')).toEqual([HIDDEN_BINARY_UUID, ATTACHMENT_OF_HIDDEN_DOC_REF_UUID].sort());
    });

    test('a streamed service-token read is unchanged', async () => {
        const resp = await request.get(`/4_0_0/Patient/${PATIENT_UUID}/$everything`)
            .set({ ...getHeadersNdJson(), Authorization: getHeaders().Authorization });

        expect(resp.status).toBe(200);
        expect(idsOf(resp, 'Binary')).toHaveLength(2);
    });
});
