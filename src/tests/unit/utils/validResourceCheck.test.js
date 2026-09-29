'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../constants', () => ({
    COLLECTION: {
        Patient_4_0_0: 'Patient_4_0_0',
        Observation_4_0_0: 'Observation_4_0_0'
    }
}));

const { isValidResource } = require('../../../utils/validResourceCheck');

describe('validResourceCheck', () => {
    test('returns true for a known collection name', () => {
        expect(isValidResource('Patient_4_0_0')).toBe(true);
    });

    test('returns true for another known collection name', () => {
        expect(isValidResource('Observation_4_0_0')).toBe(true);
    });

    test('returns false for an unknown collection name', () => {
        expect(isValidResource('UnknownResource_4_0_0')).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(isValidResource('')).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(isValidResource(undefined)).toBe(false);
    });

    test('returns false for null', () => {
        expect(isValidResource(null)).toBe(false);
    });

    test('returns false for partial match', () => {
        expect(isValidResource('Patient')).toBe(false);
    });
});
