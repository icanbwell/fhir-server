const patient1Resource = require('./fixtures/Patient/patient1.json');
const patient2Resource = require('./fixtures/Patient/patient2.json');
const patientNewResource = require('./fixtures/Patient/patient_new.json');
const personNoLinkResource = require('./fixtures/Person/person_nolink.json');
const personWithLinkResource = require('./fixtures/Person/person_with_link.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

const JSON_PATCH = { 'Content-Type': 'application/json-patch+json' };
const GENDER_PATCH = [{ op: 'replace', path: '/gender', value: 'female' }];

describe('create, update and patch v2 CRUDS scope granularity Tests', () => {
    let originalFlag;

    beforeAll(() => {
        originalFlag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
    });

    afterAll(() => {
        if (originalFlag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalFlag;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const seed = async () => {
        const request = await createTestRequest();
        const merged = await request
            .post('/4_0_0/Patient/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        expect(merged).toHaveMergeResponse({ created: true });
        return request;
    };

    const getGender = async (request, id) => {
        const resp = await request.get(`/4_0_0/Patient/${id}`).set(getHeaders());
        return resp.status === 200 ? resp.body.gender : resp.status;
    };

    describe('create (POST)', () => {
        test.each([
            ['c on both gates succeeds', 'user/Patient.c access/access.c access/owner.c', 201],
            ['u on both gates is denied', 'user/Patient.u access/access.u access/owner.u', 403],
            ['c on the resource gate only is denied', 'user/Patient.c access/access.u access/owner.u', 403],
            ['c on the access gate only is denied', 'user/Patient.u access/access.c access/owner.c', 403]
        ])('%s', async (name, scope, status) => {
            const request = await seed();
            const resp = await request
                .post('/4_0_0/Patient')
                .send(patientNewResource)
                .set(getHeaders(scope));
            expect(resp.status).toBe(status);
        });
    });

    describe('update (PUT)', () => {
        test.each([
            ['u on both gates updates an existing resource', 'user/Patient.u access/access.u access/owner.u', patient1Resource, 200, 'female'],
            ['u on both gates creates a resource at an unknown id', 'user/Patient.u access/access.u access/owner.u', patient2Resource, 201, 'female'],
            ['c on both gates is denied', 'user/Patient.c access/access.c access/owner.c', patient1Resource, 403, 'male'],
            ['u on the resource gate only is denied', 'user/Patient.u access/access.c access/owner.c', patient1Resource, 403, 'male'],
            ['u on the access gate only is denied', 'user/Patient.c access/access.u access/owner.u', patient1Resource, 403, 'male']
        ])('%s', async (name, scope, resource, status, genderAfter) => {
            const request = await seed();
            const resp = await request
                .put(`/4_0_0/Patient/${resource.id}`)
                .send({ ...resource, gender: 'female' })
                .set(getHeaders(scope));
            expect(resp.status).toBe(status);
            expect(await getGender(request, resource.id)).toBe(status === 403 ? 'male' : genderAfter);
        });
    });

    describe('patch (PATCH)', () => {
        test.each([
            ['u on both gates succeeds', 'user/Patient.u access/access.u access/owner.u', 200, 'female'],
            ['c on both gates is denied', 'user/Patient.c access/access.c access/owner.c', 403, 'male'],
            ['u on the resource gate only is denied', 'user/Patient.u access/access.c access/owner.c', 403, 'male'],
            ['u on the access gate only is denied', 'user/Patient.c access/access.u access/owner.u', 403, 'male']
        ])('%s', async (name, scope, status, genderAfter) => {
            const request = await seed();
            const resp = await request
                .patch('/4_0_0/Patient/1')
                .send(GENDER_PATCH)
                .set({ ...getHeaders(scope), ...JSON_PATCH });
            expect(resp.status).toBe(status);
            expect(await getGender(request, '1')).toBe(genderAfter);
        });
    });
    describe('another tenant', () => {
        test('create with c for another tenant is denied', async () => {
            const request = await seed();
            const resp = await request
                .post('/4_0_0/Patient')
                .send(patientNewResource)
                .set(getHeaders('user/Patient.c access/other.c'));
            expect(resp.status).toBe(403);
        });

        test('update with u for another tenant is denied and leaves the resource unchanged', async () => {
            const request = await seed();
            const resp = await request
                .put('/4_0_0/Patient/1')
                .send({ ...patient1Resource, gender: 'female' })
                .set(getHeaders('user/Patient.u access/other.u'));
            expect(resp.status).toBe(403);
            expect(await getGender(request, '1')).toBe('male');
        });

        test('patch with u for another tenant finds nothing and leaves the resource unchanged', async () => {
            const request = await seed();
            const resp = await request
                .patch('/4_0_0/Patient/1')
                .send(GENDER_PATCH)
                .set({ ...getHeaders('user/Patient.u access/other.u'), ...JSON_PATCH });
            expect(resp.status).toBe(404);
            expect(await getGender(request, '1')).toBe('male');
        });
    });

    describe('Person link tenant check', () => {
        test.each([
            ['create with c on both gates succeeds', 'user/Person.c access/access.c access/owner.c', 201],
            ['create with u on both gates is denied', 'user/Person.u access/access.u access/owner.u', 403]
        ])('%s', async (name, scope, status) => {
            const request = await seed();
            const resp = await request
                .post('/4_0_0/Person')
                .send(personWithLinkResource)
                .set(getHeaders(scope));
            expect(resp.status).toBe(status);
        });

        test.each([
            ['update adding a link with u on both gates succeeds', 'user/Person.u access/access.u access/owner.u', 200],
            ['update adding a link with c on both gates is denied', 'user/Person.c access/access.c access/owner.c', 403]
        ])('%s', async (name, scope, status) => {
            const request = await seed();
            const created = await request
                .post('/4_0_0/Person/$merge')
                .send(personNoLinkResource)
                .set(getHeaders());
            expect(created).toHaveMergeResponse({ created: true });
            const resp = await request
                .put('/4_0_0/Person/person1')
                .send(personWithLinkResource)
                .set(getHeaders(scope));
            expect(resp.status).toBe(status);
        });

        test('merge adding a link with u on both gates succeeds', async () => {
            const request = await seed();
            const created = await request
                .post('/4_0_0/Person/$merge')
                .send(personNoLinkResource)
                .set(getHeaders());
            expect(created).toHaveMergeResponse({ created: true });
            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(personWithLinkResource)
                .set(getHeaders('user/Person.u access/access.u access/owner.u'));
            expect(resp).toHaveMergeResponse({ updated: true });
        });
    });
});
