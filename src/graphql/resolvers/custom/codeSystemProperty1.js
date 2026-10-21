
const { CODE_SYSTEM_OWNER } = require('../../../utils/binaryCodeSystemOwnership');

module.exports = {
    CodeSystemProperty1: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<string|null>}
         */

        valueString: async (parent, args, context, info) => {
            /**
             * @type {CodeSystemProperty1|null}
             */
            const codeSystemProperty1 = parent;
            if (codeSystemProperty1 && codeSystemProperty1.valueString &&
                codeSystemProperty1.valueString.startsWith('Binary/')
            ) { // expand
                /**
                 * @type {FhirDataSource}
                 */
                const dataLoader = context.dataApi;
                /**
                 * @type {Binary|null}
                 */
                const binaryResource = await dataLoader.findBinaryForCodeSystemAsync({
                    codeSystemProperty: codeSystemProperty1,
                    codeSystem: codeSystemProperty1[CODE_SYSTEM_OWNER],
                    binaryReference: codeSystemProperty1.valueString,
                    args,
                    context,
                    info
                });
                if (binaryResource?.data) {
                    return Buffer.from(binaryResource.data, 'base64').toString('utf8');
                } else {
                    return null;
                }
            } else {
                return codeSystemProperty1.valueString;
            }
        }
    }
};
