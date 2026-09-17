const { QueryRewriter } = require('./queryRewriter');
const { QueryParameterValue } = require('../../operations/query/queryParameterValue');
const { BadRequestError } = require('../../utils/httpErrors');

// Never a real resource id; used so a zero-match chain filters out everything instead of nothing
// (review.md §D).
const UNMATCHABLE_UUID = '00000000-0000-0000-0000-000000000000';

class ChainedSearchQueryRewriter extends QueryRewriter {
    async rewriteArgsAsync ({ parsedArgs, requestInfo, searchResourceAsync }) {
        const chainedItems = parsedArgs.parsedArgItems.filter((parsedArg) => parsedArg.chain);
        if (chainedItems.length === 0) {
            return parsedArgs;
        }
        if (typeof searchResourceAsync !== 'function') {
            throw new BadRequestError(new Error(
                'Chained search parameters are not supported through this entry point'
            ));
        }

        await Promise.all(chainedItems.map(async (parsedArg) => {
            const { targetType, targetParam } = parsedArg.chain;
            const targetValue = parsedArg.queryParameterValue.values.join(',');

            const resolvedUuids = await searchResourceAsync({
                resourceType: targetType,
                args: { [targetParam]: targetValue },
                requestInfo
            });

            const newValue = resolvedUuids && resolvedUuids.length > 0
                ? resolvedUuids.map((uuid) => `${targetType}/${uuid}`).join(',')
                : `${targetType}/${UNMATCHABLE_UUID}`;

            parsedArg.queryParameterValue = new QueryParameterValue({
                value: newValue,
                operator: parsedArg.queryParameterValue.operator
            });
        }));

        return parsedArgs;
    }
}

module.exports = {
    ChainedSearchQueryRewriter
};
