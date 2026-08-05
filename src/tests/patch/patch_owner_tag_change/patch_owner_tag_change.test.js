// DCON-4841: resourceMerger.overWriteNonWritableFields is what reverts any PATCH attempt to change
// a resource's owner/sourceAssigningAuthority tags or meta.source/versionId/lastUpdated -- but
// patch.js only called it when meta.source was present on either the stored or the incoming
// resource. A deployment with REQUIRE_META_SOURCE_TAGS=false can have resources with no meta.source
// at all, and a PATCH to one of those (that also didn't introduce a meta.source) skipped the call
// entirely, leaving those fields reachable via PATCH despite none of them starting with '_' (the
// only thing patchInternalFieldsValidator's naming-convention check looked for).
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

function patientOwnedByClientAWithNoMetaSource () {
    return {
        resourceType: 'Patient',
        id: '1',
        meta: {
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'clientA' },
                { system: 'https://www.icanbwell.com/access', code: 'clientA' }
            ]
        }
    };
}

const hijackOwnerTagAndSourcePatch = [
    { op: 'replace', path: '/meta/security/0/code', value: 'attacker_tenant' },
    { op: 'add', path: '/meta/source', value: 'https://evil.example.com' }
];

// Unlike hijackOwnerTagAndSourcePatch, this never touches meta.source, so it's the patch that
// actually discriminates the DCON-4841 fix: under the old guard
// (foundResource.meta.source || resource?.meta?.source), a source-less resource with no
// meta.source op in the patch would leave both operands falsy and skip the revert entirely.
const hijackOwnerTagOnlyPatch = [
    { op: 'replace', path: '/meta/security/0/code', value: 'attacker_tenant' }
];

describe('DCON-4841 - patch cannot reassign owner tag or forge meta.source on a source-less resource', () => {
    let originalRequireMetaSourceTags;

    beforeEach(async () => {
        originalRequireMetaSourceTags = process.env.REQUIRE_META_SOURCE_TAGS;
        process.env.REQUIRE_META_SOURCE_TAGS = 'false';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalRequireMetaSourceTags === undefined) {
            delete process.env.REQUIRE_META_SOURCE_TAGS;
        } else {
            process.env.REQUIRE_META_SOURCE_TAGS = originalRequireMetaSourceTags;
        }
    });

    test('a patch attempting to hijack the owner tag and forge meta.source is silently reverted', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientOwnedByClientAWithNoMetaSource())
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        // sanity check: the created resource really has no meta.source
        const prePatchResp = await request.get('/4_0_0/Patient/1').set(getHeaders()).expect(200);
        expect(prePatchResp.body.meta.source).toBeUndefined();

        const resp = await request
            .patch('/4_0_0/Patient/1')
            .send(hijackOwnerTagAndSourcePatch)
            .set(getHeadersJsonPatch('access/clientA.* user/*.*'))
            .expect(200);

        const ownerCodes = resp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/owner')
            .map(s => s.code);
        expect(ownerCodes).toStrictEqual(['clientA']);
        expect(resp.body.meta.source).toBeUndefined();

        // confirm the hijack did not persist either
        const getResp = await request.get('/4_0_0/Patient/1').set(getHeaders()).expect(200);
        const persistedOwnerCodes = getResp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/owner')
            .map(s => s.code);
        expect(persistedOwnerCodes).toStrictEqual(['clientA']);
        expect(getResp.body.meta.source).toBeUndefined();
    });

    test('the same patch is reverted for a full-access caller too', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientOwnedByClientAWithNoMetaSource())
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .patch('/4_0_0/Patient/1')
            .send(hijackOwnerTagAndSourcePatch)
            .set(getHeadersJsonPatch())
            .expect(200);

        const ownerCodes = resp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/owner')
            .map(s => s.code);
        expect(ownerCodes).toStrictEqual(['clientA']);
        expect(resp.body.meta.source).toBeUndefined();
    });

    test('a patch that only hijacks the owner tag, with no meta.source op, is silently reverted on a source-less resource', async () => {
        const request = await createTestRequest();

        const createResp = await request
            .post('/4_0_0/Patient/$merge')
            .send(patientOwnedByClientAWithNoMetaSource())
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });

        const resp = await request
            .patch('/4_0_0/Patient/1')
            .send(hijackOwnerTagOnlyPatch)
            .set(getHeadersJsonPatch('access/clientA.* user/*.*'))
            .expect(200);

        const ownerCodes = resp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/owner')
            .map(s => s.code);
        expect(ownerCodes).toStrictEqual(['clientA']);

        const getResp = await request.get('/4_0_0/Patient/1').set(getHeaders()).expect(200);
        const persistedOwnerCodes = getResp.body.meta.security
            .filter(s => s.system === 'https://www.icanbwell.com/owner')
            .map(s => s.code);
        expect(persistedOwnerCodes).toStrictEqual(['clientA']);
    });
});
