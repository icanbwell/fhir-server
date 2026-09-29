'use strict';

const { describe, test, expect } = require('@jest/globals');
const { incrementRequestCount, decrementRequestCount, getRequestCount } = require('../../../utils/requestCounter');

describe('requestCounter', () => {
    test('incrementRequestCount increases count', () => {
        const before = getRequestCount();
        incrementRequestCount();
        expect(getRequestCount()).toBe(before + 1);
    });

    test('decrementRequestCount decreases count', () => {
        const before = getRequestCount();
        decrementRequestCount();
        expect(getRequestCount()).toBe(before - 1);
    });

    test('multiple increments accumulate', () => {
        const before = getRequestCount();
        incrementRequestCount();
        incrementRequestCount();
        incrementRequestCount();
        expect(getRequestCount()).toBe(before + 3);
    });

    test('getRequestCount returns a number', () => {
        expect(typeof getRequestCount()).toBe('number');
    });
});
