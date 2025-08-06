// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols

        subscription_subscription: async (parent, args, context, info) => {
            if (args._id) {
                // change into search by service_slug
                const service_slug = args._id.value;
                args.extension = `https://icanbwell.com/codes/service_slug|${service_slug}`;
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
