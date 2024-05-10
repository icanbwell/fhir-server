const input = require('./fixtures/input.json');
const expected = require('./fixtures/expected.json');
const { removeNull } = require('../../../utils/nullRemover');
const { describe, test, expect } = require('@jest/globals');

describe('nullRemover Tests', () => {
    describe('nullRemover Tests', () => {
        test('nullRemover works', () => {
            const result = removeNull(input);
            expect(result).toStrictEqual(expected);
        });
    });
});
