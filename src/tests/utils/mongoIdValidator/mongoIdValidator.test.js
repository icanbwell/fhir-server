const { isValidMongoObjectId } = require('../../../utils/mongoIdValidator');
const { describe, test, expect } = require('@jest/globals');

describe('mongoIdValidator Tests', () => {
    describe('mongoIdValidator Tests', () => {
        test('mongoIdValidator works', () => {
            expect(isValidMongoObjectId('6307c87743c5f18242934e05')).toStrictEqual(true);
            expect(isValidMongoObjectId('nppes-1891352894')).toStrictEqual(false);
            expect(isValidMongoObjectId('toptoptoptop')).toStrictEqual(false);
        });
    });
});
