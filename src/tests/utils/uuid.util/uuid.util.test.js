const { commonBeforeEach, commonAfterEach } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { generateUUIDv5, convertFromMongoUuid, convertToMongoUuid } = require('../../../utils/uid.util');

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
        test('uuid.util convertToMongoUuid works', async () => {
            const uuid = '007ae95f-1ce4-43af-a881-7eeff3fd264e';
            const mongoUuid = convertToMongoUuid(uuid);
            const uuid2 = convertFromMongoUuid(mongoUuid);
            expect(uuid2).toStrictEqual(uuid);
        });
    });
});
