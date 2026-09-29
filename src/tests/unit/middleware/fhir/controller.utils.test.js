'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../middleware/fhir/4_0_0/controllers/generic.controller', () => ({
    GenericController: class GenericController {}
}));

const { ControllerUtils } = require('../../../../middleware/fhir/controller.utils');

describe('ControllerUtils', () => {
    const mockController = { search: jestObj.fn(), create: jestObj.fn() };

    test('stores genericController', () => {
        const utils = new ControllerUtils({ genericController: mockController });
        expect(utils.genericController).toBe(mockController);
    });

    test('getController returns genericController for version 4_0_0', () => {
        const utils = new ControllerUtils({ genericController: mockController });
        expect(utils.getController('4_0_0', 'Patient')).toBe(mockController);
    });

    test('getController returns genericController regardless of resourceName', () => {
        const utils = new ControllerUtils({ genericController: mockController });
        expect(utils.getController('4_0_0', 'Observation')).toBe(mockController);
        expect(utils.getController('4_0_0', 'Encounter')).toBe(mockController);
    });

    test('getController returns undefined for unsupported version', () => {
        const utils = new ControllerUtils({ genericController: mockController });
        expect(utils.getController('3_0_1', 'Patient')).toBeUndefined();
        expect(utils.getController('1_0_2', 'Patient')).toBeUndefined();
    });
});
