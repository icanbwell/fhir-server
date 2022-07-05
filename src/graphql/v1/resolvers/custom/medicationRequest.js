const {getResources} = require('../../common');

module.exports = {
    MedicationRequest: {
        dispense: async (parent, args, context, info) => {
            return await getResources(
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
