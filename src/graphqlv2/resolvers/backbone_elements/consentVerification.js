// ------ This code is generated by a code generator.  Do not edit. ------


// noinspection JSUnusedLocalSymbols
module.exports = {
    ConsentVerificationVerifiedWith: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    ConsentVerificationVerifiedWithReference: {
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
