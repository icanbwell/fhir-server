module.exports = {
    Subscription: {
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
        // /**
        //  * @param {Resource|null} parent
        //  * @param {Object} args
        //  * @param {GraphQLContext} context
        //  * @param {Object} info
        //  * @return {Promise<Resource[]>}
        //  */
        // topic: async (parent, args, context, info) => {
        //     return await context.dataApi.getResources(
        //         parent,
        //         {
        //             ...args,
        //             subscription: parent.id
        //         },
        //         context,
        //         info,
        //         'SubscriptionTopic'
        //     );
        // }
    }
};
