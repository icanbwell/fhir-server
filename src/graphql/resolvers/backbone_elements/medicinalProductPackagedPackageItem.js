// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    MedicinalProductPackagedPackageItem: {
        // noinspection JSUnusedLocalSymbols

        device: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.device);
        },
        // noinspection JSUnusedLocalSymbols

        manufacturedItem: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.manufacturedItem);
        },
        // noinspection JSUnusedLocalSymbols

        manufacturer: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.manufacturer);
        }
    }
};