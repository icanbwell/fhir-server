// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    EncounterLocation: {
        // noinspection JSUnusedLocalSymbols
        // eslint-disable-next-line no-unused-vars
        location: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.location);
        }
    }
};