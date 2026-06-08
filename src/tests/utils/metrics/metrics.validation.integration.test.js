// Integration tests for the validation metrics boundary.
//
// Confirms that fhir_validation_failure_total is emitted with the correct
// `path` label depending on whether the failure happened during $validate
// (path=validate) or during a save flow such as POST/$merge (path=save).
const invalidPractitioner = require('./fixtures/invalid_practitioner.json');
const practitionerNoOwner = require('./fixtures/practitioner_no_owner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const metrics = require('../../../utils/metrics');

const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('metrics validation boundary', () => {
    let validationFailureAddSpy;

    beforeEach(async () => {
        await commonBeforeEach();
        validationFailureAddSpy = jest.spyOn(metrics.validationFailureCounter, 'add');
    });

    afterEach(async () => {
        validationFailureAddSpy.mockRestore();
        await commonAfterEach();
    });

    test('$validate of an invalid resource emits path=validate', async () => {
        const request = await createTestRequest();

        await request
            .post('/4_0_0/Practitioner/$validate')
            .send(invalidPractitioner)
            .set(getHeaders());

        const validateCalls = validationFailureAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.PATH] === metrics.PATH.VALIDATE
        );
        expect(validateCalls.length).toBeGreaterThan(0);
        // No save-time emissions should accompany a $validate call.
        const saveCalls = validationFailureAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.PATH] === metrics.PATH.SAVE
        );
        expect(saveCalls.length).toBe(0);
    });

    test('$validate owner-tag failure emits path=validate, stage=meta', async () => {
        // Regression for Claude-bot Bug 3: validate.js's inline owner-tag
        // check returned an OperationOutcome WITHOUT calling
        // recordValidationFailure. Pre-fix, $validate-time owner-tag failures
        // were silently invisible to fhir_validation_failure_total.
        //
        // The fixture is schema-valid (passes resourceValidator.validateResourceAsync)
        // but its meta.security array has only an `access` tag, no `owner`.
        // ScopesManager.doesResourceHaveOwnerTags returns false, the inline
        // check fires, and we now record the failure with path=validate,
        // validation_stage=meta before returning.
        const request = await createTestRequest();

        await request
            .post('/4_0_0/Practitioner/$validate')
            .send(practitionerNoOwner)
            .set(getHeaders());

        const validateMetaCalls = validationFailureAddSpy.mock.calls.filter(
            ([, attrs]) => attrs
                && attrs[metrics.LABEL.PATH] === metrics.PATH.VALIDATE
                && attrs[metrics.LABEL.VALIDATION_STAGE] === metrics.VALIDATION_STAGE.META
                && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Practitioner'
        );
        // Pre-fix: 0 calls (silently invisible). Post-fix: at least 1 call.
        expect(validateMetaCalls.length).toBeGreaterThanOrEqual(1);
    });

    test('$merge of a meta-invalid resource emits path=save (META stage)', async () => {
        // A resource missing meta.source triggers the meta-validation path
        // through validateResourceMetaSync, which now emits with PATH.SAVE
        // and VALIDATION_STAGE.META.
        const request = await createTestRequest();

        const noMetaSource = {
            resourceType: 'Person',
            id: 'metrics-meta-fail',
            meta: {
                versionId: '1',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' }
                ]
            },
            name: [{ use: 'official', family: 'NoSource' }]
        };

        await request
            .post('/4_0_0/Person/$merge')
            .send(noMetaSource)
            .set(getHeaders());

        const saveMetaCalls = validationFailureAddSpy.mock.calls.filter(
            ([, attrs]) => attrs
                && attrs[metrics.LABEL.PATH] === metrics.PATH.SAVE
                && attrs[metrics.LABEL.VALIDATION_STAGE] === metrics.VALIDATION_STAGE.META
        );
        expect(saveMetaCalls.length).toBeGreaterThan(0);
    });
});
