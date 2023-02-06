const graphqlFields = require('graphql-fields');
const { graphqlFieldsToMongoProjection } = require('../../../../utils/graphqlFieldsProjection');

module.exports = {
    CodeSystem: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        // eslint-disable-next-line no-unused-vars
        concept: async (parent, args, context, info) => {
            // noinspection JSValidateTypes
            /**
             * @type {CodeSystem|null}
             */
            const codeSystem = parent;
            if (codeSystem && args.code) { // filter by code
                /**
                 * @type {string[]}
                 */
                const codes = args.code;
                if (Array.isArray(codes)) {
                    return codeSystem.concept.filter(c => codes.includes(c.code));
                } else {
                    return codeSystem.concept;
                }
            } else {
                return codeSystem.concept;
            }
        },
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
            let fields = graphqlFields(info);
            let projection = {};
            if (fields){
                projection = graphqlFieldsToMongoProjection(fields?.['entry']?.['resource']);
            }
            if (args['code']){
                projection['concept'] = {
                    $filter: {
                        input: '$concept',
                        as: 'ct',
                        cond: { $in: ['$$ct.code', args['code']] },
                    },
                };
            }
            return await context.dataApi.getResourcesBundle(
                parent,
                {
                    projection, ...args,
                },
                context,
                info,
                'CodeSystem',
                true
            );
        },
    },
};
