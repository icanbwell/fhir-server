const { commonBeforeEach, commonAfterEach, getHeadersWithCustomToken, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { setTimeout: sleep } = require('node:timers/promises');

const adminHeaders = () => getHeadersWithCustomToken('user/*.read user/*.write admin/*.*');

const patientResource = {
    resourceType: 'Patient',
    id: 'link-patient-1',
    meta: {
        source: 'http://example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'access' },
            { system: 'https://www.icanbwell.com/owner', code: 'owner' }
        ]
    }
};

describe('createPersonToPatientLink creates a Person when none exists', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('new Person is stored with the link, the patient meta and a history row readable as version 1', async () => {
        const request = await createTestRequest();
        let resp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientResource)
            .set(adminHeaders())
            .expect(200);
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/admin/createPersonToPatientLink')
            .send({ externalPersonId: 'no-such-person', patientId: 'link-patient-1' })
            .set(adminHeaders())
            .expect(200);
        expect(resp.body).toEqual({
            message: 'Created Person and added link from Person/no-such-person to Patient/link-patient-1',
            patientId: 'link-patient-1',
            externalPersonId: 'no-such-person'
        });

        resp = await request
            .get('/4_0_0/Person?link=Patient/link-patient-1')
            .set(adminHeaders())
            .expect(200);
        expect(resp.body).toHaveLength(1);
        const person = resp.body[0];
        expect(person.meta.versionId).toBe('1');
        expect(Date.parse(person.meta.lastUpdated)).not.toBeNaN();
        expect(person).toMatchObject({
            resourceType: 'Person',
            meta: {
                source: 'http://example.com/source',
                security: expect.arrayContaining([
                    expect.objectContaining({ system: 'https://www.icanbwell.com/access', code: 'access' }),
                    expect.objectContaining({ system: 'https://www.icanbwell.com/owner', code: 'owner' })
                ])
            },
            link: [{ target: { reference: 'Patient/link-patient-1' } }]
        });
        expect(person.id).toMatch(/^[0-9a-f-]{36}$/);

        resp = await request
            .get(`/4_0_0/Person/${person.id}`)
            .set(adminHeaders())
            .expect(200);
        expect(resp.body).toMatchObject({ id: person.id, link: [{ target: { reference: 'Patient/link-patient-1' } }] });

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const historyRows = await db.collection('Person_4_0_0_History').find({ 'resource.id': person.id }).toArray();
        expect(historyRows).toHaveLength(1);
        expect(historyRows[0].request.method).toBe('POST');
        expect(historyRows[0].request.url).toBe(`/4_0_0/Person/${person.id}`);
        expect(historyRows[0]._recorded).toBeInstanceOf(Date);
        expect(historyRows[0].resource).toMatchObject({
            resourceType: 'Person',
            id: person.id,
            meta: { versionId: '1' },
            link: [{ target: { reference: 'Patient/link-patient-1' } }]
        });

        resp = await request
            .get(`/4_0_0/Person/${person.id}/_history/1`)
            .set(adminHeaders())
            .expect(200);
        expect(resp.body).toMatchObject({
            resourceType: 'Person',
            id: person.id,
            meta: { versionId: '1' },
            link: [{ target: { reference: 'Patient/link-patient-1' } }]
        });
    });

    test('adding a link to an existing Person records a new version in history and bumps lastUpdated', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Patient/$merge').send(patientResource).set(adminHeaders()).expect(200);
        await request
            .post('/4_0_0/Patient/$merge')
            .send({ ...patientResource, id: 'link-patient-2' })
            .set(adminHeaders())
            .expect(200);

        await request
            .post('/admin/createPersonToPatientLink')
            .send({ externalPersonId: 'no-such-person', patientId: 'link-patient-1' })
            .set(adminHeaders())
            .expect(200);
        const created = await request.get('/4_0_0/Person?link=Patient/link-patient-1').set(adminHeaders()).expect(200);
        const personId = created.body[0].id;
        const createdLastUpdated = Date.parse(created.body[0].meta.lastUpdated);
        await sleep(20);

        const resp = await request
            .post('/admin/createPersonToPatientLink')
            .send({ externalPersonId: personId, patientId: 'link-patient-2' })
            .set(adminHeaders())
            .expect(200);
        expect(resp.body.message).toBe(`Added link from Person/${personId} to Patient/link-patient-2`);

        const updated = await request.get(`/4_0_0/Person/${personId}`).set(adminHeaders()).expect(200);
        expect(updated.body.meta.versionId).toBe('2');
        expect(Date.parse(updated.body.meta.lastUpdated)).toBeGreaterThan(createdLastUpdated);
        expect(updated.body.link.map(l => l.target.reference)).toEqual([
            'Patient/link-patient-1',
            'Patient/link-patient-2'
        ]);

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const historyRows = await db.collection('Person_4_0_0_History')
            .find({ 'resource.id': personId })
            .sort({ 'resource.meta.versionId': 1 })
            .toArray();
        expect(historyRows.map(row => row.resource.meta.versionId)).toEqual(['1', '2']);
        expect(historyRows[1].request.url).toBe(`/4_0_0/Person/${personId}`);
        expect(historyRows[1].resource.link.map(l => l.target.reference)).toEqual([
            'Patient/link-patient-1',
            'Patient/link-patient-2'
        ]);

        const version1 = await request.get(`/4_0_0/Person/${personId}/_history/1`).set(adminHeaders()).expect(200);
        expect(version1.body.link.map(l => l.target.reference)).toEqual(['Patient/link-patient-1']);
    });

    test('a second call finds the created Person and reports the link as existing', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Patient/$merge').send(patientResource).set(adminHeaders()).expect(200);

        await request
            .post('/admin/createPersonToPatientLink')
            .send({ externalPersonId: 'no-such-person', patientId: 'link-patient-1' })
            .set(adminHeaders())
            .expect(200);
        const created = await request.get('/4_0_0/Person?link=Patient/link-patient-1').set(adminHeaders()).expect(200);
        const personId = created.body[0].id;

        const resp = await request
            .post('/admin/createPersonToPatientLink')
            .send({ externalPersonId: personId, patientId: 'link-patient-1' })
            .set(adminHeaders())
            .expect(200);
        expect(resp.body.message).toContain('Link already exists');

        const after = await request.get('/4_0_0/Person?link=Patient/link-patient-1').set(adminHeaders()).expect(200);
        expect(after.body).toHaveLength(1);
        expect(after.body[0].meta.versionId).toBe('1');
    });
});
