// ------ This code is generated by a code generator.  Do not edit. ------

// noinspection JSUnusedLocalSymbols
module.exports = {
    Query: {
        // noinspection JSUnusedLocalSymbols
        paymentNotices: async (parent, args, context, info) => {
            return await context.dataApi.getResourcesBundle(
                parent,
                args,
                context,
                info,
                'PaymentNotice'
            );
        }
    },
    PaymentNotice: {
        __resolveReference: async (reference, context, info) => {
            return await context.dataApi.resolveEntityByReference(
                reference,
                context,
                info,
                'PaymentNotice'
            );
        }
    },
    PaymentNoticeProvider: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    PaymentNoticePayee: {
        __resolveType (obj, context, info) {
            return context.dataApi.resolveType(obj, context, info);
        }
    },
    PaymentNoticeRequestReference: {
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
    PaymentNoticeResponseReference: {
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
    PaymentNoticeProviderReference: {
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
    PaymentNoticePaymentReference: {
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
    PaymentNoticePayeeReference: {
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
    PaymentNoticeRecipientReference: {
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
