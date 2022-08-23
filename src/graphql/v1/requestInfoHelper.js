const {FhirRequestInfo} = require('../../utils/fhirRequestInfo');
/**
 * @param context
 * @returns {FhirRequestInfo}
 */
module.exports.getRequestInfo = (context) => {
    return new FhirRequestInfo(
      context.user,
      context.scope,
      context.remoteIpAddress,
      context.requestId,
      context.protocol,
      context.originalUrl,
      context.path,
      context.host,
      context.body,
      context.accept,
      context.isUser,
      context.patients,
      context.fhirPersonId
    );
};
