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
    function buildParsedArgs ({ queryParameter, chain, value, operator = '$and', modifiers }) {
        return {
            parsedArgItems: [
                {
                    queryParameter,
                    chain,
                    modifiers,
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

    test.each(['missing', 'contains', 'above', 'below', 'text', 'of-type', 'exact'])(
        'forwards the :%s modifier onto the sub-search\'s target parameter',
        async (modifier) => {
            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                chain: { targetType: 'Patient', targetParam: 'name' },
                value: 'Smith',
                modifiers: [modifier]
            });
            const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

            await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

            expect(searchResourceAsync).toHaveBeenCalledWith(expect.objectContaining({
                resourceType: 'Patient',
                args: { [`name:${modifier}`]: 'Smith' }
            }));
        }
    );

    test('does not forward the :not modifier to the sub-search -- it negates the outer reference filter instead', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'http://example.com/mrn|123456',
            modifiers: ['not']
        });
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

        await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(searchResourceAsync).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'Patient',
            args: { identifier: 'http://example.com/mrn|123456' }
        }));
    });

    test.each(['missing', 'contains', 'above', 'below', 'text', 'of-type', 'exact'])(
        'clears the :%s modifier off the parsedArg after resolving, so the outer reference filter dispatch does not also misapply it',
        async (modifier) => {
            // Regression: r4.js's top-level filter dispatch checks parsedArg.modifiers
            // generically for ANY param (missing/contains/above/below/text/of-type all take
            // priority over the normal type-based filter there). If this rewriter forwards a
            // modifier into the sub-search but leaves it sitting on the same parsedArg, the
            // OUTER reference filter (now holding the resolved Target/<uuid> value) gets
            // hijacked into running e.g. FilterByMissing/FilterByContains against the resolved
            // reference field instead of a normal equality match -- silently wrong results.
            const parsedArgs = buildParsedArgs({
                queryParameter: 'performer',
                chain: { targetType: 'Practitioner', targetParam: 'identifier' },
                value: 'X',
                modifiers: [modifier]
            });
            const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

            const result = await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

            expect(result.parsedArgItems[0].modifiers).toEqual([]);
        }
    );

    test('keeps the :not modifier on the parsedArg after resolving, since it belongs to the outer reference filter', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'http://example.com/mrn|123456',
            modifiers: ['not']
        });
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

        const result = await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(result.parsedArgItems[0].modifiers).toEqual(['not']);
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

        // '__invalid__' is the same sentinel already used elsewhere in this codebase
        // (personToPatientIdsExpander.js, dataSharingManager.js, searchManager.js,
        // patientQueryCreator.js) for "guaranteed to never match a real id".
        expect(result.parsedArgItems[0].queryParameterValue.value).toBe('__invalid__');
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

    test('throws a clean BadRequestError (not a raw TypeError) when a chain item exists but searchResourceAsync was never supplied', async () => {
        // Regression: MCP (mcpToolHandler.js) and GraphQL (graphql/dataSource.js,
        // graphqlv2/dataSource.js) call queryRewriterManager.rewriteArgsAsync without a
        // searchResourceAsync, but this rewriter is unconditionally registered
        // (createContainer.js) so it still runs for their requests too. A caller sending a
        // chain-shaped filter through one of those entry points must get a clean rejection,
        // not an uncaught TypeError crashing into a 500.
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'X'
        });

        await expect(rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync: undefined }))
            .rejects.toThrow(/chained search/i);
    });

    test('does not throw when there are no chain items, even without searchResourceAsync', async () => {
        const parsedArgs = buildParsedArgs({ queryParameter: 'status', chain: undefined, value: 'active' });

        await expect(rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync: undefined }))
            .resolves.toBe(parsedArgs);
    });

    test('does not request debug info from the sub-search when _debug/_explain were not requested', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'X'
        });
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

        await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(searchResourceAsync).toHaveBeenCalledWith({
            resourceType: 'Patient',
            args: { identifier: 'X' },
            requestInfo: undefined
        });
        expect(parsedArgs.chainDebugDisplay).toBeUndefined();
    });

    test('threads _debug through to the sub-search and collects its query display onto parsedArgs.chainDebugDisplay', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'X'
        });
        parsedArgs._debug = '1';
        const searchResourceAsync = jest.fn(async ({ debugTags }) => {
            debugTags.push({ system: 'https://www.icanbwell.com/query', display: 'db.Patient_4_0_0.find(...)' });
            return ['uuid-1'];
        });

        await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(searchResourceAsync).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'Patient',
            args: { identifier: 'X', _debug: '1' },
            debugTags: expect.any(Array)
        }));
        expect(parsedArgs.chainDebugDisplay).toEqual(
            expect.stringContaining('db.Patient_4_0_0.find(...)')
        );
    });

    test('does not set chainDebugDisplay when the sub-search produced no debug tag', async () => {
        const parsedArgs = buildParsedArgs({
            queryParameter: 'patient',
            chain: { targetType: 'Patient', targetParam: 'identifier' },
            value: 'X'
        });
        parsedArgs._explain = '1';
        const searchResourceAsync = jest.fn().mockResolvedValue(['uuid-1']);

        await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(parsedArgs.chainDebugDisplay).toBeUndefined();
    });

    test('combines multiple chains into a single pipe-joined chainDebugDisplay string, like $everything\'s multi-collection query tag', async () => {
        const parsedArgs = {
            _debug: '1',
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
        const searchResourceAsync = jest.fn(async ({ resourceType, debugTags }) => {
            debugTags.push({ system: 'https://www.icanbwell.com/query', display: `db.${resourceType}_4_0_0.find(...)` });
            return [`${resourceType}-uuid`];
        });

        await rewriter.rewriteArgsAsync({ parsedArgs, searchResourceAsync });

        expect(parsedArgs.chainDebugDisplay).toBe(
            'patient.identifier -> Patient?identifier=A: db.Patient_4_0_0.find(...)' +
            ' | ' +
            'performer.identifier -> Practitioner?identifier=B: db.Practitioner_4_0_0.find(...)'
        );
    });
});
