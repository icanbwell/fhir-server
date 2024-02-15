const old1 = require('./fixtures/old1.json');
const new1 = require('./fixtures/new1.json');
const expected1 = require('./fixtures/expected1.json');
const { mergeObject } = require('../../../../utils/mergeHelper');
const { describe, test, expect } = require('@jest/globals');

describe('mergeHelper Tests', () => {
    describe('mergeHelper Tests', () => {
        test('mergeHelper works', () => {
            const result = mergeObject(old1, new1);
            expect(result).toStrictEqual(expected1);
        });
    });
});
