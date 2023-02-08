class BundleMetaApolloServerPlugin /*extends ApolloServerPlugin*/ {
    /**
     * This plugin set the meta from each query into the results to provide debugging information
     */
    constructor() {
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
                const context = requestContext.context;
                const response = requestContext.response;
                if (!response) { return;}
                /**
                 * @type {Object}
                 */
                const data = response.data;
                if (!data) {return;}
                /**
                 * @type {FhirDataSource}
                 */
                const dataSource = context.dataApi;
                if (!dataSource) {
                    return;
                }
                for (const [, bundle] of Object.entries(data)) {
                    if (bundle){
                        bundle.meta = dataSource.getBundleMeta();
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


