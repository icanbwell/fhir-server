const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const httpContext = require('express-http-context');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../../../../constants');
const { CreateResponder } = require('../../../../../operations/writePipeline/responder/create');
const { Base64DataManager } = require('../../../../../dataLayer/base64DataManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../../../enrich/providers/identifierEnrichmentProvider');
const {
    WriteFailure,
    WRITE_FAILURE_STAGE
} = require('../../../../../operations/writePipeline/writeFailure');
const {
    WriteItem,
    WRITE_ITEM_STATUS
} = require('../../../../../operations/writePipeline/writeItem');
const { isUuid } = require('../../../../../utils/uid.util');
const {
    BadRequestError,
    ForbiddenError,
    NotValidatedError,
    PayloadTooLargeError
} = require('../../../../../utils/httpErrors');
const { RethrownError } = require('../../../../../utils/rethrownError');
const {
    buildOperationOutcome,
    buildOperationOutcomeFromIssues
} = require('../../../../../utils/operationOutcomeBuilder');

/**
 * The synthetic id of the resource every failure in these tests is about.
 */
const RESOURCE_ID = '00000000-0000-4000-8000-000000000001';

/**
 * The subject of every failure in these tests. Its `uuid` is the generated id, as create sets it.
 */
const SUBJECT = Object.freeze({
    id: RESOURCE_ID,
    uuid: RESOURCE_ID,
    sourceAssigningAuthority: 'client',
    resourceType: 'Patient'
});

/**
 * The error a scope or access check raises, and the OperationOutcome the pipeline keeps for it.
 */
const FORBIDDEN_MESSAGE = 'user test-user has no access to resource Patient';
const FORBIDDEN_OUTCOME = buildOperationOutcomeFromIssues(
    new ForbiddenError(FORBIDDEN_MESSAGE).issue
);

/**
 * The OperationOutcome of a failed validation check.
 */
const INVALID_OUTCOME = buildOperationOutcome({
    severity: 'error',
    code: 'invalid',
    details: { text: 'Resource Patient is invalid' }
});

/**
 * The OperationOutcome of a failed size check.
 */
const TOO_LONG_OUTCOME = buildOperationOutcome({
    severity: 'error',
    code: 'too-long',
    details: { text: 'Payload size too large.' }
});

/**
 * The error a step threw, and the same error as the step wraps it.
 */
const ORIGINAL_ERROR = new Error('store failed');
const WRAPPED_ERROR = new RethrownError({
    message: 'Error inserting: resource_uuid=x',
    error: ORIGINAL_ERROR
});

/**
 * The issue of a flush result for a resource that was not written.
 */
const WRITE_ISSUE = Object.freeze({
    severity: 'error',
    code: 'exception',
    details: { text: 'write failed' }
});

/**
 * Builds the single item of a create request, not yet failed.
 */
const buildItem = () => new WriteItem({
    index: 0,
    incoming: { resourceType: 'Patient', id: RESOURCE_ID }
});

/**
 * Builds the single item of a create request that failed with the given stage and outcome or error.
 */
const buildFailedItem = ({ stage, operationOutcome = null, error = null }) => {
    const item = buildItem();
    item.fail({ failure: new WriteFailure({ stage, subject: SUBJECT, operationOutcome, error }) });
    return item;
};

/**
 * Describes an error by its class, message and issues, so two errors can be compared.
 */
const describeError = (error) => ({
    thrown: error.constructor,
    message: error.message,
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
 * Returns the access-log entry the old create path stores for a rejected resource.
 */
const accessLogEntryFor = (operationOutcome) => ({
    operationResult: [{
        id: RESOURCE_ID,
        uuid: RESOURCE_ID,
        sourceAssigningAuthority: 'client',
        resourceType: 'Patient',
        operationOutcome,
        created: false,
        updated: false
    }]
});

/**
 * A `CreateResponder` built on bare collaborator objects, enough for the methods under test.
 */
const responder = new CreateResponder({
    base64DataManager: Object.create(Base64DataManager.prototype),
    identifierEnrichmentProvider: Object.create(IdentifierEnrichmentProvider.prototype)
});

describe('CreateResponder', () => {
    let httpContextSetSpy;

    beforeEach(() => {
        httpContextSetSpy = jest.spyOn(httpContext, 'set').mockImplementation(() => undefined);
    });

    afterEach(() => {
        httpContextSetSpy.mockRestore();
    });

    test.each([
        { name: 'no body', body: undefined },
        { name: 'a null body', body: null },
        { name: 'a text body', body: 'not a resource' }
    ])('readAsync throws a BadRequestError for $name', async ({ body }) => {
        const error = await responder.readAsync({
            requestInfo: { body },
            parsedArgs: {},
            resourceType: 'Patient'
        }).catch((thrown) => thrown);

        expect(describeError(error)).toStrictEqual(
            describeError(new BadRequestError(new Error('Request body is required.')))
        );
    });

    test.each([
        {
            name: 'removes the client meta.lastUpdated',
            body: {
                resourceType: 'Patient',
                meta: { source: 'http://example.com/source', lastUpdated: '2024-01-01' }
            },
            expectedIncoming: {
                resourceType: 'Patient',
                meta: { source: 'http://example.com/source' }
            }
        },
        {
            name: 'reads a body with no meta',
            body: { resourceType: 'Patient' },
            expectedIncoming: { resourceType: 'Patient' }
        }
    ])('readAsync $name', async ({ body, expectedIncoming }) => {
        const { items } = await responder.readAsync({
            requestInfo: { body, path: '/4_0_0/Patient/' },
            parsedArgs: { base_version: '4_0_0' },
            resourceType: 'Patient'
        });

        expect(items).toHaveLength(1);
        const [{ incoming, status }] = items;
        expect(status).toBe(WRITE_ITEM_STATUS.ACTIVE);
        const { id, ...incomingWithoutId } = incoming;
        expect(isUuid(id)).toBe(true);
        expect(incomingWithoutId).toStrictEqual(expectedIncoming);
    });

    test('readAsync fails a body of another resource type with the new id as the subject uuid', async () => {
        const { items } = await responder.readAsync({
            requestInfo: { body: { resourceType: 'Observation' }, path: '/4_0_0/Patient/' },
            parsedArgs: { base_version: '4_0_0' },
            resourceType: 'Patient'
        });

        const [{ incoming, status, failure }] = items;
        expect(status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect(failure.stage).toBe(WRITE_FAILURE_STAGE.STRUCTURE);
        expect(isUuid(incoming.id)).toBe(true);
        expect(failure.subject.uuid).toBe(incoming.id);
    });

    test('failureResults logs the uuid saved on the item when the failure subject has none', () => {
        const item = buildItem();
        item.savedIdentity = { uuid: RESOURCE_ID, sourceAssigningAuthority: undefined };
        item.fail({
            failure: new WriteFailure({
                stage: WRITE_FAILURE_STAGE.SIZE,
                subject: { ...SUBJECT, uuid: undefined },
                operationOutcome: TOO_LONG_OUTCOME
            })
        });

        expect(() => responder.failureResults({ items: [item], requestErrors: [] })).toThrow(
            'Payload size too large.'
        );
        expect(httpContextSetSpy).toHaveBeenCalledWith(
            ACCESS_LOGS_ENTRY_DATA,
            accessLogEntryFor(TOO_LONG_OUTCOME)
        );
    });

    test('failureResults returns no results and stores no access log when nothing failed', () => {
        const item = buildItem();

        const results = responder.failureResults({ items: [item], requestErrors: [] });

        expect(results).toStrictEqual([]);
        expect(httpContextSetSpy).not.toHaveBeenCalled();
    });

    test.each([
        {
            stage: WRITE_FAILURE_STAGE.SCOPE,
            failure: { operationOutcome: FORBIDDEN_OUTCOME },
            expectedError: new ForbiddenError(FORBIDDEN_MESSAGE),
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.ACCESS,
            failure: { operationOutcome: FORBIDDEN_OUTCOME },
            expectedError: new ForbiddenError(FORBIDDEN_MESSAGE),
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.STRUCTURE,
            failure: { operationOutcome: INVALID_OUTCOME },
            expectedError: new NotValidatedError(INVALID_OUTCOME),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.INCOMING_META,
            failure: { operationOutcome: INVALID_OUTCOME },
            expectedError: new NotValidatedError(INVALID_OUTCOME),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
            failure: { operationOutcome: INVALID_OUTCOME },
            expectedError: new NotValidatedError(INVALID_OUTCOME),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
            failure: { error: ORIGINAL_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
            failure: { operationOutcome: INVALID_OUTCOME },
            expectedError: new NotValidatedError(INVALID_OUTCOME),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.SIZE,
            failure: { operationOutcome: TOO_LONG_OUTCOME },
            expectedError: new PayloadTooLargeError(new Error('Payload size too large.')),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.SIZE,
            failure: { error: ORIGINAL_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.ATTACHMENTS,
            failure: { error: WRAPPED_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.WRITE,
            failure: { error: WRAPPED_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.IDENTITY,
            failure: { error: ORIGINAL_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.BUILD,
            failure: { error: WRAPPED_ERROR },
            expectedError: WRAPPED_ERROR,
            accessLogged: false
        }
    ])('failureResults throws the old create error for a $stage failure', ({
        stage,
        failure,
        expectedError,
        accessLogged
    }) => {
        const item = buildFailedItem({ stage, ...failure });

        const outcome = outcomeOf(
            () => responder.failureResults({ items: [item], requestErrors: [] })
        );

        expect(outcome).toStrictEqual(describeError(expectedError));
        const expectedAccessLogCalls = accessLogged
            ? [[ACCESS_LOGS_ENTRY_DATA, accessLogEntryFor(failure.operationOutcome)]]
            : [];
        expect(httpContextSetSpy.mock.calls).toStrictEqual(expectedAccessLogCalls);
    });

    test.each([
        {
            name: 'throws when the flush returned no result',
            executedResults: [],
            expected: describeError(new BadRequestError(new Error('No merge result')))
        },
        {
            name: 'throws when the flush result is neither created nor updated',
            executedResults: [{ created: false, updated: false, issue: WRITE_ISSUE }],
            expected: describeError(new BadRequestError(new Error(JSON.stringify(WRITE_ISSUE))))
        },
        {
            name: 'returns the flush results when the resource was created',
            executedResults: [{ created: true, updated: false }],
            expected: { returned: [{ created: true, updated: false }] }
        }
    ])('results $name', ({ executedResults, expected }) => {
        const outcome = outcomeOf(
            () => responder.results({ items: [], requestErrors: [], executedResults })
        );

        expect(outcome).toStrictEqual(expected);
    });
});
