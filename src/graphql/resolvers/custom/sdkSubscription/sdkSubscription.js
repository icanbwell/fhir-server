// This schema is temporary until we switch our Cosmo Graph to use federation.
// See https://icanbwell.atlassian.net/browse/EFS-985

// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols
        // eslint-disable-next-line no-unused-vars
        subscription_subscription: async (parent, args, context, info) => {
            if (args._id) {
                // change into search by connection_id
                const connection_id = args._id.value;
                args.extension = `https://icanbwell.com/codes/connection_id|${connection_id}`;
                delete args._id;
            }
            return await context.dataApi.getResourcesBundle(
                parent,
                args,
                context,
                info,
                'Subscription'
            );
        }
    },
    Subscription_Subscription: {
    }
};
