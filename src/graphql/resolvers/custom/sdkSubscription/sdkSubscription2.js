// This schema is temporary until we switch our Cosmo Graph to use federation.
// See https://icanbwell.atlassian.net/browse/EFS-985

module.exports = {
    Subscription_Subscription: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource[]>}
         */
        subscriptionStatus: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    subscription: parent.id
                },
                context,
                info,
                'SubscriptionStatus'
            );
        }
    }
};
