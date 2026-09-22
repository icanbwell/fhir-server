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

        const debugRequested = Boolean(parsedArgs._debug || parsedArgs._explain);
        // one slot per chain, filled in chainedItems order regardless of resolution order --
        // mirrors mongoQueryAndOptionsStringify's ' | '-joined multi-collection query display
        // used by $everything (bundleManager.js), rather than one tag per chain.
        const chainDisplays = debugRequested ? new Array(chainedItems.length) : undefined;

        await Promise.all(chainedItems.map(async (parsedArg, index) => {
            const { targetType, targetParam } = parsedArg.chain;
            const targetValue = parsedArg.queryParameterValue.values.join(',');
            const debugTags = debugRequested ? [] : undefined;

            const resolvedUuids = await searchResourceAsync({
                resourceType: targetType,
                args: {
                    [targetParam]: targetValue,
                    ...(debugRequested ? { _debug: parsedArgs._debug, _explain: parsedArgs._explain } : {})
                },
                requestInfo,
                ...(debugRequested ? { debugTags } : {})
            });

            if (debugTags && debugTags.length > 0) {
                chainDisplays[index] = `${parsedArg.queryParameter}.${targetParam} -> ${targetType}?${targetParam}=${targetValue}: ` +
                    debugTags.map((t) => t.display).join(' | ');
            }

            const newValue = resolvedUuids && resolvedUuids.length > 0
                ? resolvedUuids.map((uuid) => `${targetType}/${uuid}`).join(',')
                : `${targetType}/${UNMATCHABLE_UUID}`;

            parsedArg.queryParameterValue = new QueryParameterValue({
                value: newValue,
                operator: parsedArg.queryParameterValue.operator
            });
        }));

        const filledChainDisplays = chainDisplays?.filter(Boolean);
        if (filledChainDisplays?.length > 0) {
            parsedArgs.chainDebugDisplay = filledChainDisplays.join(' | ');
        }

        return parsedArgs;
    }
}

module.exports = {
    ChainedSearchQueryRewriter
};
