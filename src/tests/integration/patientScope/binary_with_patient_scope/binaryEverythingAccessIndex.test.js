// With the access index on and two indexed access codes, the access filter is a top-level $or.
// The Binary parent filter must restrict it, never become an alternative to it.
const binary1Resource = require('./fixtures/binary1.json');
const { mergePersonAsync, mergeResourceAsync } = require('./binaryScopeTestHelpers');

const deepcopy = require('deepcopy');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');

const securityFor = (access) => [
    { system: 'https://www.icanbwell.com/owner', code: access },
    { system: 'https://www.icanbwell.com/access', code: access },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: access }
];

describe('Binary $everything with two indexed access codes', () => {
    const originalUseAccessIndex = process.env.USE_ACCESS_INDEX;
    const originalAccessTagsIndexed = process.env.ACCESS_TAGS_INDEXED;

    beforeAll(() => {
        process.env.USE_ACCESS_INDEX = '1';
        process.env.ACCESS_TAGS_INDEXED = 'client,client2';
    });

    afterAll(() => {
        for (const [name, value] of [
            ['USE_ACCESS_INDEX', originalUseAccessIndex],
            ['ACCESS_TAGS_INDEXED', originalAccessTagsIndexed]
        ]) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('does not return a Binary of another tenant that the patient owns', async () => {
        const request = await createTestRequest();
        await mergePersonAsync(request);
        await mergeResourceAsync(request, {
            resourceType: 'Patient',
            id: 'patient1',
            meta: { source: 'client', security: securityFor('client') },
            name: [{ family: 'TEST', given: ['PATIENT'] }]
        });
        for (const [id, access] of [['binary-visible', 'client'], ['binary-foreign', 'other-tenant']]) {
            const binary = deepcopy(binary1Resource);
            binary.id = id;
            binary.meta.security = securityFor(access);
            binary.securityContext.reference = 'Patient/patient1';
            await mergeResourceAsync(request, binary);
        }

        const resp = await request
            .get('/4_0_0/Patient/patient1/$everything?_includeHidden=true')
            .set(getHeaders('user/*.read access/client.* access/client2.*'));

        expect(resp.status).toBe(200);
        const binaryIds = (resp.body.entry ?? [])
            .map((e) => e.resource)
            .filter((r) => r?.resourceType === 'Binary')
            .map((r) => r.meta?.security?.find((x) => x.system.endsWith('/access'))?.code);
        expect(binaryIds).toEqual(['client']);
    });
});
