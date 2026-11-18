const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals');
const metrics = require('../../../../../utils/metrics');
const { ConfigManager } = require('../../../../../utils/configManager');
const { ResourceValidator } = require('../../../../../operations/common/resourceValidator');
const { RemoteFhirValidator } = require('../../../../../utils/remoteFhirValidator');
const { DatabaseQueryFactory } = require('../../../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../../../dataLayer/databaseUpdateFactory');
const { ScopesManager } = require('../../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../../fhir/patientFilterManager');
const { ValidateIncomingStep } = require('../../../../../operations/writePipeline/steps/validateIncomingStep');
const { PrepareBodyStep } = require('../../../../../operations/writePipeline/steps/prepareBodyStep');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../../../../operations/writePipeline/writeItem');
const { WRITE_FAILURE_STAGE } = require('../../../../../operations/writePipeline/writeFailure');
const { WriteContext } = require('../../../../../operations/writePipeline/writeContext');

/**
 * The synthetic `_uuid` the identity step set on each body before `PrepareBodyStep` saved it.
 */
const SAVED_UUID = '00000000-0000-4000-8000-0000000000d1';

/**
 * The size limit, in bytes, under which every AuditEvent in these cases is too large.
 */
const SMALL_AUDIT_EVENT_MAX_SIZE_BYTES = '100';

/**
 * Builds a `ResourceValidator` with the real config and scopes manager; it reaches no database.
 */
const buildResourceValidator = () => new ResourceValidator({
    configManager: new ConfigManager(),
    remoteFhirValidator: Object.create(RemoteFhirValidator.prototype),
    databaseQueryFactory: Object.create(DatabaseQueryFactory.prototype),
    databaseUpdateFactory: Object.create(DatabaseUpdateFactory.prototype),
    scopesManager: Object.create(ScopesManager.prototype),
    patientFilterManager: Object.create(PatientFilterManager.prototype)
});

/**
 * Builds a `ResourceValidator` whose size check throws a synthetic error.
 */
const buildThrowingSizeValidator = () => {
    const resourceValidator = buildResourceValidator();
    jest.spyOn(resourceValidator, 'validateResourceSizeSync').mockImplementation(() => {
        throw new Error('synthetic size check error');
    });
    return resourceValidator;
};

/**
 * An owner and access tag for the synthetic `client` tenant.
 */
const meta = Object.freeze({
    source: 'http://example.com/source',
    security: [
        { system: 'https://www.icanbwell.com/access', code: 'client' },
        { system: 'https://www.icanbwell.com/owner', code: 'client' }
    ]
});

/**
 * Builds a schema-invalid AuditEvent, with a bad `recorded` date and the given id, over the small
 * size limit.
 */
const buildOversizedInvalidAuditEvent = (id) => ({
    resourceType: 'AuditEvent',
    id,
    meta: structuredClone(meta),
    type: { system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110112' },
    recorded: 'not-a-date',
    agent: [{ requestor: true }],
    source: { observer: { reference: 'Person/synthetic' } }
});

/**
 * Builds a schema-invalid Patient, with a bad `birthDate`, and the given id.
 */
const buildInvalidPatient = (id) => ({
    resourceType: 'Patient',
    id,
    meta: structuredClone(meta),
    birthDate: 'not-a-date'
});

/**
 * The cases where a size or pipe-in-id check fails the item: the validator, the body, and the
 * stage and the issue code or error message the failure carries.
 */
const BODY_CHECK_FAILURE_CASES = [
    {
        name: 'an oversized AuditEvent',
        buildValidator: buildResourceValidator,
        buildBody: () => buildOversizedInvalidAuditEvent('synthetic-audit'),
        stage: WRITE_FAILURE_STAGE.SIZE,
        issueCode: 'too-long',
        errorMessage: null
    },
    {
        name: 'a pipe in the id',
        buildValidator: buildResourceValidator,
        buildBody: () => buildInvalidPatient('synthetic|pipe'),
        stage: WRITE_FAILURE_STAGE.IDENTITY,
        issueCode: null,
        errorMessage: 'Pipe | is not allowed in id field'
    },
    {
        name: 'a size check that throws',
        buildValidator: buildThrowingSizeValidator,
        buildBody: () => buildInvalidPatient('synthetic-patient'),
        stage: WRITE_FAILURE_STAGE.SIZE,
        issueCode: null,
        errorMessage: 'synthetic size check error'
    },
    {
        name: 'an oversized AuditEvent with a pipe in the id',
        buildValidator: buildResourceValidator,
        buildBody: () => buildOversizedInvalidAuditEvent('synthetic|audit'),
        stage: WRITE_FAILURE_STAGE.SIZE,
        issueCode: 'too-long',
        errorMessage: null
    }
];

/**
 * Builds an item for the body with the identity the identity step sets, then saves and strips it
 * with `PrepareBodyStep`, as the pipeline does before `validateIncoming`.
 */
const buildPreparedItem = async (body) => {
    const item = new WriteItem({
        index: 0,
        incoming: { ...body, _uuid: SAVED_UUID, _sourceAssigningAuthority: 'client' }
    });
    await new PrepareBodyStep().runAsync({ items: [item] });
    return item;
};

/**
 * Builds a `$merge` context without smart merge.
 */
const buildContext = () => new WriteContext({
    requestInfo: { requestId: 'request-1', path: '/4_0_0/Patient/$merge' },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Returns the labels of each schema-stage `fhir_validation_failure_total` increment the spy saw.
 */
const schemaFailureLabelsOf = (validationFailureAddSpy) => validationFailureAddSpy.mock.calls
    .map(([, labels]) => labels)
    .filter(
        (labels) => labels?.[metrics.LABEL.VALIDATION_STAGE] === metrics.VALIDATION_STAGE.SCHEMA
    );

describe('ValidateIncomingStep', () => {
    const originalAuditEventMaxSizeBytes = process.env.AUDIT_EVENT_MAX_SIZE_BYTES;
    let validationFailureAddSpy;

    beforeEach(() => {
        process.env.AUDIT_EVENT_MAX_SIZE_BYTES = SMALL_AUDIT_EVENT_MAX_SIZE_BYTES;
        validationFailureAddSpy = jest.spyOn(metrics.validationFailureCounter, 'add');
    });

    afterEach(() => {
        validationFailureAddSpy.mockRestore();
        if (originalAuditEventMaxSizeBytes === undefined) {
            delete process.env.AUDIT_EVENT_MAX_SIZE_BYTES;
        } else {
            process.env.AUDIT_EVENT_MAX_SIZE_BYTES = originalAuditEventMaxSizeBytes;
        }
    });

    test.each(BODY_CHECK_FAILURE_CASES)(
        '$name fails at $stage with no restored uuid or source assigning authority',
        async ({ buildValidator, buildBody, stage, issueCode, errorMessage }) => {
            const item = await buildPreparedItem(buildBody());
            const step = new ValidateIncomingStep({ resourceValidator: buildValidator() });

            await step.runAsync({ items: [item], context: buildContext() });

            expect(item.status).toBe(WRITE_ITEM_STATUS.FAILED);
            expect(item.failure.stage).toBe(stage);
            expect(item.failure.operationOutcome?.issue?.[0]?.code ?? null).toBe(issueCode);
            expect(item.failure.error?.message ?? null).toBe(errorMessage);
            expect(item.failure.subject.uuid).toBeUndefined();
            expect(item.failure.subject.sourceAssigningAuthority).toBeUndefined();
        }
    );

    test.each([
        ...BODY_CHECK_FAILURE_CASES.map((testCase) => ({ ...testCase, schemaFailures: 0 })),
        {
            name: 'a schema-invalid Patient with a valid id',
            buildValidator: buildResourceValidator,
            buildBody: () => buildInvalidPatient('synthetic-patient'),
            stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
            schemaFailures: 1
        }
    ])(
        '$name, which is schema-invalid, records $schemaFailures schema failure(s)',
        async ({ buildValidator, buildBody, stage, schemaFailures }) => {
            const item = await buildPreparedItem(buildBody());
            const step = new ValidateIncomingStep({ resourceValidator: buildValidator() });

            await step.runAsync({ items: [item], context: buildContext() });

            expect(item.failure.stage).toBe(stage);
            expect(schemaFailureLabelsOf(validationFailureAddSpy)).toHaveLength(schemaFailures);
        }
    );
});
