module.exports = {
    Subscription_SubscriptionStatus: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource[]>}
         */
        subscriptionTopic: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByCanonicalReference(
                parent,
                args,
                context,
                info,
                parent.topic
            );
        }
    }
};
