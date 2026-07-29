'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../operations/query/parsedArgs', () => ({
    ParsedArgs: class ParsedArgs {}
}));

jestObj.mock('../../../../operations/history/history', () => ({
    BaseHistoryOperationProcessor: class BaseHistoryOperationProcessor {
        async fetchHistoryAsync(params) {
            this._lastFetchParams = params;
            return { resourceType: 'Bundle', entry: [] };
        }
    }
}));

const { HistoryByIdOperation } = require('../../../../operations/historyById/historyById');

describe('HistoryByIdOperation', () => {
    test('sets currentOperationName to historyById', async () => {
        const op = new HistoryByIdOperation();
        await op.historyByIdAsync({
            requestInfo: {},
            parsedArgs: { id: 'patient-123' },
            resourceType: 'Patient'
        });
        expect(op.currentOperationName).toBe('historyById');
    });

    test('sets errorMessagePostfix with resource type and id', async () => {
        const op = new HistoryByIdOperation();
        await op.historyByIdAsync({
            requestInfo: {},
            parsedArgs: { id: 'obs-456' },
            resourceType: 'Observation'
        });
        expect(op.errorMessagePostfix).toBe('for Observation/obs-456');
    });

    test('calls fetchHistoryAsync with correct params', async () => {
        const op = new HistoryByIdOperation();
        const requestInfo = { userRequestId: 'req-1' };
        const parsedArgs = { id: 'enc-789' };
        await op.historyByIdAsync({ requestInfo, parsedArgs, resourceType: 'Encounter' });
        expect(op._lastFetchParams).toEqual({ requestInfo, parsedArgs, resourceType: 'Encounter' });
    });

    test('returns result from fetchHistoryAsync', async () => {
        const op = new HistoryByIdOperation();
        const result = await op.historyByIdAsync({
            requestInfo: {},
            parsedArgs: { id: '1' },
            resourceType: 'Patient'
        });
        expect(result.resourceType).toBe('Bundle');
    });
});
