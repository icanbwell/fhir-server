// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols

        substanceSpecification: async (parent, args, context, info) => {
            return await context.dataApi.getResourcesBundle(
                parent,
                args,
                context,
                info,
                'SubstanceSpecification'
            );
        }
    },
    SubstanceSpecification: {
        // noinspection JSUnusedLocalSymbols

        source: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.source);
        },
        // noinspection JSUnusedLocalSymbols

        referenceInformation: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.referenceInformation);
        },
        // noinspection JSUnusedLocalSymbols

        nucleicAcid: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.nucleicAcid);
        },
        // noinspection JSUnusedLocalSymbols

        polymer: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.polymer);
        },
        // noinspection JSUnusedLocalSymbols

        protein: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.protein);
        },
        // noinspection JSUnusedLocalSymbols

        sourceMaterial: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.sourceMaterial);
        }
    }
};