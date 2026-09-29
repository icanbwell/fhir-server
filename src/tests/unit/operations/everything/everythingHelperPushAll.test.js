const { describe, test, expect, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/metrics', () => ({ recordOutboundEverything: jest.fn() }));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const { pushAll } = require('../../../../operations/everything/everythingHelper');

describe('pushAll', () => {
    test('appends every element of source onto target, preserving order', () => {
        const target = [1, 2];
        pushAll(target, [3, 4, 5]);
        expect(target).toEqual([1, 2, 3, 4, 5]);
    });

    test('leaves target unchanged when source is undefined', () => {
        const target = [1, 2];
        pushAll(target, undefined);
        expect(target).toEqual([1, 2]);
    });

    test('leaves target unchanged when source is an empty array', () => {
        const target = [1, 2];
        pushAll(target, []);
        expect(target).toEqual([1, 2]);
    });

    test('does not throw RangeError for arrays larger than the JS engine call-argument limit', () => {
        const target = [];
        const huge = new Array(200000).fill(0);
        expect(() => pushAll(target, huge)).not.toThrow();
        expect(target.length).toBe(200000);
    });

    test('a naive spread push throws for the same size that pushAll handles safely', () => {
        const target = [];
        const huge = new Array(200000).fill(0);
        expect(() => target.push(...huge)).toThrow(RangeError);
    });
});
