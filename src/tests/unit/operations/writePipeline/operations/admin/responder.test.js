const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const httpContext = require('express-http-context');
const { AdminResponder } = require('../../../../../../operations/writePipeline/operations/admin/responder');
const {
    ADMIN_OPERATIONS,
    UnknownAdminOperationError
} = require('../../../../../../operations/writePipeline/operations/admin/adminOperations');
const { WriteResponder } = require('../../../../../../operations/writePipeline/writeResponder');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const {
    WriteItem,
    WRITE_ITEM_STATUS
} = require('../../../../../../operations/writePipeline/writeItem');
const {
    WriteFailure,
    WRITE_FAILURE_STAGE
} = require('../../../../../../operations/writePipeline/writeFailure');
const {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    NotValidatedError
} = require('../../../../../../utils/httpErrors');
const { RethrownError } = require('../../../../../../utils/rethrownError');
const {
    buildOperationOutcome,
    buildOperationOutcomeFromIssues
} = require('../../../../../../utils/operationOutcomeBuilder');
const { assertTypeEquals } = require('../../../../../../utils/assertType');

/**
 * Synthetic uuids for the resources the requests name.
 */
const PERSON_UUID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_PERSON_UUID = '00000000-0000-4000-8000-0000000000a2';
const NEW_PERSON_UUID = '00000000-0000-4000-8000-0000000000a3';
const PATIENT_UUID = '00000000-0000-4000-8000-0000000000b1';
const ENCOUNTER_UUID = '00000000-0000-4000-8000-0000000000c1';

/**
 * The request body of each operation with good ids, as the route handlers send it.
 */
const GOOD_BODIES = Object.freeze({
    createPersonToPersonLink: {
        bwellPersonId: PERSON_UUID,
        externalPersonId: OTHER_PERSON_UUID
    },
    removePersonToPersonLink: {
        bwellPersonId: PERSON_UUID,
        externalPersonId: OTHER_PERSON_UUID
    },
    createPersonToPatientLink: {
        externalPersonId: PERSON_UUID,
        patientId: PATIENT_UUID
    },
    removePersonToPatientLink: {
        personId: PERSON_UUID,
        patientId: PATIENT_UUID
    },
    updatePatientReference: {
        resourceId: ENCOUNTER_UUID,
        resourceType: 'Encounter',
        patientId: PATIENT_UUID
    }
});

/**
 * The change `readAsync` describes for each operation with `GOOD_BODIES`.
 */
const EXPECTED_CHANGES = Object.freeze({
    createPersonToPersonLink: {
        kind: 'addLink',
        target: { resourceType: 'Person', id: PERSON_UUID },
        linkTarget: { resourceType: 'Person', id: OTHER_PERSON_UUID },
        linkTargetLookup: 'never',
        createsMissingTarget: false
    },
    removePersonToPersonLink: {
        kind: 'removeLink',
        target: { resourceType: 'Person', id: PERSON_UUID },
        linkTarget: { resourceType: 'Person', id: OTHER_PERSON_UUID },
        linkTargetLookup: 'never',
        createsMissingTarget: false
    },
    createPersonToPatientLink: {
        kind: 'addLink',
        target: { resourceType: 'Person', id: PERSON_UUID },
        linkTarget: { resourceType: 'Patient', id: PATIENT_UUID },
        linkTargetLookup: 'whenTargetMissing',
        createsMissingTarget: true
    },
    removePersonToPatientLink: {
        kind: 'removeLink',
        target: { resourceType: 'Person', id: PERSON_UUID },
        linkTarget: { resourceType: 'Patient', id: PATIENT_UUID },
        linkTargetLookup: 'never',
        createsMissingTarget: false
    },
    updatePatientReference: {
        kind: 'rewritePatientReference',
        target: { resourceType: 'Encounter', id: ENCOUNTER_UUID },
        linkTarget: { resourceType: 'Patient', id: PATIENT_UUID },
        linkTargetLookup: 'never',
        createsMissingTarget: false
    }
});

/**
 * Whether each operation smart merges the stored document.
 */
const EXPECTED_SMART_MERGE = Object.freeze({
    createPersonToPersonLink: true,
    removePersonToPersonLink: false,
    createPersonToPatientLink: true,
    removePersonToPatientLink: false,
    updatePatientReference: false
});

const OPERATION_NAMES = Object.keys(GOOD_BODIES);

/**
 * The id parameters of each operation, with the resource type each one names.
 */
const ID_PARAMETERS = OPERATION_NAMES.flatMap((operation) =>
    Object.keys(GOOD_BODIES[operation])
        .filter((parameter) => parameter !== 'resourceType')
        .map((parameter) => ({ operation, parameter }))
);

/**
 * Every parameter of each operation, the resource type included.
 */
const ALL_PARAMETERS = OPERATION_NAMES.flatMap((operation) =>
    Object.keys(GOOD_BODIES[operation]).map((parameter) => ({ operation, parameter }))
);

/**
 * The reasons the responder gives for an id with a character the search reads as more than a
 * literal, and for an id whose `|` is not one separator between an id and an authority.
 */
const CHARACTER_REASON = 'must not contain a comma, a backslash or a control character';
const PIPE_REASON = 'must be a _uuid, an id or id|authority with one | and text on both sides';

/**
 * Builds parsed args for an admin request.
 */
const parsedArgsFor = () => ({ base_version: '4_0_0', getRawArgs: () => ({}) });

/**
 * Builds the request info the admin runner builds: the operation and its ids in the body.
 */
const requestInfoFor = ({ operation, body }) => ({
    body: { operation, ...body },
    requestId: 'admin-unit-request'
});

/**
 * Returns the error `readAsync` rejected with, or undefined when it resolved.
 */
const readErrorOf = async (responder, requestInfo) => {
    try {
        await responder.readAsync({ requestInfo, parsedArgs: parsedArgsFor(), resourceType: 'Person' });
    } catch (error) {
        return error;
    }
    return undefined;
};

/**
 * Reads the request of the operation with the body, and returns what `readAsync` returned.
 */
const readAsync = async (responder, operation, body = GOOD_BODIES[operation]) =>
    await responder.readAsync({
        requestInfo: requestInfoFor({ operation, body }),
        parsedArgs: parsedArgsFor(),
        resourceType: 'Person'
    });

/**
 * Builds the context and the item of the operation as the pipeline holds them after `readAsync`.
 */
const readItemOf = async (responder, operation, body = GOOD_BODIES[operation]) => {
    const { context, items } = await readAsync(responder, operation, body);
    return { context, item: items[0] };
};

/**
 * Describes an error by its class, message, status code and issues, so two errors can be compared.
 */
const describeError = (error) => ({
    thrown: error.constructor,
    message: error.message,
    statusCode: error.statusCode,
    issue: error.issue
});

/**
 * Runs the function and returns what it returned, or the description of the error it threw.
 */
const outcomeOf = (func) => {
    try {
        return { returned: func() };
    } catch (error) {
        return describeError(error);
    }
};

/**
 * The subject of every failure in these tests.
 */
const SUBJECT = Object.freeze({
    id: PERSON_UUID,
    uuid: PERSON_UUID,
    sourceAssigningAuthority: 'client',
    resourceType: 'Person'
});

describe('AdminResponder', () => {
    let httpContextSetSpy;
    let responder;

    beforeEach(() => {
        httpContextSetSpy = jest.spyOn(httpContext, 'set').mockImplementation(() => undefined);
        responder = new AdminResponder();
    });

    afterEach(() => {
        httpContextSetSpy.mockRestore();
    });

    test('is a WriteResponder', () => {
        expect(() => assertTypeEquals(responder, WriteResponder)).not.toThrow();
    });

    describe('readAsync', () => {
        test.each(OPERATION_NAMES)(
            '%s reads its ids into one stub item, a change and a context',
            async (operation) => {
                const { context, items, requestErrors, wasIncomingAList } = await readAsync(
                    responder,
                    operation
                );

                expect(items).toHaveLength(1);
                expect(items[0]).toBeInstanceOf(WriteItem);
                expect(items[0].index).toBe(0);
                expect(items[0].incoming).toEqual({
                    resourceType: EXPECTED_CHANGES[operation].target.resourceType,
                    id: EXPECTED_CHANGES[operation].target.id
                });
                expect(items[0].adminChange).toEqual(EXPECTED_CHANGES[operation]);
                expect(items[0].linked).toEqual([]);
                expect(items[0].stored).toBeNull();
                expect(context).toBeInstanceOf(WriteContext);
                expect(context.smartMerge).toBe(EXPECTED_SMART_MERGE[operation]);
                expect(context.base_version).toBe('4_0_0');
                expect(requestErrors).toEqual([]);
                expect(wasIncomingAList).toBe(false);
            }
        );

        test.each(OPERATION_NAMES)(
            '%s gives each read its own change, so reading again is not affected by an earlier item',
            async (operation) => {
                const { item: first } = await readItemOf(responder, operation);
                first.adminChange.target.id = 'changed';
                first.adminChange.linkTarget.id = 'changed';

                const { item: second } = await readItemOf(responder, operation);

                expect(second.adminChange).toEqual(EXPECTED_CHANGES[operation]);
            }
        );

        test.each(
            ID_PARAMETERS.flatMap(({ operation, parameter }) =>
                ['Person/', 'Patient/'].map((prefix) => ({ operation, parameter, prefix }))
            )
        )('$operation strips a leading $prefix from $parameter', async ({ operation, parameter, prefix }) => {
            const body = { ...GOOD_BODIES[operation] };
            const bareId = body[parameter];
            body[parameter] = `${prefix}${bareId}`;

            const { item } = await readItemOf(responder, operation, body);

            const { target, linkTarget } = item.adminChange;
            expect([target.id, linkTarget.id]).toContain(bareId);
            expect([target.id, linkTarget.id]).not.toContain(body[parameter]);
        });

        test.each(ALL_PARAMETERS.flatMap(({ operation, parameter }) =>
            [undefined, null, ''].map((value) => ({ operation, parameter, value }))
        ))(
            '$operation fails a 400 invalid when $parameter is $value',
            async ({ operation, parameter, value }) => {
                const body = { ...GOOD_BODIES[operation], [parameter]: value };

                const error = await readErrorOf(responder, requestInfoFor({ operation, body }));

                expect(error.statusCode).toBe(400);
                expect(error.issue[0].code).toBe('invalid');
                expect(error.message).toBe(`Missing required parameter(s): ${parameter}`);
            }
        );

        test.each(OPERATION_NAMES)('%s names every missing parameter', async (operation) => {
            const error = await readErrorOf(responder, requestInfoFor({ operation, body: {} }));

            expect(error.statusCode).toBe(400);
            expect(error.message).toBe(
                `Missing required parameter(s): ${Object.keys(GOOD_BODIES[operation]).join(', ')}`
            );
        });

        test.each(ID_PARAMETERS.flatMap(({ operation, parameter }) =>
            [
                { value: 'not-a-uuid', id: 'not-a-uuid' },
                { value: '12345', id: '12345' },
                { value: 'Person/not-a-uuid', id: 'not-a-uuid' },
                { value: 'Patient/12345', id: '12345' },
                { value: 'abc|client', id: 'abc|client' },
                { value: 'Person/abc|client', id: 'abc|client' },
                { value: `${PERSON_UUID}|client`, id: `${PERSON_UUID}|client` },
                { value: `client|${PERSON_UUID}`, id: `client|${PERSON_UUID}` },
                { value: `${PERSON_UUID}0`, id: `${PERSON_UUID}0` },
                { value: 'id with:colon and $dollar', id: 'id with:colon and $dollar' },
                { value: 'x'.repeat(255), id: 'x'.repeat(255) }
            ].map((row) => ({ operation, parameter, ...row }))
        ))(
            '$operation accepts $value as $parameter and keeps it as the literal id $id',
            async ({ operation, parameter, value, id }) => {
                const body = { ...GOOD_BODIES[operation], [parameter]: value };

                const { item } = await readItemOf(responder, operation, body);

                const { target, linkTarget } = item.adminChange;
                const definition = ADMIN_OPERATIONS[operation];
                const read = definition.target.idParameter === parameter ? target : linkTarget;
                expect(read.id).toBe(id);
            }
        );

        test.each([
            { parameter: 'resourceId', value: `Encounter/${ENCOUNTER_UUID}`, id: ENCOUNTER_UUID },
            { parameter: 'resourceId', value: 'Observation/encounter-one', id: 'encounter-one' },
            { parameter: 'resourceId', value: `Person/${ENCOUNTER_UUID}`, id: ENCOUNTER_UUID },
            { parameter: 'patientId', value: `Encounter/${PATIENT_UUID}`, id: `Encounter/${PATIENT_UUID}` }
        ])(
            'updatePatientReference strips any resource type from resourceId but only Person/ or Patient/ from patientId ($parameter $value)',
            async ({ parameter, value, id }) => {
                const body = { ...GOOD_BODIES.updatePatientReference, [parameter]: value };

                const { item } = await readItemOf(responder, 'updatePatientReference', body);

                const { target, linkTarget } = item.adminChange;
                expect((parameter === 'resourceId' ? target : linkTarget).id).toBe(id);
            }
        );

        test.each(ID_PARAMETERS.flatMap(({ operation, parameter }) =>
            [
                { name: 'a comma', value: `${PERSON_UUID},${OTHER_PERSON_UUID}`, reason: CHARACTER_REASON },
                { name: 'a comma in a plain id', value: 'person-one,person-two', reason: CHARACTER_REASON },
                { name: 'a backslash', value: 'person\\,one', reason: CHARACTER_REASON },
                { name: 'a newline', value: 'person\none', reason: CHARACTER_REASON },
                { name: 'a NUL', value: 'person\u0000one', reason: CHARACTER_REASON },
                { name: 'a DEL', value: 'person\u007fone', reason: CHARACTER_REASON },
                { name: '256 characters', value: 'x'.repeat(256), reason: 'must be at most 255 characters' },
                { name: 'two pipes', value: 'person|client|other', reason: PIPE_REASON },
                { name: 'nothing before the pipe', value: '|client', reason: PIPE_REASON },
                { name: 'nothing after the pipe', value: 'person|', reason: PIPE_REASON },
                { name: 'only a prefix', value: 'Person/', reason: 'must not be empty' }
            ].map((row) => ({ operation, parameter, ...row }))
        ))(
            '$operation fails a 400 invalid, without the value, when $parameter has $name',
            async ({ operation, parameter, value, reason }) => {
                const body = { ...GOOD_BODIES[operation], [parameter]: value };

                const error = await readErrorOf(responder, requestInfoFor({ operation, body }));

                expect(error.statusCode).toBe(400);
                expect(error.issue[0].code).toBe('invalid');
                expect(error.message).toBe(`Invalid ${parameter}: ${reason}`);
                expect(error.issue[0].details.text).toBe(`Invalid ${parameter}: ${reason}`);
            }
        );

        test.each(ID_PARAMETERS.flatMap(({ operation, parameter }) =>
            [42, true, { id: PERSON_UUID }, [PERSON_UUID]].map((value) => ({
                operation,
                parameter,
                value
            }))
        ))(
            '$operation fails a 400 invalid when $parameter is not a string',
            async ({ operation, parameter, value }) => {
                const body = { ...GOOD_BODIES[operation], [parameter]: value };

                const error = await readErrorOf(responder, requestInfoFor({ operation, body }));

                expect(error.statusCode).toBe(400);
                expect(error.issue[0].code).toBe('invalid');
                expect(error.message).toBe(`Invalid ${parameter}: must be a string`);
            }
        );

        test.each(['NotAResourceType', 'person', 'Encounter ', 'Patient/Encounter', 42, true])(
            'updatePatientReference fails a 400 invalid for the unsupported resource type %s',
            async (resourceType) => {
                const body = { ...GOOD_BODIES.updatePatientReference, resourceType };

                const error = await readErrorOf(
                    responder,
                    requestInfoFor({ operation: 'updatePatientReference', body })
                );

                expect(error.statusCode).toBe(400);
                expect(error.issue[0].code).toBe('invalid');
                expect(error.message).toBe(`ResourceType ${resourceType} not supported`);
            }
        );

        test.each(['Encounter', 'Observation', 'Person', 'Patient', 'Binary'])(
            'updatePatientReference accepts the supported resource type %s',
            async (resourceType) => {
                const body = { ...GOOD_BODIES.updatePatientReference, resourceType };

                const { item } = await readItemOf(responder, 'updatePatientReference', body);

                expect(item.adminChange.target).toEqual({ resourceType, id: ENCOUNTER_UUID });
                expect(item.incoming.resourceType).toBe(resourceType);
            }
        );

        test.each([
            { name: 'an unknown operation', requestInfo: { body: { operation: 'deletePerson' } } },
            { name: 'no operation', requestInfo: { body: GOOD_BODIES.createPersonToPersonLink } },
            { name: 'no body', requestInfo: {} },
            { name: 'a null body', requestInfo: { body: null } }
        ])('fails fast with an UnknownAdminOperationError for $name', async ({ requestInfo }) => {
            const error = await readErrorOf(responder, requestInfo);

            expect(error).toBeInstanceOf(UnknownAdminOperationError);
        });
    });

    describe('failureResults', () => {
        test.each(OPERATION_NAMES)('%s returns no results when the item did not fail', async (operation) => {
            const { item } = await readItemOf(responder, operation);

            expect(responder.failureResults({ items: [item], requestErrors: [] })).toEqual([]);
            expect(httpContextSetSpy).not.toHaveBeenCalled();
        });

        test.each([
            {
                name: 'a lookup 404',
                stage: WRITE_FAILURE_STAGE.LOOKUP,
                error: new NotFoundError(new Error(`Resource not found: Person/${PERSON_UUID}`))
            },
            {
                name: 'a build 400',
                stage: WRITE_FAILURE_STAGE.BUILD,
                error: new BadRequestError(new Error('Encounter has no patient reference that can be rewritten'))
            },
            {
                name: 'a result validation that threw',
                stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
                error: new Error('validation threw')
            }
        ])('rethrows the item\'s own error for $name, unchanged', async ({ stage, error }) => {
            const { item } = await readItemOf(responder, 'createPersonToPersonLink');
            item.fail({ failure: new WriteFailure({ stage, subject: SUBJECT, error }) });

            let thrown;
            try {
                responder.failureResults({ items: [item], requestErrors: [] });
            } catch (e) {
                thrown = e;
            }

            expect(thrown).toBe(error);
        });

        test.each([WRITE_FAILURE_STAGE.WRITE, WRITE_FAILURE_STAGE.ATTACHMENTS])(
            'rethrows the original error a %s failure wrapped',
            async (stage) => {
                const original = new Error('store failed');
                const wrapped = new RethrownError({ message: 'Error updating', error: original });
                const { item } = await readItemOf(responder, 'removePersonToPatientLink');
                item.fail({
                    failure: new WriteFailure({ stage, subject: SUBJECT, error: wrapped })
                });

                let thrown;
                try {
                    responder.failureResults({ items: [item], requestErrors: [] });
                } catch (e) {
                    thrown = e;
                }

                expect(thrown).toBe(original);
            }
        );

        test.each([WRITE_FAILURE_STAGE.SCOPE, WRITE_FAILURE_STAGE.ACCESS])(
            'throws a ForbiddenError with the same message for a %s failure',
            async (stage) => {
                const message = 'user test-user has no access to resource Person';
                const operationOutcome = buildOperationOutcomeFromIssues(
                    new ForbiddenError(message).issue
                );
                const { item } = await readItemOf(responder, 'createPersonToPatientLink');
                item.fail({
                    failure: new WriteFailure({ stage, subject: SUBJECT, operationOutcome })
                });

                const outcome = outcomeOf(() =>
                    responder.failureResults({ items: [item], requestErrors: [] })
                );

                expect(outcome).toEqual(describeError(new ForbiddenError(message)));
            }
        );

        test('throws a NotValidatedError for a failed result validation, and stores no access log entry', async () => {
            const operationOutcome = buildOperationOutcome({
                severity: 'error',
                code: 'invalid',
                details: { text: 'Resource Person is invalid' }
            });
            const { item } = await readItemOf(responder, 'createPersonToPersonLink');
            item.fail({
                failure: new WriteFailure({
                    stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
                    subject: SUBJECT,
                    operationOutcome
                })
            });

            let thrown;
            try {
                responder.failureResults({ items: [item], requestErrors: [] });
            } catch (e) {
                thrown = e;
            }

            expect(describeError(thrown)).toEqual(
                describeError(new NotValidatedError(operationOutcome))
            );
            expect(httpContextSetSpy).not.toHaveBeenCalled();
        });
    });

    describe('results', () => {
        test('returns the stored document entry for an unchanged item, without a flush result', async () => {
            const { item } = await readItemOf(responder, 'createPersonToPersonLink');
            item.stored = {
                resourceType: 'Person',
                id: 'person-one',
                _uuid: PERSON_UUID,
                _sourceAssigningAuthority: 'client'
            };
            item.markUnchanged();

            const results = responder.results({ items: [item], requestErrors: [], executedResults: [] });

            expect(results).toEqual([
                {
                    created: false,
                    updated: false,
                    id: 'person-one',
                    uuid: PERSON_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Person'
                }
            ]);
        });

        test.each([
            { name: 'created', result: { created: true, updated: false } },
            { name: 'updated', result: { created: false, updated: true } }
        ])('returns the flush results when the first one was $name', async ({ result }) => {
            const { item } = await readItemOf(responder, 'removePersonToPersonLink');
            item.markQueued();
            const executedResults = [{ ...result, id: 'person-one', uuid: PERSON_UUID }];

            expect(
                responder.results({ items: [item], requestErrors: [], executedResults })
            ).toBe(executedResults);
        });

        test.each([{ executedResults: [] }, { executedResults: undefined }])(
            'throws a BadRequestError with No merge result when the flush returned $executedResults',
            async ({ executedResults }) => {
                const { item } = await readItemOf(responder, 'removePersonToPersonLink');
                item.markQueued();

                const outcome = outcomeOf(() =>
                    responder.results({ items: [item], requestErrors: [], executedResults })
                );

                expect(outcome).toEqual(describeError(new BadRequestError(new Error('No merge result'))));
            }
        );

        test('throws a BadRequestError with the issue as JSON when the write was refused', async () => {
            const issue = { severity: 'error', code: 'exception', details: { text: 'write failed' } };
            const { item } = await readItemOf(responder, 'createPersonToPatientLink');
            item.markQueued();
            item.writeMode = 'update';

            const outcome = outcomeOf(() =>
                responder.results({
                    items: [item],
                    requestErrors: [],
                    executedResults: [{ created: false, updated: false, issue }]
                })
            );

            expect(outcome).toEqual(
                describeError(new BadRequestError(new Error(JSON.stringify(issue))))
            );
        });

        test('returns the candidate entry for an update whose replay found nothing left to write', async () => {
            const { item } = await readItemOf(responder, 'createPersonToPersonLink');
            item.markQueued();
            item.writeMode = 'update';
            item.candidate = {
                resourceType: 'Person',
                id: 'person-one',
                _uuid: PERSON_UUID,
                _sourceAssigningAuthority: 'client'
            };

            const results = responder.results({
                items: [item],
                requestErrors: [],
                executedResults: [{ created: false, updated: false }]
            });

            expect(results).toEqual([
                {
                    created: false,
                    updated: false,
                    id: 'person-one',
                    uuid: PERSON_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Person'
                }
            ]);
        });

        test('throws a BadRequestError for an insert that was neither created nor updated', async () => {
            const { item } = await readItemOf(responder, 'createPersonToPatientLink');
            item.markQueued();
            item.writeMode = 'insert';

            const outcome = outcomeOf(() =>
                responder.results({
                    items: [item],
                    requestErrors: [],
                    executedResults: [{ created: false, updated: false }]
                })
            );

            expect(outcome.statusCode).toBe(400);
            expect(outcome.issue[0].code).toBe('invalid');
        });
    });

    describe('toResponse', () => {
        /**
         * Builds what `toResponse` gets for an operation: the item as the pipeline leaves it for a
         * no-op (unchanged, with its stored document), for a write of an existing document (queued,
         * with a candidate) and for a created Person (queued, no stored document, a new candidate).
         * The stored target has `targetUuid`, and the linked resource is loaded with `linkedUuid`
         * when the loader would load it (`whenTargetMissing`, for a created Person);
         * both default to the ids of `GOOD_BODIES`.
         */
        const buildResponseInput = async ({
            operation,
            body,
            outcome,
            targetUuid = GOOD_BODIES[operation][ADMIN_OPERATIONS[operation].target.idParameter],
            linkedUuid = GOOD_BODIES[operation][ADMIN_OPERATIONS[operation].linkTarget.idParameter]
        }) => {
            const { context, item } = await readItemOf(responder, operation, body);
            const stored = {
                resourceType: item.adminChange.target.resourceType,
                _uuid: targetUuid
            };
            const { linkTargetLookup } = item.adminChange;
            if (linkTargetLookup === 'whenTargetMissing' && outcome === 'created') {
                item.linked.push({
                    resourceType: item.adminChange.linkTarget.resourceType,
                    resource: { resourceType: item.adminChange.linkTarget.resourceType, _uuid: linkedUuid }
                });
            }
            let results;
            if (outcome === 'noOp') {
                item.stored = stored;
                item.markUnchanged();
                results = [{ created: false, updated: false, uuid: targetUuid }];
            } else if (outcome === 'created') {
                item.markQueued();
                item.writeMode = 'insert';
                item.candidate = { resourceType: 'Person', _uuid: NEW_PERSON_UUID };
                results = [{ created: true, updated: false, uuid: NEW_PERSON_UUID }];
            } else {
                item.stored = stored;
                item.markQueued();
                item.writeMode = 'update';
                item.candidate = { ...stored };
                results = [{ created: false, updated: true, uuid: targetUuid }];
            }
            return { context, items: [item], results };
        };

        test.each([
            {
                operation: 'createPersonToPersonLink',
                outcome: 'written',
                json: {
                    message: `Added link from Person/${PERSON_UUID} to Person/${OTHER_PERSON_UUID}`,
                    bwellPersonId: PERSON_UUID,
                    externalPersonId: OTHER_PERSON_UUID
                },
                linkEvent: null
            },
            {
                operation: 'createPersonToPersonLink',
                outcome: 'noOp',
                json: {
                    message: `Link already exists from ${PERSON_UUID} to ${OTHER_PERSON_UUID}`,
                    bwellPersonId: PERSON_UUID,
                    externalPersonId: OTHER_PERSON_UUID
                },
                linkEvent: null
            },
            {
                operation: 'removePersonToPersonLink',
                outcome: 'written',
                json: {
                    message: `Removed link from Person/${PERSON_UUID} to Person/${OTHER_PERSON_UUID}`,
                    bwellPersonId: PERSON_UUID,
                    externalPersonId: OTHER_PERSON_UUID
                },
                linkEvent: null
            },
            {
                operation: 'removePersonToPersonLink',
                outcome: 'noOp',
                json: {
                    message: `No Link exists from Person/${PERSON_UUID} to Person/${OTHER_PERSON_UUID}`,
                    bwellPersonId: PERSON_UUID,
                    externalPersonId: OTHER_PERSON_UUID
                },
                linkEvent: null
            },
            {
                operation: 'createPersonToPatientLink',
                outcome: 'created',
                json: {
                    message: `Created Person and added link from Person/${PERSON_UUID} to Patient/${PATIENT_UUID}`,
                    patientId: PATIENT_UUID,
                    externalPersonId: PERSON_UUID
                },
                linkEvent: { personId: NEW_PERSON_UUID, patientId: PATIENT_UUID, isLinking: true }
            },
            {
                operation: 'createPersonToPatientLink',
                outcome: 'written',
                json: {
                    message: `Added link from Person/${PERSON_UUID} to Patient/${PATIENT_UUID}`,
                    patientId: PATIENT_UUID,
                    externalPersonId: PERSON_UUID
                },
                linkEvent: { personId: PERSON_UUID, patientId: PATIENT_UUID, isLinking: true }
            },
            {
                operation: 'createPersonToPatientLink',
                outcome: 'noOp',
                json: {
                    message: `Link already exists from Person/${PERSON_UUID} to Patient/${PATIENT_UUID}`,
                    patientId: PATIENT_UUID,
                    externalPersonId: PERSON_UUID
                },
                linkEvent: null
            },
            {
                operation: 'removePersonToPatientLink',
                outcome: 'written',
                json: {
                    message: `Removed link from Person/${PERSON_UUID} to Patient/${PATIENT_UUID}`,
                    personId: PERSON_UUID,
                    patientId: PATIENT_UUID
                },
                linkEvent: { personId: PERSON_UUID, patientId: PATIENT_UUID, isLinking: false }
            },
            {
                operation: 'removePersonToPatientLink',
                outcome: 'noOp',
                json: {
                    message: `No Link exists from Person/${PERSON_UUID} to Patient/${PATIENT_UUID}`,
                    personId: PERSON_UUID,
                    patientId: PATIENT_UUID
                },
                linkEvent: null
            },
            {
                operation: 'updatePatientReference',
                outcome: 'written',
                json: {
                    message: `Patient reference updated for Encounter with id ${ENCOUNTER_UUID}`,
                    patientId: PATIENT_UUID
                },
                linkEvent: null
            },
            {
                operation: 'updatePatientReference',
                outcome: 'noOp',
                json: {
                    message: `Couldn't update Patient reference in Encounter with id ${ENCOUNTER_UUID}`,
                    patientId: PATIENT_UUID
                },
                linkEvent: null
            }
        ])('$operation ($outcome) answers with the old body and link event', async ({ operation, outcome, json, linkEvent }) => {
            const input = await buildResponseInput({ operation, outcome });

            const response = responder.toResponse({
                ...input,
                wasIncomingAList: false,
                resourceType: 'Person',
                startTime: 0,
                stopTime: 1
            });

            expect(response).toEqual({ json, linkEvent });
        });

        test.each(OPERATION_NAMES)(
            '%s echoes the ids it was sent without their Person/ prefix',
            async (operation) => {
                const bareBody = GOOD_BODIES[operation];
                const prefixedBody = Object.fromEntries(
                    Object.entries(bareBody).map(([name, value]) => [
                        name,
                        name === 'resourceType' ? value : `Person/${value}`
                    ])
                );
                const bare = await buildResponseInput({
                    operation,
                    body: bareBody,
                    outcome: 'written'
                });
                const prefixed = await buildResponseInput({
                    operation,
                    body: prefixedBody,
                    outcome: 'written'
                });

                expect(responder.toResponse(prefixed)).toEqual(responder.toResponse(bare));
            }
        );

        test.each([
            {
                name: 'createPersonToPatientLink with plain ids, for a stored Person',
                operation: 'createPersonToPatientLink',
                body: { externalPersonId: 'person-one', patientId: 'patient-one' },
                outcome: 'written',
                json: {
                    message: 'Added link from Person/person-one to Patient/patient-one',
                    patientId: 'patient-one',
                    externalPersonId: 'person-one'
                },
                linkEvent: { personId: PERSON_UUID, patientId: 'patient-one', isLinking: true }
            },
            {
                name: 'createPersonToPatientLink with plain ids, for a created Person',
                operation: 'createPersonToPatientLink',
                body: { externalPersonId: 'person-one', patientId: 'Patient/patient-one' },
                outcome: 'created',
                json: {
                    message: 'Created Person and added link from Person/person-one to Patient/patient-one',
                    patientId: 'patient-one',
                    externalPersonId: 'person-one'
                },
                linkEvent: { personId: NEW_PERSON_UUID, patientId: PATIENT_UUID, isLinking: true }
            },
            {
                name: 'removePersonToPatientLink with plain ids',
                operation: 'removePersonToPatientLink',
                body: { personId: 'Person/person-one', patientId: 'patient-one' },
                outcome: 'written',
                json: {
                    message: 'Removed link from Person/person-one to Patient/patient-one',
                    personId: 'person-one',
                    patientId: 'patient-one'
                },
                linkEvent: { personId: PERSON_UUID, patientId: 'patient-one', isLinking: false }
            }
        ])(
            '$name echoes the ids as sent and sends the Person _uuid and the old Patient id in the link event',
            async ({ operation, body, outcome, json, linkEvent }) => {
                const input = await buildResponseInput({
                    operation,
                    body,
                    outcome,
                    targetUuid: PERSON_UUID,
                    linkedUuid: PATIENT_UUID
                });

                const response = responder.toResponse(input);

                expect(response).toEqual({ json, linkEvent });
            }
        );

        test('answers with the success body and the link event when a replay found nothing left to write', async () => {
            const input = await buildResponseInput({
                operation: 'removePersonToPatientLink',
                outcome: 'written'
            });
            input.results = [{ created: false, updated: false, uuid: PERSON_UUID }];

            const response = responder.toResponse(input);

            expect(response.json.message).toBe(
                `Removed link from Person/${PERSON_UUID} to Patient/${PATIENT_UUID}`
            );
            expect(response.linkEvent).toEqual({
                personId: PERSON_UUID,
                patientId: PATIENT_UUID,
                isLinking: false
            });
        });

        test('throws an UnknownAdminOperationError when the request names no admin operation', async () => {
            const input = await buildResponseInput({
                operation: 'removePersonToPersonLink',
                outcome: 'written'
            });
            const context = new WriteContext({
                requestInfo: { body: { operation: 'deletePerson' } },
                base_version: '4_0_0',
                parsedArgs: parsedArgsFor(),
                smartMerge: false
            });

            expect(() => responder.toResponse({ ...input, context })).toThrow(UnknownAdminOperationError);
        });

        test('leaves the item\'s status and documents as they were', async () => {
            const input = await buildResponseInput({
                operation: 'createPersonToPatientLink',
                outcome: 'created'
            });
            const [item] = input.items;
            const candidate = item.candidate;

            responder.toResponse(input);

            expect(item.status).toBe(WRITE_ITEM_STATUS.QUEUED);
            expect(item.candidate).toBe(candidate);
            expect(item.stored).toBeNull();
        });
    });

    describe('recordMetrics', () => {
        test('records nothing', () => {
            expect(responder.recordMetrics({ results: [], requestInfo: {}, parsedArgs: {} })).toBeUndefined();
        });
    });
});
