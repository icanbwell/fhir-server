// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    EvidenceVariableVariableDefinition: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    EvidenceVariable: {
        // noinspection JSUnusedLocalSymbols

        variableDefinition: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.variableDefinition);
        }
    }
};