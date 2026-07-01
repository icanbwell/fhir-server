const { logWarn } = require('../../../operations/common/logging');

// Custom GraphQL V2 resolvers for the Location resource.
//
// Resolves the managing organization's name into the reference `display` when the
// stored reference has none. Per FHIR semantics `Reference.display` is the
// human-readable label for the referenced resource, so consumers can show the
// managing organization's name instead of an internal Location.name label.
// Falls back to the stored display, then to null, and never fails the query.
module.exports = {
    LocationManagingOrganizationReference: {
        // noinspection JSUnusedLocalSymbols
        display: async (parent, args, context, info) => {
            if (parent && parent.display) {
                return parent.display;
            }

            if (!parent || !parent.reference) {
                return null;
            }

            try {
                const organization = await context.dataApi.findResourceByReference(
                    parent,
                    args,
                    context,
                    info,
                    parent
                );

                return (organization && organization.name) || null;
            } catch (error) {
                logWarn(
                    'Unable to resolve managingOrganization display from organization name',
                    { error }
                );

                return null;
            }
        }
    }
};
