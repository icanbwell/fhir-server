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
};
