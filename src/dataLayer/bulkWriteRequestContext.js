const { FhirRequestInfo } = require('../utils/fhirRequestInfo');

/**
 * Build a stripped-down FhirRequestInfo carrying only `requestId`.
 *
 * Deferred-flush queues (AuditLogger, AccessLogger) buffer one of these per
 * queued doc until the cron flush runs. Holding the live FhirRequestInfo
 * keeps headers, body, scopes, user object, parsed args, etc. alive long
 * after the request ended — by cloning into a fresh FhirRequestInfo with
 * everything except requestId nulled, V8 can release the originals.
 *
 * Why only requestId? End-to-end on the AuditEvent and AccessLog write
 * paths, the bulk-write chain consumes only `requestInfo.requestId`:
 *
 *   - flushAsync uses it per doc for the operations entry, then once for
 *     the executeAsync call.
 *   - executors use it for trace / log labels (assertIsValid).
 *   - History writes (which would also read userRequestId/method) are
 *     skipped: mongoBulkWriteExecutor short-circuits for both
 *     `resourceType === 'AuditEvent'` and `isAccessLogOperation === true`.
 *   - PreSaveOptions header reads only fire on update-retry paths, which
 *     pure-insert logger flushes don't hit.
 *
 * If the history-skip guards in mongoBulkWriteExecutor are ever removed,
 * the additional fields would need to be carried here too.
 */
function buildBulkWriteRequestContext(requestInfo) {
    return new FhirRequestInfo({
        requestId: requestInfo.requestId,
        // FhirRequestInfo's constructor reads `headers.Prefer` directly without
        // a null guard, so headers must be a non-null object.
        headers: {},
        // Everything else is unused on the AuditEvent and AccessLog paths;
        // null'ing them lets V8 release the original references at request end.
        user: null,
        scope: null,
        remoteIpAddress: null,
        protocol: null,
        originalUrl: null,
        path: null,
        host: null,
        body: null,
        accept: null,
        isUser: null,
        userType: null,
        userRequestId: null,
        method: null,
        personIdFromJwtToken: null,
        masterPersonIdFromJwtToken: null,
        managingOrganizationId: null,
        contentTypeFromHeader: null,
        alternateUserId: null,
        actor: null,
        purposeOfUse: null
    });
}

module.exports = {
    buildBulkWriteRequestContext
};
