const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const httpContext = require('express-http-context');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../../../../../constants');
const { UpdateResponder } = require('../../../../../../operations/writePipeline/operations/update/responder');
const { Base64DataManager } = require('../../../../../../dataLayer/base64DataManager');
const { DatabaseAttachmentManager } = require('../../../../../../dataLayer/databaseAttachmentManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../../../../enrich/providers/identifierEnrichmentProvider');
const {
    GroupExtendedTagEnrichmentProvider
} = require('../../../../../../enrich/providers/groupExtendedTagEnrichmentProvider');
const {
    WriteFailure,
    WRITE_FAILURE_STAGE
} = require('../../../../../../operations/writePipeline/writeFailure');
const {
    WriteItem,
    WRITE_ITEM_STATUS
} = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const {
    BadRequestError,
    ForbiddenError,
    NotValidatedError,
    PayloadTooLargeError,
    PreconditionFailedError
} = require('../../../../../../utils/httpErrors');
const { RethrownError } = require('../../../../../../utils/rethrownError');
const {
    buildOperationOutcome,
    buildOperationOutcomeFromIssues
} = require('../../../../../../utils/operationOutcomeBuilder');

/**
 * The synthetic URL id of the resource every test in this file writes.
 */
const RESOURCE_ID = 'put-unit-patient';

/**
 * The synthetic uuid derived for that resource.
 */
const RESOURCE_UUID = '00000000-0000-4000-8000-000000000002';

/**
 * The subject of every failure in these tests: the identity derived before the failure, which the
 * access-log entry takes its uuid and source assigning authority from.
 */
const SUBJECT = Object.freeze({
    id: RESOURCE_ID,
    uuid: RESOURCE_UUID,
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
    message: 'Error updating: resource_uuid=x',
    error: ORIGINAL_ERROR
});

/**
 * The error the replace build returns for a failed precondition.
 */
const PRECONDITION_ERROR = new PreconditionFailedError('Version conflict: test');

/**
 * The issue of a flush result for a resource that was not written.
 */
const WRITE_ISSUE = Object.freeze({
    severity: 'error',
    code: 'exception',
    details: { text: 'write failed' }
});

/**
 * Returns a stored Patient document at the given version.
 */
const storedPatient = (versionId) => ({
    resourceType: 'Patient',
    id: RESOURCE_ID,
    _uuid: RESOURCE_UUID,
    _sourceAssigningAuthority: 'client',
    meta: {
        versionId,
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/access', code: 'client' }
        ]
    },
    name: [{ family: 'Unit', given: ['Alpha'] }]
});

/**
 * Builds the single item of an update request, not yet failed.
 */
const buildItem = () => new WriteItem({
    index: 0,
    incoming: { resourceType: 'Patient', id: RESOURCE_ID }
});

/**
 * Builds the single item of an update request that failed with the given stage and outcome or error.
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
 * Returns the access-log entry stored for a rejected resource: its uuid and source assigning
 * authority come from the failure's subject.
 */
const accessLogEntryFor = (operationOutcome) => ({
    operationResult: [{
        id: RESOURCE_ID,
        uuid: RESOURCE_UUID,
        sourceAssigningAuthority: 'client',
        resourceType: 'Patient',
        operationOutcome,
        created: false,
        updated: false
    }]
});

/**
 * Builds parsed args for a PUT to the given URL id.
 */
const parsedArgsFor = (urlId) => ({
    base_version: '4_0_0',
    id: urlId,
    getOriginal: () => undefined
});

/**
 * Builds an `UpdateResponder` whose storage and enrichment collaborators record their calls and
 * return what they were given.
 */
const buildResponder = () => {
    const base64DataManager = Object.create(Base64DataManager.prototype);
    base64DataManager.transformAsync = jest.fn(async (doc) => doc);
    const databaseAttachmentManager = Object.create(DatabaseAttachmentManager.prototype);
    databaseAttachmentManager.transformAttachments = jest.fn(async (doc) => doc);
    const identifierEnrichmentProvider = Object.create(IdentifierEnrichmentProvider.prototype);
    identifierEnrichmentProvider.enrichIdentifierList = jest.fn();
    const groupExtendedTagEnrichmentProvider = Object.create(
        GroupExtendedTagEnrichmentProvider.prototype
    );
    groupExtendedTagEnrichmentProvider.enrichAsync = jest.fn(async ({ resources }) => resources);
    return new UpdateResponder({
        base64DataManager,
        databaseAttachmentManager,
        identifierEnrichmentProvider,
        groupExtendedTagEnrichmentProvider
    });
};

describe('UpdateResponder', () => {
    let httpContextSetSpy;
    let responder;

    beforeEach(() => {
        httpContextSetSpy = jest.spyOn(httpContext, 'set').mockImplementation(() => undefined);
        responder = buildResponder();
    });

    afterEach(() => {
        httpContextSetSpy.mockRestore();
    });

    test.each([
        {
            name: 'no body',
            body: undefined,
            expectedError: new BadRequestError(new Error('Request body is required.'))
        },
        {
            name: 'a text body',
            body: 'not a resource',
            expectedError: new BadRequestError(new Error('Request body is required.'))
        },
        {
            name: 'a list body',
            body: [{ resourceType: 'Patient' }],
            expectedError: new BadRequestError(
                new Error('Only single resource can be sent to update.')
            )
        }
    ])('readAsync throws a BadRequestError for $name', async ({ body, expectedError }) => {
        const error = await responder.readAsync({
            requestInfo: { body, path: '/4_0_0/Patient/put-unit-patient' },
            parsedArgs: parsedArgsFor(RESOURCE_ID),
            resourceType: 'Patient'
        }).catch((thrown) => thrown);

        expect(describeError(error)).toStrictEqual(describeError(expectedError));
    });

    test('readAsync reads one update item with the URL id, no `_` fields and no client lastUpdated', async () => {
        const body = {
            resourceType: 'Patient',
            id: 'put-unit-other-id',
            _uuid: '00000000-0000-4000-8000-000000000009',
            meta: { source: 'http://example.com/source', lastUpdated: '2026-01-01' }
        };

        const { context, items, requestErrors, wasIncomingAList } = await responder.readAsync({
            requestInfo: { body, path: '/4_0_0/Patient/put-unit-patient|client' },
            parsedArgs: parsedArgsFor(`${RESOURCE_ID}|client`),
            resourceType: 'Patient'
        });

        expect(context).toBeInstanceOf(WriteContext);
        expect(context.smartMerge).toBe(false);
        expect(items.map(({ incoming, status }) => ({ incoming, status }))).toStrictEqual([{
            incoming: {
                resourceType: 'Patient',
                id: RESOURCE_ID,
                meta: { source: 'http://example.com/source' }
            },
            status: WRITE_ITEM_STATUS.ACTIVE
        }]);
        expect({ requestErrors, wasIncomingAList }).toStrictEqual({
            requestErrors: [],
            wasIncomingAList: false
        });
    });

    test('readAsync fails the item at STRUCTURE, under the URL id, when the body type is not the URL type', async () => {
        const { items } = await responder.readAsync({
            requestInfo: {
                body: { resourceType: 'Observation', id: 'put-unit-other-id' },
                path: '/4_0_0/Patient/put-unit-patient'
            },
            parsedArgs: parsedArgsFor(RESOURCE_ID),
            resourceType: 'Patient'
        });

        const [{ status, failure }] = items;
        expect(status).toBe(WRITE_ITEM_STATUS.FAILED);
        expect({ stage: failure.stage, id: failure.subject.id }).toStrictEqual({
            stage: WRITE_FAILURE_STAGE.STRUCTURE,
            id: RESOURCE_ID
        });
        expect(failure.operationOutcome.issue[0].code).toBe('invalid');
    });

    test('failureResults returns no results and stores no access log when nothing failed', () => {
        const results = responder.failureResults({ items: [buildItem()], requestErrors: [] });

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
            stage: WRITE_FAILURE_STAGE.IDENTITY,
            failure: { operationOutcome: INVALID_OUTCOME },
            expectedError: new NotValidatedError(INVALID_OUTCOME),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.IDENTITY,
            failure: { error: ORIGINAL_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.STRUCTURE,
            failure: { operationOutcome: INVALID_OUTCOME },
            expectedError: new NotValidatedError(INVALID_OUTCOME),
            accessLogged: true
        },
        {
            stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
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
            stage: WRITE_FAILURE_STAGE.BUILD,
            failure: { error: PRECONDITION_ERROR },
            expectedError: PRECONDITION_ERROR,
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
            stage: WRITE_FAILURE_STAGE.WRITE,
            failure: { error: ORIGINAL_ERROR },
            expectedError: ORIGINAL_ERROR,
            accessLogged: false
        }
    ])('failureResults throws the old update error for a $stage failure', ({
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
            writeMode: 'update',
            executedResults: [],
            expected: describeError(new BadRequestError(new Error('No merge result')))
        },
        {
            name: 'throws when the flush result is neither created nor updated and has an issue',
            writeMode: 'update',
            executedResults: [{ created: false, updated: false, issue: WRITE_ISSUE }],
            expected: describeError(new BadRequestError(new Error(JSON.stringify(WRITE_ISSUE))))
        },
        {
            name: 'returns the flush results when the resource was updated',
            writeMode: 'update',
            executedResults: [{ created: false, updated: true }],
            expected: { returned: [{ created: false, updated: true }] }
        },
        {
            name: 'returns the candidate entry for an update whose replay found nothing to write',
            writeMode: 'update',
            executedResults: [{ created: false, updated: false }],
            expected: {
                returned: [{
                    created: false,
                    updated: false,
                    id: RESOURCE_ID,
                    uuid: RESOURCE_UUID,
                    sourceAssigningAuthority: 'client',
                    resourceType: 'Patient'
                }]
            }
        },
        {
            name: 'throws for a create whose flush result is neither created nor updated and has no issue',
            writeMode: 'insert',
            executedResults: [{ created: false, updated: false }],
            expected: describeError(new BadRequestError(new Error(JSON.stringify(undefined))))
        }
    ])('results $name for a queued item', ({ writeMode, executedResults, expected }) => {
        const item = buildItem();
        item.writeMode = writeMode;
        item.stored = writeMode === 'update' ? storedPatient('1') : null;
        item.candidate = storedPatient(writeMode === 'update' ? '2' : '1');
        item.markQueued();

        const outcome = outcomeOf(
            () => responder.results({ items: [item], requestErrors: [], executedResults })
        );

        expect(outcome).toStrictEqual(expected);
    });

    test('results returns the stored document entry for an unchanged item, without a flush result', () => {
        const item = buildItem();
        item.stored = storedPatient('1');
        item.markUnchanged();

        const results = responder.results({ items: [item], requestErrors: [], executedResults: [] });

        expect(results).toStrictEqual([{
            created: false,
            updated: false,
            id: RESOURCE_ID,
            uuid: RESOURCE_UUID,
            sourceAssigningAuthority: 'client',
            resourceType: 'Patient'
        }]);
    });

    test.each([
        {
            name: 'the written document and the flush result\'s created flag for a write',
            buildRun: () => {
                const item = buildItem();
                item.stored = storedPatient('1');
                item.candidate = storedPatient('2');
                item.markQueued();
                return { item, results: [{ created: false, updated: true }] };
            },
            expected: { created: false, resource_version: '2' }
        },
        {
            name: 'the stored document, not created, for a no-op',
            buildRun: () => {
                const item = buildItem();
                item.stored = storedPatient('1');
                item.markUnchanged();
                return { item, results: [{ created: false, updated: false }] };
            },
            expected: { created: false, resource_version: '1' }
        },
        {
            name: 'the candidate, not created, for an update whose replay found nothing to write',
            buildRun: () => {
                const item = buildItem();
                item.writeMode = 'update';
                item.stored = storedPatient('1');
                item.candidate = storedPatient('2');
                item.markQueued();
                return { item, results: [{ created: false, updated: false }] };
            },
            expected: { created: false, resource_version: '2' }
        }
    ])('toResponse returns $name', async ({ buildRun, expected }) => {
        const { item, results } = buildRun();
        const context = new WriteContext({
            requestInfo: { headers: {} },
            base_version: '4_0_0',
            parsedArgs: parsedArgsFor(`${RESOURCE_ID}|client`),
            smartMerge: false
        });

        const response = await responder.toResponse({ context, items: [item], results });

        expect(Object.keys(response)).toStrictEqual(['id', 'created', 'resource_version', 'resource']);
        expect({
            id: response.id,
            created: response.created,
            resource_version: response.resource_version,
            resource: {
                resourceType: response.resource.resourceType,
                id: response.resource.id,
                versionId: response.resource.meta.versionId,
                name: response.resource.name
            }
        }).toStrictEqual({
            id: `${RESOURCE_ID}|client`,
            ...expected,
            resource: {
                resourceType: 'Patient',
                id: RESOURCE_ID,
                versionId: expected.resource_version,
                name: [{ family: 'Unit', given: ['Alpha'] }]
            }
        });
        expect(response.resource._uuid).toBeUndefined();
    });
});
