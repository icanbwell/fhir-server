// eslint-disable-next-line no-unused-vars
const {Binary} = require('../../../../fhir/classes/4_0_0/resources/binary');

module.exports = {
    CodeSystemProperty1: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<string|null>}
         */
        // eslint-disable-next-line no-unused-vars
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
                const binaryResource = await dataLoader.findResourceByReference(
                    codeSystemProperty1,
                    args,
                    context,
                    info,
                    {reference: codeSystemProperty1.valueString}
                );
                if (binaryResource.data) {
                    const decodedData = Buffer.from(binaryResource.data, 'base64').toString('utf8');
                    return decodedData;
                } else {
                    return null;
                }
            } else {
                return codeSystemProperty1.valueString;
            }
        },
    },
};
