// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    ImagingStudySeries: {
        // noinspection JSUnusedLocalSymbols

        endpoint: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.endpoint);
        },
        // noinspection JSUnusedLocalSymbols

        specimen: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.specimen);
        }
    }
};
