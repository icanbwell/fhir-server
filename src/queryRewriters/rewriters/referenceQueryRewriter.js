const { fhirFilterTypes } = require('../../operations/query/customQueries');
const { QueryParameterValue } = require('../../operations/query/queryParameterValue');
const { QueryRewriter } = require('./queryRewriter');
const { ReferenceParser } = require('../../utils/referenceParser');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');

class ReferenceQueryRewriter extends QueryRewriter {
    /**
     * rewrites the args
     * @typedef {Object} RewriteArgsAsyncOpt
     * @property {string} base_version
     * @property {import('../../operations/query/parsedArgs').ParsedArgs} parsedArgs
     * @property {string} resourceType
     *
     * @param {RewriteArgsAsyncOpt} opt
     * @return {Promise<import('../../operations/query/parsedArgs').ParsedArgs>}
     */
    async rewriteArgsAsync({ parsedArgs }) {
        parsedArgs.parsedArgItems = parsedArgs.parsedArgItems.map((parsedArg) => {
            if (
                (
                    parsedArg?.propertyObj?.type === fhirFilterTypes.reference ||
                    parsedArg.queryParameter === '_id' ||
                    parsedArg.queryParameter === 'id'
                ) &&
                parsedArg.queryParameterValue.values
            ) {
                const newValues = parsedArg.queryParameterValue.values.map((value) => {
                    const { id, resourceType, sourceAssigningAuthority } =
                        ReferenceParser.parseReference(value);
                    if (isUuid(id)) {
                        return ReferenceParser.createReference({ resourceType, id });
                    } else if (sourceAssigningAuthority) {
                        return ReferenceParser.createReference({
                            resourceType,
                            id: generateUUIDv5(`${id}|${sourceAssigningAuthority}`),
                        });
                    } else {
                        return value;
                    }
                });

                parsedArg.queryParameterValue = new QueryParameterValue({
                    value: newValues.join(),
                    operator: parsedArg.queryParameterValue.operator,
                });
            }

            return parsedArg;
        });

        return parsedArgs;
    }
}

module.exports = {
    ReferenceQueryRewriter,
};
