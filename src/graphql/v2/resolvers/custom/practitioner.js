
module.exports = {
    Practitioner: {
        // eslint-disable-next-line no-unused-vars
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        practitionerRole: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    practitioner: parent.id,
                },
                context,
                info,
                'PractitionerRole'
            );
        },
        // eslint-disable-next-line no-unused-vars
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        group: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    member: parent.id,
                },
                context,
                info,
                'Group'
            );
        },
        // eslint-disable-next-line no-unused-vars
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        measureReport: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    subject: parent.id,
                },
                context,
                info,
                'MeasureReport'
            );
        },
    }
};
