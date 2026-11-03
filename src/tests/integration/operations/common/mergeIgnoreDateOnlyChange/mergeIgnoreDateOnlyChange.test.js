const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const FIRST_DATE = '2026-01-01T00:00:00.000Z';
const SECOND_DATE = '2026-02-02T00:00:00.000Z';

const buildComposition = (overrides = {}) => ({
    resourceType: 'Composition',
    id: 'date-only-1',
    meta: {
        source: 'https://www.icanbwell.com/intelligence-layer-pipeline',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
            { system: 'https://www.icanbwell.com/access', code: 'bwell' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
        ]
    },
    status: 'final',
    type: { text: 'Summary' },
    title: 'Summary',
    date: FIRST_DATE,
    author: [{ display: 'synthetic author' }],
    ...overrides
});

const mergeAndSettle = async (request, resource, query) => {
    const resp = await request
        .post(`/4_0_0/Composition/1/$merge${query}`)
        .send(resource)
        .set(getHeaders());
    const { postRequestProcessor } = getTestContainer();
    await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
    return resp;
};

const readStored = async (request) => {
    const resp = await request.get('/4_0_0/Composition/date-only-1').set(getHeaders());
    expect(resp.status).toBe(200);
    return resp.body;
};

describe('merge ignores a date-only change when configured for the resource type', () => {
    beforeEach(async () => {
        process.env.MERGE_IGNORE_DATE_ONLY_CHANGE_RESOURCE_TYPES = 'Composition';
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        delete process.env.MERGE_IGNORE_DATE_ONLY_CHANGE_RESOURCE_TYPES;
    });

    test.each([['smartMerge=true', ''], ['smartMerge=false', '?smartMerge=false']])(
        'a new date alone adds no version, and a real change stores the new date (%s)',
        async (_name, query) => {
            const request = await createTestRequest();

            expect(await mergeAndSettle(request, buildComposition(), query)).toHaveMergeResponse({
                created: true
            });

            const dateOnly = await mergeAndSettle(request, buildComposition({ date: SECOND_DATE }), query);
            expect(dateOnly.body.created).toBe(false);
            expect(dateOnly.body.updated).toBe(false);
            const afterDateOnly = await readStored(request);
            expect(afterDateOnly.meta.versionId).toBe('1');
            expect(afterDateOnly.date).toBe(FIRST_DATE);

            const real = await mergeAndSettle(
                request,
                buildComposition({ date: SECOND_DATE, title: 'Changed' }),
                query
            );
            expect(real.body.updated).toBe(true);
            const afterReal = await readStored(request);
            expect(afterReal.meta.versionId).toBe('2');
            expect(afterReal.title).toBe('Changed');
            expect(afterReal.date).toBe(SECOND_DATE);
        }
    );
});

describe('merge keeps creating a version for a date-only change when not configured', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('a new date alone adds a version', async () => {
        const request = await createTestRequest();
        await mergeAndSettle(request, buildComposition(), '');

        const dateOnly = await mergeAndSettle(request, buildComposition({ date: SECOND_DATE }), '');

        expect(dateOnly.body.updated).toBe(true);
        expect((await readStored(request)).meta.versionId).toBe('2');
    });
});
