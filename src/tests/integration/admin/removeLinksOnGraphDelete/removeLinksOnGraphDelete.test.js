const expectedParentAfterPatientGraphDelete = require('./fixtures/expected/parentAfterPatientGraphDelete.json');
const expectedParentAfterPersonGraphDelete = require('./fixtures/expected/parentAfterPersonGraphDelete.json');

const { commonBeforeEach, commonAfterEach, getHeadersWithCustomToken, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const adminHeaders = () => getHeadersWithCustomToken('user/*.read user/*.write admin/*.*');

const meta = () => ({
    source: 'http://example.com/source',
    security: [
        { system: 'https://www.icanbwell.com/access', code: 'access' },
        { system: 'https://www.icanbwell.com/owner', code: 'owner' }
    ]
});

const person = (id, references = []) => ({
    resourceType: 'Person',
    id,
    meta: meta(),
    ...(references.length > 0 && { link: references.map((reference) => ({ target: { reference } })) })
});

const patient = (id) => ({ resourceType: 'Patient', id, meta: meta() });

const summarize = (bundle) =>
    bundle.entry.map((e) => ({
        resourceType: e.resource.resourceType,
        id: e.resource.id,
        method: e.request.method
    }));

describe('links to deleted resources are removed from the Persons that point at them', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('deletePatientDataGraph removes the link from a Person outside the graph', async () => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Patient/$merge').send(patient('graph-patient')).set(adminHeaders()).expect(200);
        await request
            .post('/4_0_0/Person/$merge')
            .send([
                person('graph-child', ['Patient/graph-patient']),
                person('graph-parent', ['Person/graph-child', 'Person/graph-sibling']),
                person('graph-sibling')
            ])
            .set(adminHeaders())
            .expect(200);

        let resp = await request
            .delete('/admin/deletePatientDataGraph?id=graph-patient&sync=1')
            .set(adminHeaders())
            .expect(200);

        expect(summarize(resp.body)).toEqual(
            expect.arrayContaining([
                { resourceType: 'Patient', id: 'graph-patient', method: 'DELETE' },
                { resourceType: 'Person', id: 'graph-child', method: 'DELETE' },
                { resourceType: 'Person', id: 'graph-parent', method: 'PATCH' }
            ])
        );
        expect(resp.body.entry).toHaveLength(3);

        resp = await request.get('/4_0_0/Person/graph-parent').set(adminHeaders()).expect(200);
        expect(resp).toHaveResponse(expectedParentAfterPatientGraphDelete);

        resp = await request.get('/4_0_0/Person/graph-parent/_history/2').set(adminHeaders()).expect(200);
        expect(resp.body.link.map((l) => l.target.reference)).toEqual(['Person/graph-sibling']);
        resp = await request.get('/4_0_0/Person/graph-parent/_history/1').set(adminHeaders()).expect(200);
        expect(resp.body.link.map((l) => l.target.reference)).toEqual(['Person/graph-child', 'Person/graph-sibling']);

        resp = await request.get('/4_0_0/Person/graph-parent/_history').set(adminHeaders()).expect(200);
        expect(resp.body.entry.map((e) => e.response.status)).not.toContain('204 No Content');

        await request.get('/4_0_0/Person/graph-child').set(adminHeaders()).expect(404);
        await request.get('/4_0_0/Person/graph-sibling').set(adminHeaders()).expect(200);
    });

    test('deletePersonDataGraph removes the link from a Person outside the graph', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/Person/$merge')
            .send([
                person('stream-victim'),
                person('stream-parent', ['Person/stream-victim', 'Person/stream-keep']),
                person('stream-keep')
            ])
            .set(adminHeaders())
            .expect(200);

        let resp = await request
            .delete('/admin/deletePersonDataGraph?id=stream-victim')
            .set(adminHeaders())
            .expect(200);
        expect(resp.text).toContain('stream-parent');

        resp = await request.get('/4_0_0/Person/stream-parent').set(adminHeaders()).expect(200);
        expect(resp).toHaveResponse(expectedParentAfterPersonGraphDelete);

        resp = await request.get('/4_0_0/Person/stream-parent/_history/2').set(adminHeaders()).expect(200);
        expect(resp.body.link.map((l) => l.target.reference)).toEqual(['Person/stream-keep']);
        resp = await request.get('/4_0_0/Person/stream-parent/_history/1').set(adminHeaders()).expect(200);
        expect(resp.body.link.map((l) => l.target.reference)).toEqual(['Person/stream-victim', 'Person/stream-keep']);

        resp = await request.get('/4_0_0/Person/stream-parent/_history').set(adminHeaders()).expect(200);
        expect(resp.body.entry.map((e) => e.response.status)).not.toContain('204 No Content');

        await request.get('/4_0_0/Person/stream-victim').set(adminHeaders()).expect(404);
        await request.get('/4_0_0/Person/stream-keep').set(adminHeaders()).expect(200);
    });
});
