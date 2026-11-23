const { createTestRequest } = require('../../../../common');
const { WritePipeline } = require('../../../../../../operations/writePipeline/writePipeline');
const { describe, test, expect, jest } = require('@jest/globals');
const {
    FILEPATH,
    SCOPE_ALL,
    SCOPE_V2_PATIENT,
    withOversizedNames,
    registerImportTestHooks,
    fixture,
    fixtureWithId,
    fixtureChanged,
    sizeOfFixture,
    useWritePath,
    withEachPath,
    expectedFileOf,
    writesExpectedFile,
    expectMatchesExpectedFile,
    seedAsync,
    runImportAsync
} = require('./importTestSetup');

const LARGE_ATTACHMENT_BYTES = 80 * 1024;

/**
 * Lines the mock reader yields as the real reader would for a line it could not parse: a malformed
 * one at the given line number, and one over the size limit.
 */
const malformedJsonLine = (lineNumber) => ({
    __parseError: `Invalid JSON at line ${lineNumber} in "${FILEPATH}": Unexpected token`
});
const TOO_LONG_LINE = {
    __parseError: `Line 2 in "${FILEPATH}" exceeds maximum size of 16 MB`
};

/**
 * Matches a random (version 4) UUID, which the reader gives a line that has no id.
 */
const RANDOM_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;

/**
 * Returns the recorded output with every random UUID replaced by a placeholder, for a case whose
 * line has no id and so gets a new `_uuid` on every run.
 */
const withRandomUuidsReplaced = (recorded) =>
    JSON.parse(JSON.stringify(recorded).replace(RANDOM_UUID, '<randomUuid>'));

describe('$import parity between the old and the new write path', () => {
    registerImportTestHooks();

    /**
     * Each case has a stable `key`, which names its expected file, the resources to `previous`ly
     * store, the NDJSON `lines`, the `scope` of the caller (every resource by default), and the
     * `env` it needs. A case whose line has no id sets `randomUuid`, so the `_uuid` the reader
     * generates for it is replaced in the output. A case that differs on the new path sets `expectedNew` to the row of the
     * plan's differences from the old path that it shows, and reads
     * `expected/newPath/<key>.json` on that path.
     */
    const cases = [
        {
            key: 'created',
            name: 'creates a Patient and an Observation',
            previous: [],
            lines: [fixture('patient'), fixture('observation')]
        },
        {
            key: 'updated',
            name: 'updates a Patient and an Observation',
            previous: [fixture('patient'), fixture('observation')],
            lines: [fixture('patientUpdated'), fixture('observationUpdated')]
        },
        {
            key: 'unchanged',
            name: 'reports an unchanged line',
            expectedNew: 'difference 2: an unchanged line is skipped and gets no update audit',
            previous: [fixture('patient')],
            lines: [fixture('patient')]
        },
        {
            key: 'ifNoneExistCreated',
            name: 'creates a resource whose ifNoneExist query matches nothing',
            previous: [],
            lines: [fixture('ifNoneExistPatient')]
        },
        {
            key: 'ifNoneExistSkipped',
            name: 'skips a resource whose ifNoneExist query matches a stored resource',
            previous: [fixture('patientWithIdentifier')],
            lines: [fixture('ifNoneExistPatient')]
        },
        {
            key: 'ifNoneExistOtherTenant',
            name: 'creates a resource whose ifNoneExist query matches only another tenant',
            previous: [fixture('patientWithIdentifierOtherTenant')],
            lines: [fixture('ifNoneExistPatient')]
        },
        {
            key: 'ifNoneExistSameBatch',
            name: 'skips the second of two lines with one ifNoneExist query in a batch',
            previous: [],
            lines: [fixture('ifNoneExistPatient'), fixture('ifNoneExistPatientSecond')]
        },
        {
            key: 'ifNoneExistAfterFailure',
            name: 'creates a later line with the ifNoneExist query of an earlier line that failed',
            env: { BULK_IMPORT_BATCH_SIZE: '1' },
            previous: [],
            lines: [fixture('ifNoneExistPatientPipeInId'), fixture('ifNoneExistPatientSecond')]
        },
        {
            key: 'accessOnly',
            name: 'imports a line with only an access tag and backfills its owner',
            previous: [],
            lines: [fixture('patientAccessOnly')]
        },
        {
            key: 'twoOwnerTags',
            name: 'rejects a new resource with two owner tags',
            previous: [],
            lines: [fixture('patient'), fixture('patientTwoOwnerTags')]
        },
        {
            key: 'pipeInId',
            name: 'rejects an id with a pipe',
            previous: [],
            lines: [fixture('patient'), fixture('patientPipeInId')]
        },
        {
            key: 'auditEventOverSizeLimit',
            name: 'rejects an AuditEvent over the size limit',
            env: { AUDIT_EVENT_MAX_SIZE_BYTES: String(sizeOfFixture('auditEvent')) },
            previous: [],
            lines: [fixture('auditEvent')]
        },
        {
            key: 'auditEventCreated',
            name: 'creates an AuditEvent without a success audit of its own',
            previous: [],
            lines: [fixture('auditEvent')]
        },
        {
            key: 'forbiddenResourceGate',
            name: 'rejects a line when the scope has no u on the resource type',
            scope: 'user/Patient.c access/client-a.cu',
            env: { ENABLE_SMART_V2_CRUDS_SCOPES: '1' },
            previous: [],
            lines: [fixture('patient')]
        },
        {
            key: 'forbiddenAccessGate',
            name: 'rejects a line when the scope has no u on its access tag',
            scope: 'user/Patient.u access/client-a.c',
            env: { ENABLE_SMART_V2_CRUDS_SCOPES: '1' },
            previous: [],
            lines: [fixture('patient')]
        },
        {
            key: 'forbiddenReadOnlyScope',
            name: 'rejects a line when the scope is read only',
            scope: 'user/*.read access/client-a.read',
            previous: [],
            lines: [fixture('patient')]
        },
        {
            key: 'forbiddenOtherTenantAccessTag',
            name: 'rejects a line with an access tag the caller cannot write and imports the rest',
            scope: SCOPE_V2_PATIENT,
            env: { ENABLE_SMART_V2_CRUDS_SCOPES: '1' },
            previous: [],
            lines: [fixture('patient'), fixture('patientOtherTenant')]
        },
        {
            key: 'forbiddenUuidTakeover',
            name: 'rejects a line whose uuid id belongs to another tenant and leaves that resource unchanged',
            scope: SCOPE_V2_PATIENT,
            env: { ENABLE_SMART_V2_CRUDS_SCOPES: '1' },
            previous: [fixture('patientUuidOtherTenant')],
            lines: [fixture('patientUuidTakeover')]
        },
        {
            key: 'accessTagChange',
            name: 'rejects an update that adds an access tag the caller cannot write',
            scope: SCOPE_V2_PATIENT,
            env: { ENABLE_SMART_V2_CRUDS_SCOPES: '1' },
            previous: [fixture('patient')],
            lines: [fixture('patientAddsOtherAccess')]
        },
        {
            key: 'sameBatchDuplicate',
            name: 'writes two lines of one resource in a batch as a create and an update',
            previous: [],
            lines: [fixture('patientPartOne'), fixture('patientPartTwo')]
        },
        {
            key: 'nullLineFailsRange',
            name: 'fails the whole range after three reads for a line that is JSON null, importing nothing',
            previous: [],
            lines: [null, fixture('patient')]
        },
        {
            key: 'numberLine',
            name: 'reports a line that is a JSON number and imports the next line',
            previous: [],
            lines: [5, fixture('patient')]
        },
        {
            key: 'arrayLine',
            name: 'reports a line that is a JSON array and imports the next line',
            previous: [],
            lines: [[fixture('patient')], fixture('observation')]
        },
        {
            key: 'stringLine',
            name: 'reports a line that is a JSON string and imports the next line',
            previous: [],
            lines: ['not a resource', fixture('patient')]
        },
        {
            key: 'malformedJsonLine',
            name: 'reports a malformed JSON line and imports the lines around it',
            previous: [],
            lines: [fixture('patient'), malformedJsonLine(2), fixture('observation')]
        },
        {
            key: 'tooLongLine',
            name: 'reports a line over the size limit and imports the lines around it',
            previous: [],
            lines: [fixture('patient'), TOO_LONG_LINE, fixture('observation')]
        },
        {
            key: 'group',
            name: 'creates a Group',
            previous: [],
            lines: [fixture('group')]
        },
        {
            key: 'largeAttachment',
            name: 'stores a large DocumentReference attachment in GridFS',
            previous: [],
            lines: [(() => {
                const documentReference = fixture('documentReference');
                documentReference.content[0].attachment.data = 'A'.repeat(LARGE_ATTACHMENT_BYTES);
                return documentReference;
            })()]
        },
        {
            key: 'defaultTags',
            name: 'gives a line without meta the default tags',
            previous: [],
            lines: [fixture('patientWithoutMeta')]
        },
        {
            key: 'internalFields',
            name: 'drops the internal fields sent on a line',
            previous: [],
            lines: [fixture('patientInternalFields')]
        },
        {
            key: 'malformedSecurity',
            name: 'rejects only the lines with a malformed meta.security and imports the line next to them',
            previous: [],
            lines: [
                fixtureChanged('patient', (resource) => {
                    resource.id = 'import-security-string';
                    resource.meta.security = 'not-a-list';
                }),
                fixture('patient'),
                fixtureChanged('patient', (resource) => {
                    resource.id = 'import-security-null';
                    resource.meta.security = [null];
                })
            ]
        },
        {
            key: 'sameBatchRepeatNewResourceMeta',
            name: 'writes a same-batch repeat of a new resource whose meta would fail the new-resource check',
            expectedNew: 'difference 7: a same-batch repeat of a new resource gets the new-resource meta check',
            previous: [],
            lines: [
                fixture('patientPartOne'),
                fixtureChanged('patientPartTwo', (resource) => {
                    resource.meta.security.push({
                        system: 'https://www.icanbwell.com/owner',
                        code: 'client-b'
                    });
                })
            ]
        },
        {
            key: 'flushFailureReleasesIfNoneExist',
            name: 'reports a line the database rejects for its size and tries a later line with its ifNoneExist query',
            expectedNew: 'difference 3: a line the flush rejects fails and frees its ifNoneExist key',
            env: { BULK_IMPORT_BATCH_SIZE: '1' },
            previous: [],
            lines: [
                fixtureChanged('ifNoneExistPatient', ({ resource }) => {
                    withOversizedNames(resource);
                }),
                fixture('ifNoneExistPatientSecond')
            ]
        },
        {
            key: 'flushFailureSameBatchDuplicate',
            name: 'reports both lines of one resource in a batch when the database rejects the merged document for its size',
            expectedNew: 'difference 3: both lines of the document the flush rejects are failed',
            previous: [],
            lines: [
                fixture('patientPartOne'),
                fixtureChanged('patientPartTwo', (resource) => {
                    withOversizedNames(resource);
                })
            ]
        },
        {
            key: 'invalidPrimitiveOnUpdate',
            name: 'rejects an update line with a primitive of the wrong type',
            expectedNew: 'difference 1: the error entry comes from the incoming schema check',
            previous: [fixture('patient')],
            lines: [
                fixtureChanged('patientUpdated', (resource) => {
                    resource.active = 'not-a-boolean';
                })
            ]
        },
        {
            key: 'invalidVersionIdOnCreate',
            name: 'handles a new line whose meta.versionId is not a valid id',
            previous: [],
            lines: [
                fixtureChanged('patient', (resource) => {
                    resource.meta.versionId = 'not a valid id!';
                })
            ]
        },
        {
            key: 'missingId',
            randomUuid: true,
            name: 'rejects a line with no id and imports the line next to it',
            previous: [],
            lines: [
                fixtureChanged('patient', (resource) => {
                    delete resource.id;
                }),
                fixture('observation')
            ]
        },
        {
            key: 'missingIdForbiddenType',
            randomUuid: true,
            name: 'reports a missing id, not the scope, for a line with no id whose type the scope forbids',
            scope: 'user/Observation.* access/*.*',
            previous: [],
            lines: [
                fixtureChanged('patient', (resource) => {
                    delete resource.id;
                })
            ]
        },
        {
            key: 'unsupportedResourceType',
            name: 'rejects a line whose resourceType is not a stored type and imports the line next to it',
            previous: [],
            lines: [
                fixtureChanged('patient', (resource) => {
                    resource.resourceType = 'Parameters';
                    resource.id = 'import-parameters-1';
                    delete resource.name;
                    resource.parameter = [{ name: 'synthetic', valueString: 'synthetic-value' }];
                }),
                fixture('patient')
            ]
        },
        {
            key: 'missingIdDocumentReference',
            randomUuid: true,
            name: 'uploads no attachment for a DocumentReference line with no id and imports the line next to it',
            previous: [],
            lines: [
                fixtureChanged('documentReference', (resource) => {
                    delete resource.id;
                }),
                fixture('documentReference')
            ]
        },
        {
            key: 'sameBatchStoredTwoFields',
            name: 'merges two lines of a batch that change different fields of a stored Patient',
            previous: [fixture('patient')],
            lines: [
                fixtureChanged('patient', (resource) => {
                    resource.gender = 'female';
                }),
                fixtureChanged('patient', (resource) => {
                    resource.birthDate = '1990-01-01';
                })
            ]
        },
        {
            key: 'sameBatchGroupMembers',
            name: 'merges two lines of a batch that add different members to a stored Group',
            previous: [fixture('group')],
            lines: [
                fixtureChanged('group', (resource) => {
                    resource.member.push({ entity: { reference: 'Patient/import-member-3' } });
                }),
                fixtureChanged('group', (resource) => {
                    resource.member.push({ entity: { reference: 'Patient/import-member-4' } });
                })
            ]
        },
        {
            key: 'multiBatch',
            name: 'flushes in batches of two and keeps the result lines in input order',
            env: { BULK_IMPORT_BATCH_SIZE: '2' },
            previous: [fixtureWithId('patient', 'import-batch-4')],
            lines: [
                fixtureWithId('patient', 'import-batch-1'),
                fixtureWithId('patient', 'import-batch-2'),
                malformedJsonLine(3),
                fixtureWithId('patientUpdated', 'import-batch-4'),
                fixtureWithId('patient', 'import-batch-5'),
                fixtureWithId('patientUpdated', 'import-batch-1')
            ]
        }
    ];

    test.each(withEachPath(cases))('$name on the $writePath path', async ({
        key,
        writePath,
        expectedNew,
        previous,
        lines,
        scope = SCOPE_ALL,
        env = {},
        randomUuid = false
    }) => {
        const request = await createTestRequest();
        await seedAsync(request, previous);
        Object.assign(process.env, env);
        useWritePath(writePath);

        const recordedRun = await runImportAsync({ request, lines, scope });
        const recorded = randomUuid ? withRandomUuidsReplaced(recordedRun) : recordedRun;

        expectMatchesExpectedFile({
            recorded,
            file: expectedFileOf({ key, expectedNew, writePath }),
            write: writesExpectedFile({ expectedNew, writePath })
        });
        const failedEntries = [...recorded.result, ...recorded.errors].filter(
            (entry) => entry.operationOutcome || entry.issue
        );
        for (const entry of failedEntries) {
            expect(entry.issue).toStrictEqual(
                expect.objectContaining({ code: expect.any(String) })
            );
            expect(entry.operationOutcome.issue.length).toBeGreaterThan(0);
        }
    });

    test('the bulk inserter returns one flush result for two lines of one resource in a flush on the new path', async () => {
        const request = await createTestRequest();
        useWritePath('new');
        const executeSpy = jest.spyOn(WritePipeline.prototype, 'executeAsync');

        await runImportAsync({
            request,
            lines: [fixture('patientPartOne'), fixture('patientPartTwo')],
            scope: SCOPE_ALL
        });

        const flushResults = await Promise.all(executeSpy.mock.results.map((call) => call.value));
        const patientResults = flushResults
            .flat()
            .filter((result) => result.resourceType === 'Patient')
            .map(({ _uuid, created, updated }) => ({ _uuid, created, updated }));
        expect(patientResults).toStrictEqual([
            { _uuid: '71a5e9d6-5f54-58fd-9568-d04508f75e3c', created: true, updated: false }
        ]);
    });

    test('cases have unique keys', () => {
        const keys = cases.map((testCase) => testCase.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
