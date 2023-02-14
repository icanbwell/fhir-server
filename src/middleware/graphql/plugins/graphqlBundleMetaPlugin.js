class BundleMetaApolloServerPlugin /*extends ApolloServerPlugin*/ {
    /**
     * This plugin set the meta from each query into the results to provide debugging information
     */
    constructor() {
        // ok to not specify
    }

    // noinspection JSUnusedLocalSymbols
    // eslint-disable-next-line no-unused-vars
    async requestDidStart(requestContext1) {
        // noinspection JSUnusedGlobalSymbols
        return {
            // didResolveOperation(context) {
            //     op = context.operationName;
            // },
            willSendResponse(requestContext) {
                /**
                 * @type {{req: IncomingMessage, res: ServerResponse, fhirRequestInfo: FhirRequestInfo, dataApi: FhirDataSource, container: SimpleContainer}}
                 */
                const context = requestContext.contextValue;

                const response = requestContext.response;
                if (!response) {
                    return;
                }
                // Augment response with an extension, as long as the operation
                // actually executed. (The `kind` check allows you to handle
                // incremental delivery responses specially.)
                if (response.body.kind === 'single' && 'data' in response.body.singleResult) {
                    /**
                     * @type {Object}
                     */
                    const data = response.body.singleResult.data;

                    if (!data) {
                        return;
                    }
                    /**
                     * @type {FhirDataSource}
                     */
                    const dataSource = context.dataApi;
                    if (!dataSource) {
                        return;
                    }
                    for (const [, bundle] of Object.entries(data)) {
                        if (bundle) {
                            bundle.meta = dataSource.getBundleMeta();
                        }
                    }
                }
            }
        };
    }
}

const getBundleMetaApolloServerPlugin = () => {
    return new BundleMetaApolloServerPlugin();
};

module.exports = {
    BundleMetaApolloServerPlugin: BundleMetaApolloServerPlugin,
    getBundleMetaApolloServerPlugin: getBundleMetaApolloServerPlugin
};


