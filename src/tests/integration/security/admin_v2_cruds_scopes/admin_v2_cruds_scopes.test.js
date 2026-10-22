const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('admin route v2 CRUDS scope granularity Tests', () => {
    let originalFlag;

    beforeAll(() => {
        originalFlag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
    });

    afterAll(() => {
        if (originalFlag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalFlag;
        }
    });

    beforeEach(async () => {
        process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const routes = {
        read: (request, scope) => request.get('/admin/getCacheKeys').set(getHeaders(scope)),
        cacheInvalidate: (request, scope) => request.post('/admin/invalidateCache').send({}).set(getHeaders(scope)),
        exportStatusUpdate: (request, scope) => request.put('/admin/ExportStatus').send({}).set(getHeaders(scope)),
        createPersonToPersonLink: (request, scope) => request.post('/admin/createPersonToPersonLink').send({}).set(getHeaders(scope)),
        runPersonOneToNMatch: (request, scope) => request.get('/admin/runPersonOneToNMatch').set(getHeaders(scope)),
        createPersonToPatientLink: (request, scope) => request.post('/admin/createPersonToPatientLink').send({}).set(getHeaders(scope)),
        removePersonToPersonLink: (request, scope) => request.post('/admin/removePersonToPersonLink').send({}).set(getHeaders(scope)),
        removePersonToPatientLink: (request, scope) => request.post('/admin/removePersonToPatientLink').send({}).set(getHeaders(scope)),
        showPersonToPersonLink: (request, scope) => request.get('/admin/showPersonToPersonLink').set(getHeaders(scope)),
        runPersonMatch: (request, scope) => request.get('/admin/runPersonMatch').set(getHeaders(scope)),
        deletePatientDataGraph: (request, scope) => request.delete('/admin/deletePatientDataGraph').set(getHeaders(scope)),
        deletePatientDataGraphById: (request, scope) => request.delete('/admin/deletePatientDataGraph?id=1').set(getHeaders(scope)),
        deletePersonDataGraph: (request, scope) => request.delete('/admin/deletePersonDataGraph').set(getHeaders(scope)),
        triggerExport: (request, scope) => request.post('/admin/triggerExport').send({}).set(getHeaders(scope)),
        deletePerson: (request, scope) => request.delete('/admin/deletePerson').set(getHeaders(scope))
    };

    test.each([
        ['getCacheKeys asks r: r is allowed', 'read', 'admin/*.r', 200],
        ['getCacheKeys asks r: s is denied', 'read', 'admin/*.s', 403],
        ['getCacheKeys asks r: v1 read is allowed', 'read', 'admin/*.read', 200],
        ['getCacheKeys asks r: v1 write is denied', 'read', 'admin/*.write', 403],
        ['getCacheKeys asks r: rs on a named resource type is allowed', 'read', 'admin/Patient.rs', 200],
        ['invalidateCache asks d: d is allowed', 'cacheInvalidate', 'admin/*.d', 400],
        ['invalidateCache asks d: u is denied', 'cacheInvalidate', 'admin/*.u', 403],
        ['invalidateCache asks d: v1 write is allowed', 'cacheInvalidate', 'admin/*.write', 400],
        ['invalidateCache asks d: v1 read is denied', 'cacheInvalidate', 'admin/*.read', 403],
        ['ExportStatus update asks u: u is allowed', 'exportStatusUpdate', 'admin/*.u', 400],
        ['ExportStatus update asks u: d is denied', 'exportStatusUpdate', 'admin/*.d', 403],
        ['ExportStatus update asks u: v1 wildcard is allowed', 'exportStatusUpdate', 'admin/*.*', 400],
        ['createPersonToPersonLink asks u: u is allowed', 'createPersonToPersonLink', 'admin/*.u', 200],
        ['createPersonToPersonLink asks u: c is denied', 'createPersonToPersonLink', 'admin/*.c', 403],
        ['createPersonToPersonLink asks u: v1 write is allowed', 'createPersonToPersonLink', 'admin/*.write', 200],
        ['createPersonToPatientLink asks c and u: cu is allowed', 'createPersonToPatientLink', 'admin/*.cu', 200],
        ['createPersonToPatientLink asks c and u: u alone is denied', 'createPersonToPatientLink', 'admin/*.u', 403],
        ['createPersonToPatientLink asks c and u: c alone is denied', 'createPersonToPatientLink', 'admin/*.c', 403],
        ['createPersonToPatientLink asks c and u: v1 write is allowed', 'createPersonToPatientLink', 'admin/*.write', 200],
        ['runPersonOneToNMatch asks r and s: rs is allowed', 'runPersonOneToNMatch', 'admin/*.rs', 400],
        ['runPersonOneToNMatch asks r and s: s alone is denied', 'runPersonOneToNMatch', 'admin/*.s', 403],
        ['runPersonOneToNMatch asks r and s: r alone is denied', 'runPersonOneToNMatch', 'admin/*.r', 403],
        ['runPersonOneToNMatch asks r and s: v1 read is allowed', 'runPersonOneToNMatch', 'admin/*.read', 400],
        ['triggerExport asks u: u is allowed', 'triggerExport', 'admin/*.u', 400],
        ['triggerExport asks u: c is denied', 'triggerExport', 'admin/*.c', 403],
        ['triggerExport asks u: v1 write is allowed', 'triggerExport', 'admin/*.write', 400],
        ['removePersonToPersonLink asks u: u is allowed', 'removePersonToPersonLink', 'admin/*.u', 200],
        ['removePersonToPersonLink asks u: d is denied', 'removePersonToPersonLink', 'admin/*.d', 403],
        ['removePersonToPersonLink asks u: v1 write is allowed', 'removePersonToPersonLink', 'admin/*.write', 200],
        ['removePersonToPatientLink asks u: u is allowed', 'removePersonToPatientLink', 'admin/*.u', 200],
        ['removePersonToPatientLink asks u: d is denied', 'removePersonToPatientLink', 'admin/*.d', 403],
        ['removePersonToPatientLink asks u: v1 write is allowed', 'removePersonToPatientLink', 'admin/*.write', 200],
        ['showPersonToPersonLink asks r and s: rs is allowed', 'showPersonToPersonLink', 'admin/*.rs', 200],
        ['showPersonToPersonLink asks r and s: r alone is denied', 'showPersonToPersonLink', 'admin/*.r', 403],
        ['showPersonToPersonLink asks r and s: v1 read is allowed', 'showPersonToPersonLink', 'admin/*.read', 200],
        ['runPersonMatch asks r: r is allowed', 'runPersonMatch', 'admin/*.r', 'not403'],
        ['runPersonMatch asks r: s is denied', 'runPersonMatch', 'admin/*.s', 403],
        ['deletePatientDataGraph asks d and s: ds is allowed', 'deletePatientDataGraph', 'admin/*.ds', 200],
        ['deletePatientDataGraph asks d and s: d alone is denied', 'deletePatientDataGraph', 'admin/*.d', 403],
        ['deletePatientDataGraph asks d and s: v1 wildcard is allowed', 'deletePatientDataGraph', 'admin/*.*', 200],
        ['deletePatientDataGraph asks d and s: v1 write alone is denied', 'deletePatientDataGraph', 'admin/*.write', 403],
        ['deletePersonDataGraph asks d and s: ds is allowed', 'deletePersonDataGraph', 'admin/*.ds', 200],
        ['deletePersonDataGraph asks d and s: d alone is denied', 'deletePersonDataGraph', 'admin/*.d', 403],
        ['deletePerson asks d and s: ds is allowed', 'deletePerson', 'admin/*.ds', 200],
        ['deletePerson asks d and s: d alone is denied', 'deletePerson', 'admin/*.d', 403],
        ['deletePerson asks d and s: cud is denied', 'deletePerson', 'admin/*.cud', 403]
    ])('%s', async (name, route, scope, status) => {
        const request = await createTestRequest();
        const resp = await routes[route](request, `${scope} user/*.* access/*.*`);
        if (status === 'not403') {
            expect(resp.status).not.toBe(403);
        } else {
            expect(resp.status).toBe(status);
        }
    });

    test('a v2 admin suffix grants nothing while the flag is off', async () => {
        process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '';
        const request = await createTestRequest();
        const resp = await routes.cacheInvalidate(request, 'admin/*.d user/*.* access/*.*');
        expect(resp.status).toBe(403);
    });

    test.each([
        ['an admin letter the token lacks', 'cacheInvalidate', 'admin/*.u user/*.* access/*.*'],
        ['a resource scope the token lacks', 'deletePatientDataGraphById', 'admin/*.ds access/*.*']
    ])('a denial for %s does not echo the scopes or the letter back', async (name, route, scope) => {
        const request = await createTestRequest();
        const resp = await routes[route](request, scope);
        expect(resp.status).toBe(403);
        const body = JSON.stringify(resp.body);
        expect(body).not.toMatch(/admin\/|access\/|user\/|\.ds|\.d\b|\.u\b/);
    });
});
