// GraphQL v1 CodeSystem.concept.property.valueString -> Binary lookup with ENABLE_PATIENT_SCOPED_BINARY on.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getGraphQLHeaders, getTestContainer,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');

class FlagOnConfigManager extends ConfigManager {
    get enablePatientScopedBinary () {
        return true;
    }
}

const MIXED_SCOPE = 'patient/*.* user/*.read access/*.*';

const securityFor = (tenant) => [
    { system: 'https://www.icanbwell.com/owner', code: tenant },
    { system: 'https://www.icanbwell.com/access', code: tenant }
];
const security = securityFor('client');

const text = (value) => Buffer.from(value, 'utf8').toString('base64');

const query = `query {
    codeSystem(id: ["cs-1"]) {
        entry {
            resource {
                concept {
                    code
                    property {
                        valueString
                    }
                }
            }
        }
    }
}`;

describe('Binary patient scope: GraphQL v1 CodeSystem property lookup (flag on)', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    /**
     * Creates a Binary as a system caller and returns its server-assigned id
     */
    async function createBinaryAsync (request, data, securityContext, tenant = 'client') {
        const requestId = mockHttpContext();
        const binary = {
            resourceType: 'Binary',
            contentType: 'text/plain',
            data: text(data),
            meta: { source: 'client', security: securityFor(tenant) }
        };
        if (securityContext) {
            binary.securityContext = { reference: securityContext };
        }
        const resp = await request.post('/4_0_0/Binary').send(binary).set(getHeaders());
        expect(resp).toHaveStatusCode(201);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
        return resp.body.id;
    }

    /**
     * Merges CodeSystem cs-1 with one concept per [code, valueString] pair
     */
    async function createCodeSystemAsync (request, concepts) {
        const requestId = mockHttpContext();
        const codeSystem = {
            resourceType: 'CodeSystem',
            id: 'cs-1',
            status: 'active',
            content: 'complete',
            meta: { source: 'client', security },
            concept: concepts.map(([code, valueString]) => ({
                code, property: [{ code: 'p', valueString }]
            }))
        };
        const resp = await request.post('/4_0_0/CodeSystem/1/$merge').send(codeSystem).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    }

    /**
     * @return {Promise<Object>} the response body
     */
    async function queryAsync (request, scope) {
        const resp = await request
            .post('/$graphql')
            .send({ operationName: null, variables: {}, query })
            .set(getGraphQLHeaders(scope));
        return resp.body;
    }

    const valuesByCode = (body) => Object.fromEntries(
        body.data.codeSystem.entry[0].resource.concept.map(c => [c.code, c.property[0].valueString])
    );

    async function setupAsync () {
        return await createTestRequest((c) => {
            c.register('configManager', () => new FlagOnConfigManager());
            return c;
        });
    }

    test('returns Binary content only when securityContext is absent or this CodeSystem', async () => {
        const request = await setupAsync();
        const untagged = await createBinaryAsync(request, 'untagged', null);
        const own = await createBinaryAsync(request, 'own', 'CodeSystem/cs-1');
        const otherCodeSystem = await createBinaryAsync(request, 'other-codesystem', 'CodeSystem/cs-2');
        const patientOwned = await createBinaryAsync(request, 'patient-owned', 'Patient/patient1');
        await createCodeSystemAsync(request, [
            ['untagged', `Binary/${untagged}`],
            ['own', `Binary/${own}`],
            ['other', `Binary/${otherCodeSystem}`],
            ['patient', `Binary/${patientOwned}`],
            ['plain', 'just text']
        ]);

        const body = await queryAsync(request, MIXED_SCOPE);

        expect(body.errors).toBeUndefined();
        expect(valuesByCode(body)).toStrictEqual({
            untagged: 'untagged',
            own: 'own',
            other: null,
            patient: null,
            plain: 'just text'
        });
    });

    test('still applies the tenant filter: a Binary owned by another tenant is not returned', async () => {
        const request = await setupAsync();
        const foreign = await createBinaryAsync(request, 'foreign', null, 'otherTenant');
        const foreignOwn = await createBinaryAsync(request, 'foreign-own', 'CodeSystem/cs-1', 'otherTenant');
        await createCodeSystemAsync(request, [
            ['foreign', `Binary/${foreign}`],
            ['foreignOwn', `Binary/${foreignOwn}`]
        ]);

        const body = await queryAsync(request, 'patient/*.* user/*.read access/client.*');

        expect(body.errors).toBeUndefined();
        expect(valuesByCode(body)).toStrictEqual({ foreign: null, foreignOwn: null });
    });

    test('does not widen a token that has no access scope', async () => {
        const request = await setupAsync();
        const untagged = await createBinaryAsync(request, 'untagged', null);
        await createCodeSystemAsync(request, [['untagged', `Binary/${untagged}`]]);

        const body = await queryAsync(request, 'patient/*.* user/*.read');

        expect(JSON.stringify(body)).not.toContain('untagged"');
    });
});
