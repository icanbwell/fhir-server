// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    MedicinalProductManufacturingBusinessOperation: {
        // noinspection JSUnusedLocalSymbols

        manufacturer: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.manufacturer);
        },
        // noinspection JSUnusedLocalSymbols

        regulator: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.regulator);
        }
    }
};