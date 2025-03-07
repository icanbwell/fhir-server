// ------ This code is generated by a code generator.  Do not edit. ------


// noinspection JSUnusedLocalSymbols
module.exports = {
    PaymentReconciliationDetailSubmitter: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    PaymentReconciliationDetailPayee: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    PaymentReconciliationDetailRequestReference: {
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
    PaymentReconciliationDetailSubmitterReference: {
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
    PaymentReconciliationDetailResponseReference: {
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
    PaymentReconciliationDetailResponsibleReference: {
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
    PaymentReconciliationDetailPayeeReference: {
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
