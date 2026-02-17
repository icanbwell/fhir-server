const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, expect, it } = require('@jest/globals');

describe('PUT with If-Match (optimistic locking)', () => {
    let resource;
    let resourceId;
    let request;

    beforeAll(async () => {
        await commonBeforeEach();
        request = await createTestRequest();
        resourceId = 'test-if-match-123';
        resource = {
            resourceType: 'Patient',
            id: resourceId,
            meta: {
                source: 'https://www.icanbwell.com/test', security: [
                    {system: 'https://www.icanbwell.com/owner', code: 'test'}
                ]
            },
            name: [{ given: ['John'], family: 'Doe' }]
        };
        // Create the resource first
        let resp = await request
            .post(`/4_0_0/Patient/${resourceId}/$merge`)
            .send(resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    it('should update resource when weak If-Match matches current version', async () => {
        const updatedResource = { ...resource, name: [{ given: ['Jane'], family: 'Doe' }] };
        const resp = await request
            .put(`/4_0_0/Patient/${resourceId}`)
            .send(updatedResource)
            .set({...getHeaders(), 'If-Match': 'W/"1"'});
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.name[0].given[0]).toBe('Jane');
        expect(resp.body.meta.versionId).toBe('2');
        expect(resp.headers['etag']).toBe('W/"2"');
    });

    it('should handle lowercase if-match header the same as If-Match', async () => {
        const updatedResource = {...resource, name: [{given: ['Jenny'], family: 'Doe'}]};
        const resp = await request
            .put(`/4_0_0/Patient/${resourceId}`)
            .send(updatedResource)
            .set({...getHeaders(), 'if-match': '2'});
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.name[0].given[0]).toBe('Jenny');
        expect(resp.body.meta.versionId).toBe('3');
        expect(resp.headers['etag']).toBe('W/"3"');
    });

    it('should handle comma separated if-match header the same as If-Match', async () => {
        const updatedResource = {...resource, name: [{given: ['Joey'], family: 'Doe'}]};
        const resp = await request
            .put(`/4_0_0/Patient/${resourceId}`)
            .send(updatedResource)
            .set({...getHeaders(), 'if-match': '10, 3'});
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.name[0].given[0]).toBe('Joey');
        expect(resp.body.meta.versionId).toBe('4');
        expect(resp.headers['etag']).toBe('W/"4"');
    });

    it('should fail with 412 Precondition Failed when If-Match does not match', async () => {
        const updatedResource = { ...resource, name: [{ given: ['Jack'], family: 'Doe' }] };
        const resp = await request
            .put(`/4_0_0/Patient/${resourceId}`)
            .send(updatedResource)
            .set({...getHeaders(), 'If-Match': 'W/"999"'});
        expect(resp).toHaveStatusCode(412);
        expect(resp.body.issue[0].code).toBe('precondition-failed');
    });

    it('should update resource when If-Match header is not provided', async () => {
        const updatedResource = { ...resource, name: [{ given: ['Jill'], family: 'Doe' }] };
        const resp = await request
            .put(`/4_0_0/Patient/${resourceId}`)
            .send(updatedResource)
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.name[0].given[0]).toBe('Jill');
    });

    it('should update resource when If-Match is wildcard "*" and resource exists', async () => {
        const updatedResource = { ...resource, name: [{ given: ['Jim'], family: 'Doe' }] };
        const resp = await request
            .put(`/4_0_0/Patient/${resourceId}`)
            .send(updatedResource)
            .set({ ...getHeaders(), 'If-Match': '*' });
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.name[0].given[0]).toBe('Jim');
    });

    it('should fail with 412 Precondition Failed when If-Match is provided but resource does not exist', async () => {
        const nonExistentId = 'non-existent-id';
        const updatedResource = { ...resource, id: nonExistentId, name: [{ given: ['Justin'], family: 'Smith' }] };
        const resp = await request
            .put(`/4_0_0/Patient/${nonExistentId}`)
            .send(updatedResource)
            .set({ ...getHeaders(), 'If-Match': '*' });
        expect(resp).toHaveStatusCode(412);
        expect(resp.body.issue[0].code).toBe('precondition-failed');
    });
});
