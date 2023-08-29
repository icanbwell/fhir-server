const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {commonBeforeEach, commonAfterEach} = require('../../common');
const {BM25} = require('../../../utils/bm25');
describe('bm25 Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('bm25 works', async () => {
        const docs = [
            'The quick brown fox',
            'The lazy dog',
            'The brown dog and the quick fox'
        ];
        const bm25 = new BM25(docs);
        const data = bm25.rank('quick fox');
        console.log(data);
    });
});
