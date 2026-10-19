// Field-level pagination for Group.member per the FHIR GraphQL spec
// (_offset / _count on a repeating element: https://build.fhir.org/graphql.html#list).
// An extended Group keeps its roster in GroupMember_4_0_0: a single-Group read gets one bounded
// page of it, other reads get []. Embedded Groups resolve member from the document.
// Merged into the generated Group resolver via mergeResolvers; the generated resolver does not
// define `member`, so this is purely additive.
const { resolveGroupMemberAsync } = require('../../../utils/graphqlGroupMemberPaging');

module.exports = {
    Group: {
        /**
         * @param {Object|null} parent - the Group resource
         * @param {{_offset: (number|undefined), _count: (number|undefined)}} args
         * @param {Object} context
         * @param {Object} info
         * @return {Promise<Object[]|undefined>}
         */
        member: (parent, args, context, info) => resolveGroupMemberAsync(parent, args, context, info)
    }
};
