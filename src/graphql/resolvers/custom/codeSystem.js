const graphqlFields = require('graphql-fields');
const { graphqlFieldsToMongoProjection } = require('../../../utils/graphqlFieldsProjection');
const { markCodeSystemProperties } = require('../../../utils/binaryCodeSystemOwnership');

module.exports = {
    CodeSystem: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */

        concept: async (parent, args, context, info) => {
            // noinspection JSValidateTypes
            /**
             * @type {CodeSystem|null}
             */
            const codeSystem = parent;
            let concepts = codeSystem.concept;
            if (codeSystem && args.code) { // filter by code
                /**
                 * @type {string[]}
                 */
                const codes = args.code;
                if (Array.isArray(codes)) {
                    concepts = codeSystem.concept.filter(c => codes.includes(c.code));
                }
            }
            // let a property's valueString resolver check that a referenced Binary belongs to this CodeSystem
            return markCodeSystemProperties(concepts, codeSystem);
        }
    },
    Query: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        getCodeSystemCodes: async (parent, args, context, info) => {
            // Add projection filter on the nested array i.e concept field and the graphql queried fields
            const fields = graphqlFields(info);
            let projection = {};
            if (fields) {
                projection = graphqlFieldsToMongoProjection(fields?.entry?.resource);
            }
            if (args.code) {
                projection.concept = {
                    $filter: {
                        input: '$concept',
                        as: 'ct',
                        cond: { $in: ['$$ct.code', args.code] }
                    }
                };
                delete args.code;
            }
            if (projection.concept) {
                // CodeSystem-owned Binary lookup (concept.property.valueString) compares the Binary's
                // securityContext against the parent CodeSystem's ids, so they must be projected.
                projection.id = 1;
                projection._uuid = 1;
                projection._sourceId = 1;
            }
            return await context.dataApi.getResourcesBundle(
                parent,
                {
                    projection, ...args
                },
                context,
                info,
                'CodeSystem',
                true
            );
        }
    }
};
