const patientResource = require('./fixtures/patient.json');
const patientUpdatedResource = require('./fixtures/patient_updated.json');
const patientWithoutSourceResource = require('./fixtures/patient_without_source.json');
const patientWithInvalidBirthDateResource = require('./fixtures/patient_with_invalid_birth_date.json');
const patientWithoutIdResource = require('./fixtures/patient_without_id.json');
const patientBadWithoutSourceResource = require('./fixtures/patient_bad_without_source.json');

const expectedCreated = require('./fixtures/expected/expected_created.json');
const expectedNotModified = require('./fixtures/expected/expected_not_modified.json');
const expectedUpdated = require('./fixtures/expected/expected_updated.json');
const expectedMissingSource = require('./fixtures/expected/expected_missing_source.json');
const expectedForbidden = require('./fixtures/expected/expected_forbidden.json');
const expectedInvalidBirthDate = require('./fixtures/expected/expected_invalid_birth_date.json');
const expectedMissingId = require('./fixtures/expected/expected_missing_id.json');
const expectedMixedBatch = require('./fixtures/expected/expected_mixed_batch.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersPreferOperationOutcome,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const postMerge = (request, body, headers = getHeadersPreferOperationOutcome()) =>
    request.post('/4_0_0/Patient/$merge').send(body).set(headers);

describe('$merge with Prefer: return=OperationOutcome', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('successful entries', () => {
        const cases = [
            {
                name: 'created',
                previous: [],
                merge: patientResource,
                expected: expectedCreated
            },
            {
                name: 'not modified',
                previous: [patientResource],
                merge: patientResource,
                expected: expectedNotModified
            },
            {
                name: 'updated',
                previous: [patientResource],
                merge: patientUpdatedResource,
                expected: expectedUpdated
            }
        ];

        test.each(cases)('$name returns the HTTP status as an informational outcome', async ({
            previous,
            merge,
            expected
        }) => {
            const request = await createTestRequest();
            for (const resource of previous) {
                await postMerge(request, resource, getHeaders()).expect(200);
            }

            const resp = await postMerge(request, merge);

            expect(resp).toHaveResponse(expected);
        });
    });

    describe('failed entries', () => {
        const cases = [
            {
                name: 'missing meta.source',
                resource: patientWithoutSourceResource,
                headers: getHeadersPreferOperationOutcome(),
                expected: expectedMissingSource
            },
            {
                name: 'forbidden by access scope',
                resource: patientResource,
                headers: getHeadersPreferOperationOutcome('access/owner.* user/*.*'),
                expected: expectedForbidden
            },
            {
                name: 'schema validation failure',
                resource: patientWithInvalidBirthDateResource,
                headers: getHeadersPreferOperationOutcome(),
                expected: expectedInvalidBirthDate
            },
            {
                name: 'missing resource id',
                resource: patientWithoutIdResource,
                headers: getHeadersPreferOperationOutcome(),
                expected: expectedMissingId
            }
        ];

        test.each(cases)('$name returns the entry issue instead of an OK outcome', async ({
            resource,
            headers,
            expected
        }) => {
            const request = await createTestRequest();

            const resp = await postMerge(request, resource, headers);

            expect(resp).toHaveResponse(expected);
        });

        test('does not store the rejected resource', async () => {
            const request = await createTestRequest();

            await postMerge(request, patientWithoutSourceResource);

            const resp = await request.get('/4_0_0/Patient').set(getHeaders());
            expect(resp).toHaveResourceCount(0);
        });
    });

    describe('batch with a successful and a failed entry', () => {
        test('reports each entry by its own outcome', async () => {
            const request = await createTestRequest();

            const resp = await postMerge(request, [patientResource, patientBadWithoutSourceResource]);

            expect(resp).toHaveResponse(expectedMixedBatch);

            const stored = await request.get('/4_0_0/Patient').set(getHeaders());
            expect(stored).toHaveResourceCount(1);
        });
    });
});
