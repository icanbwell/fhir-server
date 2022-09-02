const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
/**
 * @param context
 * @returns {FhirRequestInfo}
 */
module.exports.getRequestInfo = (context) => {
    return new FhirRequestInfo({
        user: context.user,
        scope: context.scope,
        remoteIpAddress: context.remoteIpAddress,
        requestId: context.requestId,
        protocol: context.protocol,
        originalUrl: context.originalUrl,
        path: context.path,
        host: context.host,
        body: context.body,
        accept: context.accept,
        isUser: context.isUser,
        patients: context.patients,
        fhirPersonId: context.fhirPersonId,
        headers: context.headers,
    });
};
