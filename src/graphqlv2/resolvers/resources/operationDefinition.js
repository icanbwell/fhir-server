// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols
        operationDefinitions: async (parent, args, context, info) => {
            return await context.dataApi.getResourcesBundle(
                parent,
                args,
                context,
                info,
                'OperationDefinition'
            );
        }
    },
    OperationDefinition: {
        __resolveReference: async (reference, context, info) => {
            return await context.dataApi.resolveEntityByReference(
                reference,
                context,
                info,
                'OperationDefinition'
            );
        }
    }
};
