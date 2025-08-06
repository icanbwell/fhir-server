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
        },

        /**
         * Returns the master_person_id extension value
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<*|null>}
         */

        master_person_id: async (parent, args, context, info) => {
            return await context.dataApi.getExtensionValueByUrl(
                {
                    resource: parent,
                    url: 'https://icanbwell.com/codes/master_person_id'
                }
            );
        },
        /**
         * Returns the client_person_id extension value
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<*|null>}
         */
        client_person_id: async (parent, args, context, info) => {
            return await context.dataApi.getExtensionValueByUrl(
                {
                    resource: parent,
                    url: 'https://icanbwell.com/codes/client_person_id'
                }
            );
        },
        /**
         * Returns the source_patient_id extension value
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<*|null>}
         */
        source_patient_id: async (parent, args, context, info) => {
            return await context.dataApi.getExtensionValueByUrl(
                {
                    resource: parent,
                    url: 'https://icanbwell.com/codes/source_patient_id'
                }
            );
        },
        /**
         * Returns the connection_type extension value
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<*|null>}
         */
        connection_type: async (parent, args, context, info) => {
            return await context.dataApi.getExtensionValueByUrl(
                {
                    resource: parent,
                    url: 'https://icanbwell.com/codes/connection_type'
                }
            );
        },
        /**
         * Returns the connection_name extension value
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<*|null>}
         */
        connection_name: async (parent, args, context, info) => {
            return await context.dataApi.getExtensionValueByUrl(
                {
                    resource: parent,
                    url: 'https://icanbwell.com/codes/connection_name'
                }
            );
        },
        /**
         * Returns the service_slug extension value
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<*|null>}
         */
        service_slug: async (parent, args, context, info) => {
            return await context.dataApi.getExtensionValueByUrl(
                {
                    resource: parent,
                    url: 'https://icanbwell.com/codes/service_slug'
                }
            );
        }
    }
};
