const {commonBeforeEach, commonAfterEach} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
// const {sanitizeMiddleware} = require('../../../middleware/fhir/utils/sanitize.utils');

describe('Sanitize Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('sanitize.util Tests', () => {
        test('sanitize.util generateUUIDv5 works', async () => {
            // const text = '2354|A';
        });
    });
});
