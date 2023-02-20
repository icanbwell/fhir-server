const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {generateUUIDv5} = require('../../../utils/uid.util');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('uuid.util Tests', () => {
        test('uuid.util generateUUIDv5 works', async () => {
            const text = '2354|A';
            const uuid = generateUUIDv5(text);
            expect(uuid).toStrictEqual('a28ad76e-41dd-5c0d-b52d-a5841690c3bd');
        });
    });
});
