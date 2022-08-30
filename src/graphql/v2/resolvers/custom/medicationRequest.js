module.exports = {
    MedicationRequest: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        dispense: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    prescription: parent.id,
                },
                context,
                info,
                'MedicationDispense'
            );
        },
    },
};
