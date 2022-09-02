const input = require('./fixtures/input.json');
const { removeNull } = require('../../../utils/nullRemover');
const { describe, expect } = require('@jest/globals');

describe('nullRemover Tests', () => {
    describe('nullRemover Tests', () => {
        test('nullRemover works', () => {
            const result = removeNull(input);
            expect(result).toStrictEqual(input);
        });
    });
});
