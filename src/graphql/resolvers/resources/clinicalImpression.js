// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols

        clinicalImpression: async (parent, args, context, info) => {
            return await context.dataApi.getResourcesBundle(
                parent,
                args,
                context,
                info,
                'ClinicalImpression'
            );
        }
    },
    ClinicalImpressionSubject: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    ClinicalImpressionAssessor: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    ClinicalImpressionProblem: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    ClinicalImpressionSupportingInfoV2: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    ClinicalImpression: {
        // noinspection JSUnusedLocalSymbols

        subject: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.subject);
        },
        // noinspection JSUnusedLocalSymbols

        encounter: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.encounter);
        },
        // noinspection JSUnusedLocalSymbols

        assessor: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.assessor);
        },
        // noinspection JSUnusedLocalSymbols

        previous: async (parent, args, context, info) => {
            return await context.dataApi.findResourceByReference(
                parent,
                args,
                context,
                info,
                parent.previous);
        },
        // noinspection JSUnusedLocalSymbols

        problem: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.problem);
        },
        // noinspection JSUnusedLocalSymbols

        prognosisReference: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.prognosisReference);
        },
        // noinspection JSUnusedLocalSymbols

        supportingInfoV2: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.supportingInfo);
        },
        // noinspection JSUnusedLocalSymbols

        supportingInfo: async (parent, args, context, info) => {
            return await context.dataApi.findResourcesByReference(
                parent,
                args,
                context,
                info,
                parent.supportingInfo);
        }
    }
};
