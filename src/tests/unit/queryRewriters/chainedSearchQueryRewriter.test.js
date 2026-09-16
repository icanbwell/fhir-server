'use strict';

const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { ChainedSearchQueryRewriter } = require('../../../queryRewriters/rewriters/chainedSearchQueryRewriter');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');

describe('ChainedSearchQueryRewriter', () => {
    let rewriter;

    beforeEach(() => {
        rewriter = new ChainedSearchQueryRewriter();
    });

    /**
     * Helper to build a parsedArgs object with a single parsedArgItem
     */
    function buildParsedArgs ({ queryParameter, chain, value, operator = '$and' }) {
        return {
            parsedArgItems: [
                {
                    queryParameter,
                    chain,
                    queryParameterValue: new QueryParameterValue({ value, operator })
                }
            ]
        };
    }

    test('passes parsedArgs through unchanged when no item has a chain descriptor', async () => {
        const parsedArgs = buildParsedArgs({ queryParameter: 'status', chain: undefined, value: 'active' });
        const searchResourceAsync = jest.fn();

        const result = await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(result.parsedArgItems[0].queryParameterValue.value).toBe('active');
        expect(searchResourceAsync).not.toHaveBeenCalled();
    });

    test('resolves a chained arg by running the sub-search and rewriting to a target reference', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'http://example.com/mrn|123456'
        });
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);
        const requestInfo = { user: 'caller' };

        const result = await rewriter.rewriteArgsAsync({ parsedArgs, requestInfo, searchResourceAsync });

        expect(searchResourceAsync).toHaveBeenCalledWith({
            resourceType: 'Patient',
            args: { identifier: 'http://example.com/mrn|123456' },
            requestInfo
        });
        expect(result.parsedArgItems[0].queryParameterValue.value).toBe('Patient/uuid-1');
    });

    test('joins multiple resolved ids with OR semantics', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'http://example.com/mrn|123456'
        });
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1', 'uuid-2']);

        const result = await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(result.parsedArgItems[0].queryParameterValue.value).toBe('Patient/uuid-1,Patient/uuid-2');
        expect(result.parsedArgItems[0].queryParameterValue.operator).toBe('$or');
    });

    test('rewrites to an unmatchable reference (never "no filter") when nothing resolves', async () => {
        // review.md §D: "no restriction" and "no matches" must never collapse to the same
        // representation -- an empty resolved-id set must still filter out everything, not fall
        // through to an unfiltered search on the base resource.
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'http://example.com/mrn|no-such-value'
        });
        const searchResourceAsync = jest.fn().mockResolvedValue([]);

        const result = await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        const rewrittenValue = result.parsedArgItems[0].queryParameterValue.value;
        expect(rewrittenValue).toMatch(/^Patient\//);
        // Must not equal any uuid that could plausibly be a real Patient _uuid resolved above,
        // and must not be empty/falsy (which would read downstream as "no filter").
        expect(rewrittenValue).toBeTruthy();
        expect(rewrittenValue).not.toBe('Patient/uuid-1');
    });

    test('batches multiple comma-separated values on one chain into a single sub-search call', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'sys|A,sys|B'
        });
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

        await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(searchResourceAsync).toHaveBeenCalledTimes(1);
        expect(searchResourceAsync).toHaveBeenCalledWith(expect.objectContaining({
            args: { identifier: 'sys|A,sys|B' }
        }));
    });

    test('resolves multiple different chained params concurrently, not sequentially', async () => {
        const parsedArgs = {
            parsedArgItems: [
                {
                    queryParameter: 'patient',
                    chain: { targetType: 'Patient', targetParam: 'identifier' },
                    queryParameterValue: new QueryParameterValue({ value: 'A' })
                },
                {
                    queryParameter: 'performer',
                    chain: { targetType: 'Practitioner', targetParam: 'identifier' },
                    queryParameterValue: new QueryParameterValue({ value: 'B' })
                }
            ]
        };

        const callOrder = [];
        const searchResourceAsync = jest.fn(async ({ resourceType }) => {
            callOrder.push(`start:${resourceType}`);
            await new Promise((resolve) => setTimeout(resolve, 5));
            callOrder.push(`end:${resourceType}`);
            return [`${resourceType}-uuid`];
        });

        const result = await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        // both sub-searches must have started before either finished -- proves they ran
        // concurrently rather than one-at-a-time
        expect(callOrder.slice(0, 2).sort()).toEqual(['start:Patient', 'start:Practitioner'].sort());
        expect(result.parsedArgItems[0].queryParameterValue.value).toBe('Patient/Patient-uuid');
        expect(result.parsedArgItems[1].queryParameterValue.value).toBe('Practitioner/Practitioner-uuid');
    });
});
