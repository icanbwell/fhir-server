'use strict';

const { describe, test, expect, beforeAll, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../fhir/classes/4_0_0/resources/resource', () => class Resource {});

const { SourceIdColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceIdColumnHandler');

describe('SourceIdColumnHandler', () => {
    let handler;

    beforeAll(() => {
        handler = new SourceIdColumnHandler();
    });

    test('sets _sourceId to id when _sourceId is not set', async () => {
        const resource = { id: 'patient-123', resourceType: 'Patient' };
        const result = await handler.preSaveAsync({ resource });
        expect(result._sourceId).toBe('patient-123');
    });

    test('does not overwrite existing _sourceId', async () => {
        const resource = { id: 'new-id', _sourceId: 'original-id', resourceType: 'Patient' };
        const result = await handler.preSaveAsync({ resource });
        expect(result._sourceId).toBe('original-id');
    });

    test('removes identifiers with sourceId system', async () => {
        const resource = {
            id: '1',
            _sourceId: '1',
            identifier: [
                { system: 'https://www.icanbwell.com/sourceId', value: 'old' },
                { system: 'http://other.system', value: 'keep' }
            ]
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.identifier).toHaveLength(1);
        expect(result.identifier[0].system).toBe('http://other.system');
    });

    test('deletes empty identifier array for non-Resource instances', async () => {
        const resource = {
            id: '1',
            _sourceId: '1',
            identifier: [{ system: 'https://www.icanbwell.com/sourceId', value: 'x' }]
        };
        const result = await handler.preSaveAsync({ resource });
        expect(result.identifier).toBeUndefined();
    });

    test('returns the resource', async () => {
        const resource = { id: '1' };
        const result = await handler.preSaveAsync({ resource });
        expect(result).toBe(resource);
    });
});
