'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

jestObj.mock('../../../../../middleware/fhir/utils/params.utils', () => ({
    getSearchParameters: jestObj.fn()
}));

const { getSearchParams } = require('../../../../../middleware/fhir/utils/conformance.utils');
const { getSearchParameters } = require('../../../../../middleware/fhir/utils/params.utils');

describe('conformance.utils - getSearchParams', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();
    });

    test('filters out params with conformance_hide set to true', () => {
        getSearchParameters.mockReturnValue([
            { name: 'visible', type: 'string', definition: '/def1', description: 'desc1' },
            { name: 'hidden', type: 'token', definition: '/def2', description: 'desc2', conformance_hide: true }
        ]);

        const result = getSearchParams('Patient', '4_0_0');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('visible');
    });

    test('filters by version when versions property is present', () => {
        getSearchParameters.mockReturnValue([
            { name: 'param1', type: 'string', definition: '/def1', description: 'desc1', versions: '4_0_0' },
            { name: 'param2', type: 'token', definition: '/def2', description: 'desc2', versions: '3_0_1' }
        ]);

        const result = getSearchParams('Patient', '4_0_0');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('param1');
    });

    test('includes params without versions property (available for all versions)', () => {
        getSearchParameters.mockReturnValue([
            { name: 'universal', type: 'string', definition: '/def1', description: 'desc1' },
            { name: 'versioned', type: 'token', definition: '/def2', description: 'desc2', versions: '4_0_0' }
        ]);

        const result = getSearchParams('Patient', '4_0_0');
        expect(result).toHaveLength(2);
    });

    test('removes versions property from returned params', () => {
        getSearchParameters.mockReturnValue([
            { name: 'param1', type: 'string', definition: '/def1', description: 'desc1', versions: '4_0_0' }
        ]);

        const result = getSearchParams('Patient', '4_0_0');
        expect(result[0].versions).toBeUndefined();
    });

    test('passes profileKey and version to getSearchParameters', () => {
        getSearchParameters.mockReturnValue([]);

        getSearchParams('Observation', '4_0_0');
        expect(getSearchParameters).toHaveBeenCalledWith('Observation', '4_0_0');
    });

    test('returns empty array when getSearchParameters returns empty array', () => {
        getSearchParameters.mockReturnValue([]);

        const result = getSearchParams('Patient', '4_0_0');
        expect(result).toEqual([]);
    });

    test('conformance_hide false does not filter out param', () => {
        getSearchParameters.mockReturnValue([
            { name: 'param1', type: 'string', definition: '/def1', description: 'desc1', conformance_hide: false }
        ]);

        const result = getSearchParams('Patient', '4_0_0');
        expect(result).toHaveLength(1);
    });

    test('params with versions containing the base_version are included', () => {
        getSearchParameters.mockReturnValue([
            { name: 'param1', type: 'string', definition: '/def1', description: 'desc1', versions: '4_0_0,3_0_1' }
        ]);

        const result = getSearchParams('Patient', '4_0_0');
        // versions string uses indexOf, so '4_0_0' is found in '4_0_0,3_0_1'
        expect(result).toHaveLength(1);
    });
});
