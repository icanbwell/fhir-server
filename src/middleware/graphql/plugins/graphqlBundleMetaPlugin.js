// const {ApolloServerPlugin} = require('apollo-server-plugin-base');

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
        // const start = Date.now();
        // let op;

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
                // const stop = Date.now();
                // const elapsed = stop - start;
                // const size = JSON.stringify(context.response).length * 2;
                // console.log(
                //     `Operation ${op} completed in ${elapsed} ms and returned ${size} bytes`
                // );
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


