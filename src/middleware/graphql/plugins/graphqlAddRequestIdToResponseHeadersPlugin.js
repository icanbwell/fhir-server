class AddRequestIdToResponseHeadersPlugin /*extends ApolloServerPlugin*/ {
    /**
     * This plugin set the meta from each query into the results to provide debugging information
     */
    constructor() {
        // ok to not specify
    }

    // eslint-disable-next-line no-unused-vars
    async requestDidStart(requestContext1) {
        return {
            willSendResponse(requestContext) {
                /**
                 * @type {{req: IncomingMessage, res: ServerResponse, fhirRequestInfo: FhirRequestInfo, dataApi: FhirDataSource, container: SimpleContainer}}
                 */
                const context = requestContext.contextValue;
                const response = requestContext.response;
                if (!response) {
                    return;
                }
                if (context.fhirRequestInfo.requestId && !response.headersSent) {
                    response.http.headers.set('X-Request-ID', String(context.fhirRequestInfo.requestId));
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


