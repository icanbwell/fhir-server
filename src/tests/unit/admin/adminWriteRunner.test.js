const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {
        getRequestInfo () {
            return null;
        }
    }
    return { FhirOperationsManager };
});

const { AdminWriteRunner } = require('../../../admin/adminWriteRunner');
const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { WritePipeline } = require('../../../operations/writePipeline/writePipeline');
const { AdminResponder } = require('../../../operations/writePipeline/operations/admin/responder');
const {
    ADMIN_LINK_WRITE_PROFILE,
    ADMIN_PATIENT_REFERENCE_WRITE_PROFILE
} = require('../../../operations/writePipeline/operations/admin/profile');
const {
    UnknownAdminOperationError
} = require('../../../operations/writePipeline/operations/admin/adminOperations');
const { ParsedArgs } = require('../../../operations/query/parsedArgs');
const { PostRequestProcessor } = require('../../../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');
const { isUuid } = require('../../../utils/uid.util');

/**
 * Synthetic ids for the requests.
 */
const PERSON_UUID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_PERSON_UUID = '00000000-0000-4000-8000-0000000000a2';
const PATIENT_UUID = '00000000-0000-4000-8000-0000000000b1';
const CALLER_REQUEST_ID = 'caller-request-id';

/**
 * Runner arguments, without the request, for runs whose input does not matter to the test.
 */
const LINK_RUN = Object.freeze({ operation: 'createPersonToPersonLink', input: {} });
const UNLINK_PATIENT_RUN = Object.freeze({ operation: 'removePersonToPatientLink', input: {} });

/**
 * Returns the request the route hands to the runner: a plain object with a body and headers.
 * @param {Object} [headers]
 * @returns {Object}
 */
function buildRequest (headers = {}) {
    return {
        id: CALLER_REQUEST_ID,
        method: 'POST',
        body: { bwellPersonId: PERSON_UUID, externalPersonId: OTHER_PERSON_UUID },
        headers: { 'content-type': 'application/json', ...headers }
    };
}

/**
 * Returns the request info `FhirOperationsManager.getRequestInfo` builds for the request.
 * @param {Object} req
 * @returns {FhirRequestInfo}
 */
function requestInfoFor (req) {
    return new FhirRequestInfo({
        user: 'synthetic-admin',
        scope: 'admin/*.*',
        remoteIpAddress: '127.0.0.1',
        requestId: CALLER_REQUEST_ID,
        userRequestId: CALLER_REQUEST_ID,
        protocol: 'https',
        originalUrl: '/admin/createPersonToPersonLink',
        path: '/admin/createPersonToPersonLink',
        host: 'localhost',
        body: req.body,
        accept: 'application/json',
        isUser: false,
        userType: null,
        personIdFromJwtToken: null,
        masterPersonIdFromJwtToken: null,
        managingOrganizationId: null,
        headers: req.headers,
        method: req.method,
        contentTypeFromHeader: null
    });
}

describe('AdminWriteRunner', () => {
    let fhirOperationsManager;
    let writePipeline;
    let adminResponder;
    let postRequestProcessor;
    let requestSpecificCache;
    let runner;
    let callerRequestInfo;
    const pipelineResponse = Object.freeze({ json: { message: 'synthetic' }, linkEvent: null });

    beforeEach(() => {
        fhirOperationsManager = Object.create(FhirOperationsManager.prototype);
        fhirOperationsManager.getRequestInfo = jest.fn((req) => {
            callerRequestInfo = requestInfoFor(req);
            return callerRequestInfo;
        });
        writePipeline = Object.create(WritePipeline.prototype);
        writePipeline.runAsync = jest.fn().mockResolvedValue(pipelineResponse);
        adminResponder = new AdminResponder();
        postRequestProcessor = Object.create(PostRequestProcessor.prototype);
        postRequestProcessor.executeAsync = jest.fn().mockResolvedValue(undefined);
        requestSpecificCache = Object.create(RequestSpecificCache.prototype);
        requestSpecificCache.clearAsync = jest.fn().mockResolvedValue(undefined);
        runner = new AdminWriteRunner({
            fhirOperationsManager,
            writePipeline,
            adminResponder,
            postRequestProcessor,
            requestSpecificCache
        });
    });

    /**
     * Returns what the runner passed to `writePipeline.runAsync` on its last call.
     * @returns {Object}
     */
    function lastPipelineArgs () {
        return writePipeline.runAsync.mock.calls.at(-1)[0];
    }

    test.each([
        [
            'createPersonToPersonLink',
            ADMIN_LINK_WRITE_PROFILE,
            'Person',
            { bwellPersonId: PERSON_UUID, externalPersonId: OTHER_PERSON_UUID }
        ],
        [
            'removePersonToPersonLink',
            ADMIN_LINK_WRITE_PROFILE,
            'Person',
            { bwellPersonId: PERSON_UUID, externalPersonId: OTHER_PERSON_UUID }
        ],
        [
            'createPersonToPatientLink',
            ADMIN_LINK_WRITE_PROFILE,
            'Person',
            { externalPersonId: PERSON_UUID, patientId: PATIENT_UUID }
        ],
        [
            'removePersonToPatientLink',
            ADMIN_LINK_WRITE_PROFILE,
            'Person',
            { personId: PERSON_UUID, patientId: PATIENT_UUID }
        ],
        [
            'updatePatientReference',
            ADMIN_PATIENT_REFERENCE_WRITE_PROFILE,
            'Observation',
            { resourceType: 'Observation', resourceId: PERSON_UUID, patientId: PATIENT_UUID }
        ]
    ])(
        'runs %s through the pipeline under its profile with the admin responder, and returns the response',
        async (operation, profile, resourceType, input) => {
            const req = buildRequest();

            const response = await runner.runAsync({ operation, req, input });

            expect(response).toBe(pipelineResponse);
            expect(fhirOperationsManager.getRequestInfo).toHaveBeenCalledWith(req);
            const args = lastPipelineArgs();
            expect(args.profile).toBe(profile);
            expect(args.responder).toBe(adminResponder);
            expect(args.resourceType).toBe(resourceType);
            expect(args.requestInfo).toBeInstanceOf(FhirRequestInfo);
            expect(args.requestInfo.body).toStrictEqual({ ...input, operation });
            expect(args.parsedArgs).toBeInstanceOf(ParsedArgs);
            expect(args.parsedArgs.base_version).toBe('4_0_0');
            expect(args.parsedArgs.getRawArgs()).toStrictEqual({});
        }
    );

    test('the operation argument wins over a body key named operation', async () => {
        await runner.runAsync({
            operation: 'removePersonToPersonLink',
            req: buildRequest(),
            input: {
                operation: 'createPersonToPatientLink',
                bwellPersonId: PERSON_UUID,
                externalPersonId: OTHER_PERSON_UUID
            }
        });

        expect(lastPipelineArgs().requestInfo.body.operation).toBe('removePersonToPersonLink');
        expect(lastPipelineArgs().profile).toBe(ADMIN_LINK_WRITE_PROFILE);
    });

    test('each run gets a fresh request id, and the queue drain and cache clear use it', async () => {
        await runner.runAsync({ ...LINK_RUN, req: buildRequest() });
        await runner.runAsync({ ...LINK_RUN, req: buildRequest() });

        const [firstId, secondId] = writePipeline.runAsync.mock.calls.map(
            ([args]) => args.requestInfo.requestId
        );
        expect(isUuid(firstId)).toBeTruthy();
        expect(isUuid(secondId)).toBeTruthy();
        expect(firstId).not.toBe(secondId);
        expect(firstId).not.toBe(CALLER_REQUEST_ID);
        expect(postRequestProcessor.executeAsync.mock.calls).toStrictEqual([
            [{ requestId: firstId }],
            [{ requestId: secondId }]
        ]);
        expect(requestSpecificCache.clearAsync.mock.calls).toStrictEqual([
            [{ requestId: firstId }],
            [{ requestId: secondId }]
        ]);
    });

    test('on success the post-request queue is drained before the request cache is cleared', async () => {
        const calls = [];
        writePipeline.runAsync.mockImplementation(async () => {
            calls.push('pipeline');
            return pipelineResponse;
        });
        postRequestProcessor.executeAsync.mockImplementation(async () => calls.push('drain'));
        requestSpecificCache.clearAsync.mockImplementation(async () => calls.push('clear'));

        await runner.runAsync({ ...LINK_RUN, req: buildRequest() });

        expect(calls).toStrictEqual(['pipeline', 'drain', 'clear']);
    });

    test('a failed run clears the request cache, does not drain the queue and rethrows the original error', async () => {
        const error = new Error('synthetic pipeline failure');
        writePipeline.runAsync.mockRejectedValue(error);

        await expect(
            runner.runAsync({ ...UNLINK_PATIENT_RUN, req: buildRequest() })
        ).rejects.toBe(error);

        const { requestId } = lastPipelineArgs().requestInfo;
        expect(postRequestProcessor.executeAsync).not.toHaveBeenCalled();
        expect(requestSpecificCache.clearAsync).toHaveBeenCalledWith({ requestId });
    });

    test('a failed queue drain still clears the request cache and rethrows the drain error', async () => {
        const error = new Error('synthetic drain failure');
        postRequestProcessor.executeAsync.mockRejectedValue(error);

        await expect(
            runner.runAsync({ ...LINK_RUN, req: buildRequest() })
        ).rejects.toBe(error);

        expect(requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
    });

    test('an unknown operation throws before anything runs', async () => {
        await expect(
            runner.runAsync({ operation: 'notAnAdminOperation', req: buildRequest(), input: {} })
        ).rejects.toBeInstanceOf(UnknownAdminOperationError);

        expect(fhirOperationsManager.getRequestInfo).not.toHaveBeenCalled();
        expect(writePipeline.runAsync).not.toHaveBeenCalled();
        expect(requestSpecificCache.clearAsync).not.toHaveBeenCalled();
    });

    test.each([
        ['if-match', 'W/"1"'],
        ['if-none-match', '*'],
        ['If-Match', 'W/"2"'],
        ['IF-NONE-MATCH', '*']
    ])('the %s header is removed from the request info the pipeline sees', async (name, value) => {
        await runner.runAsync({
            operation: 'createPersonToPersonLink',
            req: buildRequest({ [name]: value, 'origin-service': 'synthetic-service' }),
            input: {}
        });

        const { headers } = lastPipelineArgs().requestInfo;
        expect(headers).not.toHaveProperty([name]);
        expect(headers).toStrictEqual({
            'content-type': 'application/json',
            'origin-service': 'synthetic-service'
        });
    });

    test('the request and the request info it was read into are not changed', async () => {
        const req = buildRequest({ 'if-match': 'W/"1"' });
        const reqBefore = structuredClone(req);

        await runner.runAsync({
            operation: 'createPersonToPersonLink',
            req,
            input: { bwellPersonId: PERSON_UUID, externalPersonId: OTHER_PERSON_UUID }
        });

        expect(req).toStrictEqual(reqBefore);
        expect(callerRequestInfo.requestId).toBe(CALLER_REQUEST_ID);
        expect(callerRequestInfo.headers).toStrictEqual(reqBefore.headers);
        expect(callerRequestInfo.body).toStrictEqual(reqBefore.body);
        expect(lastPipelineArgs().requestInfo).not.toBe(callerRequestInfo);
        expect(lastPipelineArgs().requestInfo.userRequestId).toBe(CALLER_REQUEST_ID);
    });
});
