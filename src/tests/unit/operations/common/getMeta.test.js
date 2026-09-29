'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

const MockMeta = class Meta { constructor(data) { Object.assign(this, data); } };

jestObj.mock('../../../../middleware/fhir/utils/schema.utils', () => ({
    resolveSchema: jestObj.fn((version, schema) => {
        if (schema === 'Meta') return MockMeta;
        return undefined;
    })
}));

const { getMeta } = require('../../../../operations/common/getMeta');
const { resolveSchema } = require('../../../../middleware/fhir/utils/schema.utils');

describe('getMeta', () => {
    test('returns Meta class for given version', () => {
        const Meta = getMeta('4_0_0');
        expect(Meta).toBe(MockMeta);
    });

    test('returned class can be instantiated', () => {
        const Meta = getMeta('4_0_0');
        const instance = new Meta({ versionId: '1', lastUpdated: '2023-01-01' });
        expect(instance.versionId).toBe('1');
    });

    test('calls resolveSchema with base_version and Meta', () => {
        getMeta('4_0_0');
        expect(resolveSchema).toHaveBeenCalledWith('4_0_0', 'Meta');
    });

    test('passes different version strings to resolveSchema', () => {
        getMeta('3_0_1');
        expect(resolveSchema).toHaveBeenCalledWith('3_0_1', 'Meta');
    });
});
