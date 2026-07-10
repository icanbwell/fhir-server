const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');

describe('$run integration', () => {
    beforeEach(async () => await commonBeforeEach());
    afterEach(async () => await commonAfterEach());

    const view = {
        resourceType: 'ViewDefinition',
        resource: 'Patient',
        status: 'active',
        select: [
            {
                column: [
                    { name: 'id', path: 'getResourceKey()' },
                    { name: 'family', path: 'name.family.first()' }
                ]
            }
        ]
    };

    test('projects inline resources to NDJSON rows', async () => {
        const request = await createTestRequest();
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                {
                    name: 'resource',
                    resource: { resourceType: 'Patient', id: 'p1', name: [{ family: 'Smith' }] }
                }
            ]
        };
        const resp = await request
            .post('/4_0_0/ViewDefinition/$run')
            .set({ ...getHeaders(), Accept: 'application/x-ndjson' })
            .send(body);
        expect(resp.status).toBe(200);
        expect(resp.text.trim()).toBe('{"id":"p1","family":"Smith"}');
    });

    test('projects inline resources to NDJSON rows via the bare /$run route', async () => {
        const request = await createTestRequest();
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                {
                    name: 'resource',
                    resource: { resourceType: 'Patient', id: 'p1', name: [{ family: 'Smith' }] }
                }
            ]
        };
        const resp = await request
            .post('/4_0_0/$run')
            .set({ ...getHeaders(), Accept: 'application/x-ndjson' })
            .send(body);
        expect(resp.status).toBe(200);
        expect(resp.text.trim()).toBe('{"id":"p1","family":"Smith"}');
    });
});
