const {logInfo} = require('../../../operations/common/logging');

class AddRequestIdToResponseHeadersPlugin /* extends ApolloServerPlugin */ {
    /**
     * This plugin set the meta from each query into the results to provide debugging information
     */

    async requestDidStart(requestContext1) {
        return {
            willSendResponse(requestContext) {
                /**
                 * @type {{req: IncomingMessage, res: ServerResponse, fhirRequestInfo: FhirRequestInfo, dataApi: FhirDataSource, container: SimpleContainer}}
                 */
                const context = requestContext.contextValue;
                const response = requestContext.response;
                const req = requestContext.request;
                logInfo(
                    'AddRequestIdToResponseHeadersPlugin Request Received',
                    {
                        args: {
                            operationName: req.operationName,
                            query: req ? req.query: null
                        }
                    }
                );
                if (!response) {
                    return;
                }
                if (context.fhirRequestInfo.userRequestId && !response.headersSent) {
                    response.http.headers.set('X-Request-ID', String(context.fhirRequestInfo.userRequestId));
                } else if (context.req && context.req.id && !response.headersSent) {
                    response.http.headers.set('X-Request-ID', String(context.req.id));
                }
            }
        };
    }
}

const getAddRequestIdToResponseHeadersPlugin = () => {
    return new AddRequestIdToResponseHeadersPlugin();
};

module.exports = {
    AddRequestIdToResponseHeadersPlugin,
    getAddRequestIdToResponseHeadersPlugin
};
