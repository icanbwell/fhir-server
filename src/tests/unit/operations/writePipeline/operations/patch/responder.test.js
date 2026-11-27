const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const httpContext = require('express-http-context');
const { ACCESS_LOGS_ENTRY_DATA, GRIDFS, BLOB_OP } = require('../../../../../../constants');
const { PatchResponder } = require('../../../../../../operations/writePipeline/operations/patch/responder');
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
const { fhirContentTypes } = require('../../../../../../utils/contentTypes');
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

/**
 * The synthetic id and uuid of the resource every test in this file patches.
 */
const RESOURCE_ID = 'patch-unit-patient';
const RESOURCE_UUID = '00000000-0000-4000-8000-000000000003';

/**
 * The subject of every failure in these tests: the identity of the stored document.
 */
const SUBJECT = Object.freeze({
    id: RESOURCE_ID,
    uuid: RESOURCE_UUID,
    sourceAssigningAuthority: 'client',
    resourceType: 'Patient'
});

/**
 * The message of the error a scope or access check raises, and the OperationOutcome the pipeline
 * keeps for it.
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
 * The error a step threw, and the same error as the step wraps it.
 */
const ORIGINAL_ERROR = new Error('store failed');
const WRAPPED_ERROR = new RethrownError({
    message: 'Error updating: resource_uuid=x',
    error: ORIGINAL_ERROR
});

/**
 * The errors the lookup records: no document found, and several found.
 */
const NOT_FOUND_ERROR = new NotFoundError(new Error(`Resource not found: Patient/${RESOURCE_ID}`));
const MULTIPLE_FOUND_ERROR = new BadRequestError(
    new Error(`Multiple resources found with id ${RESOURCE_ID}.`)
);

/**
 * The error the build records for a patch that cannot be applied.
 */
const PATCH_ERROR = new BadRequestError(new Error('OPERATION_PATH_UNRESOLVABLE'));

/**
 * The issue of a flush result for a resource that was not written.
 */
const WRITE_ISSUE = Object.freeze({
    severity: 'error',
    code: 'exception',
    details: { text: 'write failed' }
});

/**
 * A synthetic JSON Patch that changes one field.
 */
const PATCH_BODY = Object.freeze([{ op: 'replace', path: '/gender', value: 'female' }]);

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
 * Builds the single item of a patch request, not yet failed.
 */
const buildItem = () => new WriteItem({
    index: 0,
    incoming: { resourceType: 'Patient', id: RESOURCE_ID }
});

/**
 * Builds the single item of a patch request that failed with the given stage and outcome or error.
 */
const buildFailedItem = ({ stage, operationOutcome = null, error = null }) => {
    const item = buildItem();
    item.fail({ failure: new WriteFailure({ stage, subject: SUBJECT, operationOutcome, error }) });
    return item;
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
 * Returns the access-log entry stored for a rejected resource.
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
 * Builds parsed args for a PATCH to the given URL id.
 */
const parsedArgsFor = (urlId) => ({
    base_version: '4_0_0',
    id: urlId,
    getOriginal: () => undefined
});

/**
 * Builds a request info with the given body and a JSON Patch content type.
 */
const requestInfoFor = (body) => ({
    body,
    contentTypeFromHeader: { type: fhirContentTypes.jsonPatch },
    path: `/4_0_0/Patient/${RESOURCE_ID}`,
    headers: {}
});

/**
 * Builds the collaborators of a `PatchResponder`: the storage and enrichment boundaries record
 * their calls and return what they were given.
 */
const buildCollaborators = () => {
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
    return {
        base64DataManager,
        databaseAttachmentManager,
        identifierEnrichmentProvider,
        groupExtendedTagEnrichmentProvider
    };
};

describe('PatchResponder', () => {
    let httpContextSetSpy;
    let collaborators;
    let responder;

    beforeEach(() => {
        httpContextSetSpy = jest.spyOn(httpContext, 'set').mockImplementation(() => undefined);
        collaborators = buildCollaborators();
        responder = new PatchResponder(collaborators);
    });

    afterEach(() => {
        httpContextSetSpy.mockRestore();
    });

    test.each([
        'base64DataManager',
        'databaseAttachmentManager',
        'identifierEnrichmentProvider',
        'groupExtendedTagEnrichmentProvider'
    ])('the constructor throws when %s is not the expected type', (name) => {
        expect(() => new PatchResponder({ ...collaborators, [name]: {} })).toThrow();
    });

    test.each([
        {
            name: 'no content type',
            contentTypeFromHeader: undefined,
            message: 'Content-Type  is not supported for patch. Only application/json-patch+json is supported.'
        },
        {
            name: 'application/json',
            contentTypeFromHeader: { type: 'application/json' },
            message: 'Content-Type application/json is not supported for patch. Only application/json-patch+json is supported.'
        },
        {
            name: 'application/fhir+json',
            contentTypeFromHeader: { type: 'application/fhir+json' },
            message: 'Content-Type application/fhir+json is not supported for patch. Only application/json-patch+json is supported.'
        }
    ])('readAsync rejects $name with a 400 and the old message', async ({ contentTypeFromHeader, message }) => {
        const error = await responder.readAsync({
            requestInfo: { body: PATCH_BODY, contentTypeFromHeader },
            parsedArgs: parsedArgsFor(RESOURCE_ID),
            resourceType: 'Patient'
        }).catch((thrown) => thrown);

        expect({ statusCode: error.statusCode, message: error.message })
            .toStrictEqual({ statusCode: 400, message });
    });

    test.each([
        {
            name: 'a patch on /_uuid',
            body: [{ op: 'replace', path: '/_uuid', value: 'x' }],
            internalField: '_uuid'
        },
        {
            name: 'a patch on /meta/_x',
            body: [{ op: 'remove', path: '/meta/_x' }],
            internalField: '_x'
        },
        {
            name: 'a patch with _uuid inside a value',
            body: [{ op: 'add', path: '/link/-', value: { other: { reference: 'Patient/1', _uuid: 'x' } } }],
            internalField: '_uuid'
        }
    ])('readAsync rejects $name with a 400', async ({ body, internalField }) => {
        const error = await responder.readAsync({
            requestInfo: requestInfoFor(body),
            parsedArgs: parsedArgsFor(RESOURCE_ID),
            resourceType: 'Patient'
        }).catch((thrown) => thrown);

        expect(error.statusCode).toBe(400);
        expect(error.message).toContain(`internal field '${internalField}'`);
    });

    test('readAsync checks the content type before the patch content', async () => {
        const error = await responder.readAsync({
            requestInfo: {
                body: [{ op: 'replace', path: '/_uuid', value: 'x' }],
                contentTypeFromHeader: { type: 'application/json' }
            },
            parsedArgs: parsedArgsFor(RESOURCE_ID),
            resourceType: 'Patient'
        }).catch((thrown) => thrown);

        expect(error.message).toMatch(/^Content-Type application\/json is not supported for patch/);
    });

    test.each([
        { name: 'a plain id', urlId: RESOURCE_ID },
        { name: 'an id with a source assigning authority', urlId: `${RESOURCE_ID}|client` },
        { name: 'a uuid', urlId: RESOURCE_UUID }
    ])('readAsync reads one stub item with the URL id and the patch for $name', async ({ urlId }) => {
        const parsedArgs = parsedArgsFor(urlId);
        const requestInfo = requestInfoFor(PATCH_BODY);

        const { context, items, requestErrors, wasIncomingAList } = await responder.readAsync({
            requestInfo,
            parsedArgs,
            resourceType: 'Patient'
        });

        expect(context).toBeInstanceOf(WriteContext);
        expect({
            requestInfo: context.requestInfo,
            base_version: context.base_version,
            parsedArgs: context.parsedArgs,
            smartMerge: context.smartMerge
        }).toStrictEqual({
            requestInfo,
            base_version: '4_0_0',
            parsedArgs,
            smartMerge: false
        });
        expect(items).toHaveLength(1);
        const [item] = items;
        expect(item).toBeInstanceOf(WriteItem);
        expect({
            index: item.index,
            incoming: item.incoming,
            patch: item.patch,
            status: item.status
        }).toStrictEqual({
            index: 0,
            incoming: { resourceType: 'Patient', id: urlId },
            patch: PATCH_BODY,
            status: WRITE_ITEM_STATUS.ACTIVE
        });
        expect({ requestErrors, wasIncomingAList }).toStrictEqual({
            requestErrors: [],
            wasIncomingAList: false
        });
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
            stage: WRITE_FAILURE_STAGE.LOOKUP,
            failure: { error: NOT_FOUND_ERROR },
            expectedError: NOT_FOUND_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.LOOKUP,
            failure: { error: MULTIPLE_FOUND_ERROR },
            expectedError: MULTIPLE_FOUND_ERROR,
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.ACCESS,
            failure: { operationOutcome: FORBIDDEN_OUTCOME },
            expectedError: new ForbiddenError(FORBIDDEN_MESSAGE),
            accessLogged: false
        },
        {
            stage: WRITE_FAILURE_STAGE.BUILD,
            failure: { error: PATCH_ERROR },
            expectedError: PATCH_ERROR,
            accessLogged: false
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
    ])('failureResults throws the old patch error for a $stage failure and access-logs only a failed result validation', ({
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
            name: 'throws a 400 when the flush returned no result',
            executedResults: [],
            expected: describeError(new BadRequestError(new Error('No merge result')))
        },
        {
            name: 'throws a 400 with the issue when the flush result is neither created nor updated',
            executedResults: [{ created: false, updated: false, issue: WRITE_ISSUE }],
            expected: describeError(new BadRequestError(new Error(JSON.stringify(WRITE_ISSUE))))
        },
        {
            name: 'throws a 400 even when that flush result has no issue',
            executedResults: [{ created: false, updated: false }],
            expected: describeError(new BadRequestError(new Error(JSON.stringify(undefined))))
        },
        {
            name: 'returns the flush results when the resource was updated',
            executedResults: [{ created: false, updated: true }],
            expected: { returned: [{ created: false, updated: true }] }
        }
    ])('results $name for a queued item', ({ executedResults, expected }) => {
        const item = buildItem();
        item.writeMode = 'update';
        item.stored = storedPatient('1');
        item.candidate = storedPatient('2');
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
            name: 'the written document, updated, for a write',
            buildRun: () => {
                const item = buildItem();
                item.stored = storedPatient('1');
                item.candidate = storedPatient('2');
                item.markQueued();
                return { item, results: [{ created: false, updated: true }] };
            },
            expected: { updated: true, resource_version: '2' }
        },
        {
            name: 'the stored document, not updated, for an unchanged item',
            buildRun: () => {
                const item = buildItem();
                item.stored = storedPatient('1');
                item.markUnchanged();
                return { item, results: [{ created: false, updated: false }] };
            },
            expected: { updated: false, resource_version: '1' }
        }
    ])('toResponse returns $name with the resource\'s own id', async ({ buildRun, expected }) => {
        const { item, results } = buildRun();
        const context = new WriteContext({
            requestInfo: { headers: {} },
            base_version: '4_0_0',
            parsedArgs: parsedArgsFor(`${RESOURCE_ID}|client`),
            smartMerge: false
        });

        const response = await responder.toResponse({ context, items: [item], results });

        expect(Object.keys(response)).toStrictEqual([
            'id',
            'created',
            'updated',
            'resource_version',
            'resource'
        ]);
        expect({
            id: response.id,
            created: response.created,
            updated: response.updated,
            resource_version: response.resource_version,
            resource: {
                resourceType: response.resource.resourceType,
                id: response.resource.id,
                versionId: response.resource.meta.versionId,
                name: response.resource.name
            }
        }).toStrictEqual({
            id: RESOURCE_ID,
            created: false,
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

    test('toResponse enriches and rehydrates a copy of the written document and leaves the candidate as it was', async () => {
        const requestInfo = { headers: {} };
        const item = buildItem();
        item.stored = storedPatient('1');
        item.candidate = storedPatient('2');
        item.markQueued();
        const candidateBefore = JSON.parse(JSON.stringify(item.candidate));
        collaborators.identifierEnrichmentProvider.enrichIdentifierList.mockImplementation((doc) => {
            doc.identifier = [{ system: 'urn:test', value: 'enriched' }];
        });
        const context = new WriteContext({
            requestInfo,
            base_version: '4_0_0',
            parsedArgs: parsedArgsFor(RESOURCE_ID),
            smartMerge: false
        });

        const response = await responder.toResponse({
            context,
            items: [item],
            results: [{ created: false, updated: true }]
        });

        expect(response.resource.identifier).toStrictEqual([{ system: 'urn:test', value: 'enriched' }]);
        expect(JSON.parse(JSON.stringify(item.candidate))).toStrictEqual(candidateBefore);
        const { transformAttachments } = collaborators.databaseAttachmentManager;
        expect(transformAttachments).toHaveBeenCalledTimes(1);
        expect(transformAttachments.mock.calls[0][1]).toBe(GRIDFS.RETRIEVE);
        const { transformAsync } = collaborators.base64DataManager;
        expect(transformAsync).toHaveBeenCalledTimes(1);
        expect(transformAsync.mock.calls[0].slice(1)).toStrictEqual([BLOB_OP.RETRIEVE, requestInfo]);
        expect(collaborators.groupExtendedTagEnrichmentProvider.enrichAsync).toHaveBeenCalledTimes(1);
    });

    test('recordMetrics records nothing', () => {
        expect(responder.recordMetrics({ results: [], requestInfo: {}, parsedArgs: {} })).toBeUndefined();
        expect(httpContextSetSpy).not.toHaveBeenCalled();
    });
});
