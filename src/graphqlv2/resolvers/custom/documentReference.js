module.exports = {
    DocumentReference: {
        content: async (parent, args, context, info) => {
            parent.content.forEach((element) => {
                element._sourceAssigningAuthority = parent._sourceAssigningAuthority;
            });
            return parent.content;
        }
    },
    DocumentReferenceContent: {
        attachment: async (parent, args, context, info) => {
            parent.attachment._sourceAssigningAuthority = parent._sourceAssigningAuthority;
            return parent.attachment;
        }
    },
    DocumentReferenceAttachment: {
        resource: async (parent, args, context, info) => {
            return await context.dataApi.findLinkedNonClinicalResource({
                resourceTypes: ['Binary'],
                referenceString: parent.url,
                sourceAssigningAuthority: parent._sourceAssigningAuthority
            });
        }
    }
};
