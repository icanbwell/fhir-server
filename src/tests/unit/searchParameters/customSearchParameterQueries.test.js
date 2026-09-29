'use strict';

/**
 * Characterization test for SearchParametersManager's non-standard custom search parameters --
 * i.e. fields that are real, queryable search parameters (resolved via getPropertyObject, the
 * same lookup r4ArgsParser.js uses to validate every incoming search filter) but have no entry in
 * the standard HL7 search-parameters.json bundle. These are backed by
 * src/searchParameters/customSearchParameterQueries.json, the single source of truth also read by
 * generatorScripts/mcp/generate_mcp_tools.py so MCP dedicated tool schemas can document them
 * without hand-duplicating this data in Python. This test exists to prove that data source didn't
 * silently lose or change behavior across the JSON-extraction refactor.
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { SearchParametersManager } = require('../../../searchParameters/searchParametersManager');

describe('SearchParametersManager custom (non-standard) search parameters', () => {
    let searchParametersManager;

    beforeEach(() => {
        searchParametersManager = new SearchParametersManager();
    });

    test('extension is resolvable on any resource type via the generic Resource fallback', () => {
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'Patient',
            queryParameter: 'extension'
        });

        expect(propertyObj.type).toBe('token');
        expect(propertyObj.fields).toEqual(['extension']);
    });

    test('SubscriptionStatus.subscription resolves as a reference targeting Subscription', () => {
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'SubscriptionStatus',
            queryParameter: 'subscription'
        });

        expect(propertyObj.type).toBe('reference');
        expect(propertyObj.target).toEqual(['Subscription']);
        expect(propertyObj.fields).toEqual(['subscription']);
    });

    test('ExportStatus.status resolves as a token', () => {
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'ExportStatus',
            queryParameter: 'status'
        });

        expect(propertyObj.type).toBe('token');
        expect(propertyObj.fields).toEqual(['status']);
    });

    test('a resource-specific custom parameter is not resolvable on an unrelated resource type', () => {
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'Patient',
            queryParameter: 'subscription'
        });

        expect(propertyObj).toBeUndefined();
    });
});
