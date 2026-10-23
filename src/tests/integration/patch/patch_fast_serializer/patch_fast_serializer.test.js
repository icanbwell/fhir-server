const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const practitionerPayload = () => ({
    resourceType: 'Practitioner',
    active: true,
    gender: 'unknown',
    identifier: [
        { system: 'http://clienthealth.org', value: '4657' },
        { system: 'http://hl7.org/fhir/sid/us-npi', value: '1679033641' }
    ],
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
        ]
    },
    name: [{ family: 'NAJJAR  MD', given: ['SAMER S.'], use: 'usual' }],
    qualification: [
        {
            code: { coding: [{ code: 'MD', system: 'http://terminology.hl7.org/ValueSet/v2-2.7-030' }] },
            issuer: { reference: 'Organization/Stanford_Medical_School' },
            period: { start: '1960-01-01', end: '2021-12-11' }
        }
    ],
    telecom: [{ system: 'email', use: 'work', value: 'foo@foo.com' }]
});

const observationPayload = () => ({
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' }
        ]
    }
});

describe('Patch with fast serializer', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const create = async (request, resourceType, payload) => {
        const postResp = await request.post(`/4_0_0/${resourceType}`).send(payload).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        return postResp.body.id;
    };

    const patch = async (request, resourceType, id, operations) =>
        await request.patch(`/4_0_0/${resourceType}/${id}`).send(operations).set(getHeadersJsonPatch());

    test('fast serializer is enabled by default', async () => {
        await createTestRequest();
        expect(getTestContainer().patchOperation.useFastSerializer).toStrictEqual(true);
    });

    test('patched document and history have the same shape as before', async () => {
        const request = await createTestRequest();
        const id = await create(request, 'Practitioner', practitionerPayload());

        const patchResp = await patch(request, 'Practitioner', id, [
            { op: 'replace', path: '/name/0/family', value: 'PATCHED' }
        ]);
        expect(patchResp).toHaveStatusCode(200);
        expect(patchResp.body.id).toStrictEqual(id);
        expect(patchResp.body.meta.versionId).toStrictEqual('2');
        expect(patchResp.body.name[0].family).toStrictEqual('PATCHED');
        expect(patchResp.body._uuid).toBeUndefined();
        expect(patchResp.body._sourceAssigningAuthority).toBeUndefined();

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('Practitioner_4_0_0').findOne({ _uuid: id });
        expect(stored._sourceAssigningAuthority).toStrictEqual('client');
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.meta.lastUpdated).toBeInstanceOf(Date);
        expect(stored.name[0].family).toStrictEqual('PATCHED');
        expect(stored.qualification[0].issuer).toStrictEqual({
            reference: 'Organization/Stanford_Medical_School',
            _uuid: 'Organization/' + generateUUIDv5('Stanford_Medical_School|client'),
            _sourceId: 'Organization/Stanford_Medical_School',
            _sourceAssigningAuthority: 'client'
        });

        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        const readHistory = async () => await db
            .collection('Practitioner_4_0_0_History')
            .find({ 'resource._uuid': id })
            .sort({ 'resource.meta.versionId': 1 })
            .toArray();
        let history = await readHistory();
        for (let attempt = 0; attempt < 20 && history.length < 2; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            history = await readHistory();
        }
        expect(history.map((h) => h.resource.meta.versionId)).toStrictEqual(['1', '2']);
        expect(history[1].resource.name[0].family).toStrictEqual('PATCHED');
    });

    test('after-save handlers receive the saved resource with its internal fields', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const id = await create(request, 'Practitioner', practitionerPayload());

        const processor = container.postSaveProcessor;
        const originalAfterSave = processor.afterSaveAsync.bind(processor);
        const seen = [];
        processor.afterSaveAsync = async (args) => {
            seen.push({
                eventType: args.eventType,
                uuid: args.doc._uuid,
                sourceAssigningAuthority: args.doc._sourceAssigningAuthority,
                issuerUuid: args.doc.qualification?.[0]?.issuer?._uuid
            });
            return await originalAfterSave(args);
        };
        try {
            const patchResp = await patch(request, 'Practitioner', id, [
                { op: 'replace', path: '/active', value: false }
            ]);
            expect(patchResp).toHaveStatusCode(200);
            await container.postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
            expect(seen).toStrictEqual([
                {
                    eventType: 'U',
                    uuid: id,
                    sourceAssigningAuthority: 'client',
                    issuerUuid: 'Organization/' + generateUUIDv5('Stanford_Medical_School|client')
                }
            ]);
        } finally {
            processor.afterSaveAsync = originalAfterSave;
        }
    });

    test('a patch that changes nothing does not create a new version', async () => {
        const request = await createTestRequest();
        const id = await create(request, 'Practitioner', practitionerPayload());
        const patchResp = await patch(request, 'Practitioner', id, [
            { op: 'replace', path: '/active', value: true }
        ]);
        expect(patchResp).toHaveStatusCode(200);
        expect(patchResp.body.meta.versionId).toStrictEqual('1');
        expect(patchResp.body._uuid).toBeUndefined();
    });

    test('legacy stored empty objects do not fail a patch on an unrelated field', async () => {
        const request = await createTestRequest();
        const id = await create(request, 'Practitioner', practitionerPayload());
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection('Practitioner_4_0_0');
        await collection.updateOne(
            { _uuid: id },
            { $set: { 'qualification.0.period': {}, 'telecom.1': {}, 'name.0.suffix': [], 'name.0.prefix': null } }
        );

        const patchResp = await patch(request, 'Practitioner', id, [
            { op: 'replace', path: '/active', value: false }
        ]);
        expect(patchResp).toHaveStatusCode(200);
        expect(patchResp.body.active).toStrictEqual(false);
        expect(patchResp.body.qualification[0].period).toBeUndefined();
        expect(patchResp.body.telecom).toHaveLength(1);

        const stored = await collection.findOne({ _uuid: id });
        expect(stored.qualification[0].period).toBeUndefined();
        expect(stored.telecom).toHaveLength(1);
        expect(stored.meta.versionId).toStrictEqual('2');
    });

    test('a patch that adds an unknown field is rejected', async () => {
        const request = await createTestRequest();
        const id = await create(request, 'Practitioner', practitionerPayload());
        const patchResp = await patch(request, 'Practitioner', id, [
            { op: 'add', path: '/notAFhirField', value: 'x' }
        ]);
        expect(patchResp).toHaveStatusCode(400);

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('Practitioner_4_0_0').findOne({ _uuid: id });
        expect(stored.notAFhirField).toBeUndefined();
        expect(stored.meta.versionId).toStrictEqual('1');
    });

    test('a patch that empties a required field fails validation', async () => {
        const request = await createTestRequest();
        const id = await create(request, 'Observation', observationPayload());
        const patchResp = await patch(request, 'Observation', id, [
            { op: 'replace', path: '/code', value: {} }
        ]);
        expect(patchResp).toHaveStatusCode(400);
        expect(patchResp.body.issue[0].details.text).toMatch(/code/);
    });

    test('a patch that introduces an invalid nested reference fails validation', async () => {
        const request = await createTestRequest();
        const id = await create(request, 'Observation', observationPayload());
        const patchResp = await patch(request, 'Observation', id, [
            {
                op: 'add',
                path: '/subject',
                value: {
                    reference: 'Patient/5b804b54-0ff5-5dc4-9e42-6ac45c6a5f69',
                    identifier: { value: 'CE33W8M0H2C6HW9', assigner: { reference: 'invalidReference' } }
                }
            }
        ]);
        expect(patchResp).toHaveStatusCode(400);
        expect(patchResp.body.issue[0].details.text).toStrictEqual(
            'subject.identifier.assigner.reference: invalidReference is an invalid reference'
        );
    });
});
