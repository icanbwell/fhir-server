const { describe, test, expect, jest } = require('@jest/globals');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { RethrownError } = require('../../../../utils/rethrownError');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { WriteAuditor } = require('../../../../operations/writePipeline/writeAuditor');
const { WriteContext } = require('../../../../operations/writePipeline/writeContext');

/**
 * The synthetic request every case audits.
 */
const REQUEST_INFO = Object.freeze({ requestId: 'request-1', originalUrl: '/4_0_0/Patient/$merge' });
/**
 * The raw args the request's parsed args return.
 */
const RAW_ARGS = Object.freeze({ smartMerge: 'false' });

/**
 * Builds a `merge` context for `REQUEST_INFO`, with parsed args whose raw args equal `RAW_ARGS`.
 */
const buildContext = () => new WriteContext({
    requestInfo: REQUEST_INFO,
    base_version: '4_0_0',
    parsedArgs: new ParsedArgs({
        base_version: '4_0_0',
        parsedArgItems: [
            new ParsedArgsItem({
                queryParameter: 'smartMerge',
                queryParameterValue: new QueryParameterValue({ value: 'false', operator: '$and' }),
                propertyObj: undefined,
                modifiers: []
            })
        ]
    }),
    smartMerge: false,
    operationName: 'merge'
});

/**
 * Builds a `WriteAuditor` on a fake audit logger whose log methods are mocks, and a fake
 * post-request processor that keeps each task it is given in `tasks` instead of running it.
 */
const buildAuditor = () => {
    const auditLogger = Object.create(AuditLogger.prototype);
    auditLogger.logAuditEntryAsync = jest.fn(async () => undefined);
    auditLogger.logErrorAuditEntryAsync = jest.fn(async () => undefined);
    const tasks = [];
    const postRequestProcessor = Object.create(PostRequestProcessor.prototype);
    postRequestProcessor.add = jest.fn(({ fnTask }) => {
        tasks.push(fnTask);
    });
    const auditor = new WriteAuditor({ auditLogger, postRequestProcessor });
    return { auditor, auditLogger, postRequestProcessor, tasks };
};

/**
 * Builds a synthetic result entry: `<resourceType>/<id>` with `_uuid` `uuid-<id>`, neither created
 * nor updated unless `fields` says so.
 */
const entry = ({ resourceType, id, ...fields }) => ({
    resourceType,
    id,
    _uuid: `uuid-${id}`,
    created: false,
    updated: false,
    ...fields
});

/**
 * Builds the arguments `logAuditEntryAsync` is expected to get for a success audit.
 */
const successAudit = ({ resourceType, operation, ids }) => ({
    requestInfo: REQUEST_INFO,
    base_version: '4_0_0',
    resourceType,
    operation,
    args: RAW_ARGS,
    ids
});

/**
 * Builds the arguments `logErrorAuditEntryAsync` is expected to get for an error audit.
 */
const errorAudit = ({ resourceType, id, errorCode }) => ({
    requestInfo: REQUEST_INFO,
    resourceType,
    errorCode,
    errorMessage: `${resourceType}/${id}: Bad Request`
});

describe('WriteAuditor', () => {
    test.each([
        {
            name: 'created and updated entries of two resource types get one create and one update audit per type',
            results: [
                entry({ resourceType: 'Patient', id: 'patient-1', created: true }),
                entry({ resourceType: 'Observation', id: 'observation-1', updated: true }),
                entry({ resourceType: 'Patient', id: 'patient-2', updated: true }),
                entry({ resourceType: 'Patient', id: 'patient-3', created: true }),
                entry({ resourceType: 'Observation', id: 'observation-2', created: true }),
                entry({ resourceType: 'Patient', id: 'patient-4' })
            ],
            expectedSuccessAudits: [
                successAudit({ resourceType: 'Patient', operation: 'create', ids: ['uuid-patient-1', 'uuid-patient-3'] }),
                successAudit({ resourceType: 'Patient', operation: 'update', ids: ['uuid-patient-2'] }),
                successAudit({ resourceType: 'Observation', operation: 'create', ids: ['uuid-observation-2'] }),
                successAudit({ resourceType: 'Observation', operation: 'update', ids: ['uuid-observation-1'] })
            ],
            expectedErrorAudits: []
        },
        {
            name: 'AuditEvent entries get no success audit, but an AuditEvent entry with an issue gets an error audit',
            results: [
                entry({ resourceType: 'AuditEvent', id: 'audit-event-1', created: true }),
                entry({ resourceType: 'AuditEvent', id: 'audit-event-2', updated: true }),
                entry({ resourceType: 'AuditEvent', id: 'audit-event-3', issue: { severity: 'error', code: 'invalid' } })
            ],
            expectedSuccessAudits: [],
            expectedErrorAudits: [
                errorAudit({ resourceType: 'AuditEvent', id: 'audit-event-3', errorCode: 400 })
            ]
        },
        {
            name: 'a too-long issue gets 413 and any other issue gets 400',
            results: [
                entry({ resourceType: 'Patient', id: 'patient-1', issue: { severity: 'error', code: 'too-long' } }),
                entry({ resourceType: 'Patient', id: 'patient-2', issue: { severity: 'error', code: 'invalid' } }),
                entry({ resourceType: 'Patient', id: 'patient-3', issue: { severity: 'error', code: 'forbidden' } })
            ],
            expectedSuccessAudits: [],
            expectedErrorAudits: [
                errorAudit({ resourceType: 'Patient', id: 'patient-1', errorCode: 413 }),
                errorAudit({ resourceType: 'Patient', id: 'patient-2', errorCode: 400 }),
                errorAudit({ resourceType: 'Patient', id: 'patient-3', errorCode: 400 })
            ]
        }
    ])('audits in a post-request task: $name', async ({ results, expectedSuccessAudits, expectedErrorAudits }) => {
        const { auditor, auditLogger, postRequestProcessor, tasks } = buildAuditor();

        await auditor.auditAsync({ context: buildContext(), results });
        const loggedBeforeTask = auditLogger.logAuditEntryAsync.mock.calls.length +
            auditLogger.logErrorAuditEntryAsync.mock.calls.length;
        await tasks[0]();

        expect(postRequestProcessor.add).toHaveBeenCalledTimes(1);
        expect(postRequestProcessor.add).toHaveBeenCalledWith({ requestId: 'request-1', fnTask: expect.any(Function) });
        expect(loggedBeforeTask).toBe(0);
        expect(auditLogger.logAuditEntryAsync.mock.calls.map(([args]) => args)).toStrictEqual(expectedSuccessAudits);
        expect(auditLogger.logErrorAuditEntryAsync.mock.calls.map(([args]) => args)).toStrictEqual(expectedErrorAudits);
    });

    test('rejects with a RethrownError that wraps the error when the post-request processor throws', async () => {
        const { auditor, auditLogger, postRequestProcessor } = buildAuditor();
        const error = new Error('synthetic post-request failure');
        postRequestProcessor.add.mockImplementation(() => {
            throw error;
        });

        const rejection = await auditor.auditAsync({
            context: buildContext(),
            results: [entry({ resourceType: 'Patient', id: 'patient-1', created: true })]
        }).catch((e) => e);

        expect(rejection).toBeInstanceOf(RethrownError);
        expect(rejection.nested).toBe(error);
        expect(rejection.message).toBe('synthetic post-request failure');
        expect(auditLogger.logAuditEntryAsync).not.toHaveBeenCalled();
        expect(auditLogger.logErrorAuditEntryAsync).not.toHaveBeenCalled();
    });
});
