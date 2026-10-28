const bwellResource = require('./fixtures/ActivityDefinition/activitydefinition4.json');
const clientResource = require('./fixtures/ActivityDefinition/activitydefinition5.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const deepcopy = require('deepcopy');

const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const allAccessHeaders = getHeaders('user/*.read user/*.write access/bwell.* access/client.*');

const ownerOf = (resource) =>
    resource.meta.security.find((s) => s.system === SecurityTagSystem.owner).code;

const searchById = async (request, id) => {
    const resp = await request
        .get(`/4_0_0/ActivityDefinition/?_bundle=1&id=${id}`)
        .set(allAccessHeaders)
        .expect(200);
    return resp.body.entry.map((e) => e.resource);
};

describe('PUT resolves the target by id plus owner/sourceAssigningAuthority', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('a body owned by a different client creates a separate resource and leaves the first unchanged', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/ActivityDefinition/$merge')
            .send(bwellResource)
            .set(allAccessHeaders)
            .expect(200);

        const body = deepcopy(clientResource);
        body.name = 'CLIENT-OWNED';
        const resp = await request
            .put('/4_0_0/ActivityDefinition/sameid')
            .send(body)
            .set(allAccessHeaders);
        expect(resp.status).toBe(201);

        const resources = await searchById(request, 'sameid');
        expect(resources).toHaveLength(2);
        const bwell = resources.find((r) => ownerOf(r) === 'bwell');
        const client = resources.find((r) => ownerOf(r) === 'client');
        expect(bwell.name).toBe(bwellResource.name);
        expect(bwell.meta.versionId).toBe('1');
        expect(client.name).toBe('CLIENT-OWNED');
    });

    test('a body owned by the same client still updates the existing resource', async () => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/ActivityDefinition/$merge')
            .send(clientResource)
            .set(allAccessHeaders)
            .expect(200);

        const body = deepcopy(clientResource);
        body.name = 'UPDATED';
        await request
            .put('/4_0_0/ActivityDefinition/sameid')
            .send(body)
            .set(allAccessHeaders)
            .expect(200);

        const resources = await searchById(request, 'sameid');
        expect(resources).toHaveLength(1);
        expect(resources[0].name).toBe('UPDATED');
        expect(resources[0].meta.versionId).toBe('2');
    });

    test.each([
        ['no meta', (b) => { delete b.meta; }],
        ['no security', (b) => { delete b.meta.security; }],
        ['empty security', (b) => { b.meta.security = []; }],
        ['access tags only', (b) => {
            b.meta.security = b.meta.security.filter((s) => s.system === SecurityTagSystem.access);
        }]
    ])('a non-uuid id with %s is rejected with 400 and leaves the stored resource unchanged', async (_name, strip) => {
        const request = await createTestRequest();
        await request
            .post('/4_0_0/ActivityDefinition/$merge')
            .send(clientResource)
            .set(allAccessHeaders)
            .expect(200);

        const body = deepcopy(clientResource);
        body.name = 'SHOULD-NOT-APPLY';
        strip(body);
        const resp = await request
            .put('/4_0_0/ActivityDefinition/sameid')
            .send(body)
            .set(allAccessHeaders)
            .expect(400);
        expect(resp.body.resourceType).toBe('OperationOutcome');
        expect(resp.body.issue).toHaveLength(1);
        expect(resp.body.issue[0].severity).toBe('error');
        expect(resp.body.issue[0].code).toBe('invalid');
        expect(resp.body.issue[0].details.text).toMatch(
            /^(Unable to create\/update resource\. Missing either metadata or metadata source\.|Resource ActivityDefinition\/sameid is missing a security access tag with system: https:\/\/www\.icanbwell\.com\/owner)$/
        );

        const resources = await searchById(request, 'sameid');
        expect(resources).toHaveLength(1);
        expect(resources[0].name).toBe(clientResource.name);
        expect(resources[0].meta.versionId).toBe('1');
    });

    describe('with an id|sourceAssigningAuthority url', () => {
        const seedBoth = async () => {
            const request = await createTestRequest();
            await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(bwellResource)
                .set(allAccessHeaders)
                .expect(200);
            await request
                .post('/4_0_0/ActivityDefinition/$merge')
                .send(clientResource)
                .set(allAccessHeaders)
                .expect(200);
            return request;
        };

        test('updates the resource when the url authority matches the body owner', async () => {
            const request = await seedBoth();
            const body = deepcopy(clientResource);
            body.name = 'UPDATED-VIA-URL';

            await request
                .put('/4_0_0/ActivityDefinition/sameid|client')
                .send(body)
                .set(allAccessHeaders)
                .expect(200);

            const resources = await searchById(request, 'sameid');
            expect(resources).toHaveLength(2);
            expect(resources.find((r) => ownerOf(r) === 'client').name).toBe('UPDATED-VIA-URL');
            expect(resources.find((r) => ownerOf(r) === 'bwell').name).toBe(bwellResource.name);
        });

        test('is rejected with 400 and changes nothing when the url authority differs from the body owner', async () => {
            const request = await seedBoth();
            const body = deepcopy(clientResource);
            body.name = 'SHOULD-NOT-APPLY';

            const resp = await request
                .put('/4_0_0/ActivityDefinition/sameid|bwell')
                .send(body)
                .set(allAccessHeaders)
                .expect(400);
            expect(resp.body.issue[0].details.text).toContain('does not match');

            const resources = await searchById(request, 'sameid');
            expect(resources).toHaveLength(2);
            expect(resources.find((r) => ownerOf(r) === 'client').name).toBe(clientResource.name);
            expect(resources.find((r) => ownerOf(r) === 'bwell').name).toBe(bwellResource.name);
        });

        test('is rejected with 400 when the body has no owner or sourceAssigningAuthority tag', async () => {
            const request = await seedBoth();
            const body = deepcopy(clientResource);
            body.name = 'SHOULD-NOT-APPLY';
            body.meta.security = body.meta.security.filter(
                (s) => s.system === SecurityTagSystem.access
            );

            await request
                .put('/4_0_0/ActivityDefinition/sameid|client')
                .send(body)
                .set(allAccessHeaders)
                .expect(400);

            const resources = await searchById(request, 'sameid');
            expect(resources.find((r) => ownerOf(r) === 'client').name).toBe(clientResource.name);
        });
    });
});
