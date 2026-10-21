// Separate file: the test app is cached per file. With the flag off the CodeSystem property lookup
// is the ordinary reference read, exactly as before ENABLE_PATIENT_SCOPED_BINARY existed.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getGraphQLHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');

class FlagOffConfigManager extends ConfigManager {
    get enablePatientScopedBinary () {
        return false;
    }
}

const security = [
    { system: 'https://www.icanbwell.com/owner', code: 'client' },
    { system: 'https://www.icanbwell.com/access', code: 'client' }
];

describe('Binary patient scope: GraphQL v1 CodeSystem property lookup (flag off)', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('returns Binary content regardless of securityContext, as before the flag', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new FlagOffConfigManager());
            return c;
        });
        let requestId = mockHttpContext();
        const created = await request.post('/4_0_0/Binary').send({
            resourceType: 'Binary',
            contentType: 'text/plain',
            data: Buffer.from('patient-owned', 'utf8').toString('base64'),
            securityContext: { reference: 'Patient/patient1' },
            meta: { source: 'client', security }
        }).set(getHeaders());
        expect(created).toHaveStatusCode(201);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });

        requestId = mockHttpContext();
        const merged = await request.post('/4_0_0/CodeSystem/1/$merge').send({
            resourceType: 'CodeSystem',
            id: 'cs-1',
            status: 'active',
            content: 'complete',
            meta: { source: 'client', security },
            concept: [{ code: 'patient', property: [{ code: 'p', valueString: `Binary/${created.body.id}` }] }]
        }).set(getHeaders());
        expect(merged).toHaveMergeResponse({ created: true });
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });

        const resp = await request
            .post('/$graphql')
            .send({
                operationName: null,
                variables: {},
                query: 'query { codeSystem(id: ["cs-1"]) { entry { resource { concept { code property { valueString } } } } } }'
            })
            .set(getGraphQLHeaders('patient/*.* user/*.read access/*.*'));

        expect(resp.body.errors).toBeUndefined();
        expect(resp.body.data.codeSystem.entry[0].resource.concept[0].property[0].valueString)
            .toBe('patient-owned');
    });
});
