const { assertTypeEquals } = require('../utils/assertType');
const { FhirOperationsManager } = require('../operations/fhirOperationsManager');
const { WritePipeline } = require('../operations/writePipeline/writePipeline');
const { AdminResponder } = require('../operations/writePipeline/operations/admin/responder');
const {
    getAdminOperation
} = require('../operations/writePipeline/operations/admin/adminOperations');
const {
    ADMIN_LINK_WRITE_PROFILE,
    ADMIN_PATIENT_REFERENCE_WRITE_PROFILE
} = require('../operations/writePipeline/operations/admin/profile');
const { ParsedArgs } = require('../operations/query/parsedArgs');
const { PostRequestProcessor } = require('../utils/postRequestProcessor');
const { RequestSpecificCache } = require('../utils/requestSpecificCache');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { generateUUID } = require('../utils/uid.util');
const { VERSIONS } = require('../middleware/fhir/utils/constants');

/**
 * The FHIR version every admin write runs under.
 */
const BASE_VERSION = VERSIONS['4_0_0'];

/**
 * The admin write profiles, keyed by the profile name an admin operation names.
 */
const ADMIN_WRITE_PROFILES = Object.freeze({
    [ADMIN_LINK_WRITE_PROFILE.name]: ADMIN_LINK_WRITE_PROFILE,
    [ADMIN_PATIENT_REFERENCE_WRITE_PROFILE.name]: ADMIN_PATIENT_REFERENCE_WRITE_PROFILE
});

/**
 * The conditional request headers, in lower case, that an admin write ignores.
 */
const CONDITIONAL_HEADERS = new Set(['if-match', 'if-none-match']);

/**
 * Runs one admin write operation through the shared write pipeline as its own request, as
 * `AdminResourceWriter` runs an old admin write: under a fresh request id, so its request cache
 * and post-request tasks are its own, with the post-request tasks (the audit) run once the write
 * succeeded and the request cache cleared on success and on error.
 */
class AdminWriteRunner {
    /**
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {WritePipeline} writePipeline
     * @param {AdminResponder} adminResponder
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {RequestSpecificCache} requestSpecificCache
     */
    constructor ({
        fhirOperationsManager,
        writePipeline,
        adminResponder,
        postRequestProcessor,
        requestSpecificCache
    }) {
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {WritePipeline}
         */
        this.writePipeline = writePipeline;
        assertTypeEquals(writePipeline, WritePipeline);
        /**
         * @type {AdminResponder}
         */
        this.adminResponder = adminResponder;
        assertTypeEquals(adminResponder, AdminResponder);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {RequestSpecificCache}
         */
        this.requestSpecificCache = requestSpecificCache;
        assertTypeEquals(requestSpecificCache, RequestSpecificCache);
    }

    /**
     * Runs the admin operation on the ids in `input` and returns the admin responder's
     * `{ json, linkEvent }`. The pipeline gets the operation's profile, the admin responder and a
     * copy of the request's info with a fresh request id, the body `{ ...input, operation }` (so a
     * body key named `operation` never overrides the operation) and no `If-Match` or
     * `If-None-Match` header. On success the post-request tasks of the fresh request id are run;
     * the request cache of that id is always cleared, and an error is rethrown. Throws an
     * `UnknownAdminOperationError` before anything runs when the operation has no definition.
     * Neither `req` nor the request info read from it is changed.
     * @param {string} operation
     * @param {import('http').IncomingMessage} req
     * @param {Object} input
     * @returns {Promise<{json: Object, linkEvent: {personId: string, patientId: string, isLinking: boolean}|null}>}
     */
    async runAsync ({ operation, req, input }) {
        const definition = getAdminOperation(operation);
        const profile = ADMIN_WRITE_PROFILES[definition.profile];
        const requestInfo = this._requestInfoFor({ req, operation, input });
        const { requestId } = requestInfo;
        try {
            const response = await this.writePipeline.runAsync({
                profile,
                responder: this.adminResponder,
                requestInfo,
                parsedArgs: new ParsedArgs({ base_version: BASE_VERSION }),
                resourceType: definition.target.resourceType ??
                    input?.[definition.target.resourceTypeParameter]
            });
            await this.postRequestProcessor.executeAsync({ requestId });
            return response;
        } finally {
            await this.requestSpecificCache.clearAsync({ requestId });
        }
    }

    /**
     * Returns a new request info for the admin write: the request's info with a fresh request id,
     * the body `{ ...input, operation }` and the headers without the conditional headers.
     * @param {import('http').IncomingMessage} req
     * @param {string} operation
     * @param {Object} input
     * @returns {FhirRequestInfo}
     */
    _requestInfoFor ({ req, operation, input }) {
        const requestInfo = this.fhirOperationsManager.getRequestInfo(req);
        const headers = Object.fromEntries(
            Object.entries(requestInfo.headers ?? {}).filter(
                ([name]) => !CONDITIONAL_HEADERS.has(name.toLowerCase())
            )
        );
        return new FhirRequestInfo({
            ...requestInfo,
            requestId: generateUUID(),
            headers,
            body: { ...input, operation }
        });
    }
}

module.exports = {
    AdminWriteRunner
};
