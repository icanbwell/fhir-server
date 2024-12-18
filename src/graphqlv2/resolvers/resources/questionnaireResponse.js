// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols
        questionnaireResponses: async (parent, args, context, info) => {
            return await context.dataApi.getResourcesBundle(
                parent,
                args,
                context,
                info,
                'QuestionnaireResponse'
            );
        }
    },
    QuestionnaireResponseBasedOn: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    QuestionnaireResponsePartOf: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    QuestionnaireResponseSubject: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    QuestionnaireResponseAuthor: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    QuestionnaireResponseSource: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    QuestionnaireResponseBasedOnReference: {
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
    QuestionnaireResponsePartOfReference: {
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
    QuestionnaireResponseSubjectReference: {
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
    QuestionnaireResponseEncounterReference: {
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
    QuestionnaireResponseAuthorReference: {
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
    QuestionnaireResponseSourceReference: {
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
