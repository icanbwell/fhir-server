// ------ This code is generated by a code generator.  Do not edit. ------


// noinspection JSUnusedLocalSymbols
module.exports = {
    ClaimResponseAddItemProvider: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    ClaimResponseAddItemProviderReference: {
        // noinspection JSUnusedLocalSymbols
        resource: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent
            );
        }
    },
    ClaimResponseAddItemLocationReferenceReference: {
        // noinspection JSUnusedLocalSymbols
        resource: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent
            );
        }
    }
};
