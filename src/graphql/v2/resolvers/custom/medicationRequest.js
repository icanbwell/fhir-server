module.exports = {
    MedicationRequest: {
        dispense: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    'prescription': parent.id,
                },
                context,
                info,
                'MedicationDispense'
            );
        },
    }
};
