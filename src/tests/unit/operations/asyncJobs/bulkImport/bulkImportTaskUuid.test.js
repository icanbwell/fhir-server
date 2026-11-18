const { describe, test, expect } = require('@jest/globals');
const { getBulkImportTaskUuid } = require('../../../../../operations/asyncJobs/bulkImport/bulkImportTaskUuid');
const { generateUUIDv5, isUuid } = require('../../../../../utils/uid.util');

describe('getBulkImportTaskUuid', () => {
    test('returns a uuid id unchanged', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        expect(getBulkImportTaskUuid(id)).toBe(id);
    });

    test('hashes a non-uuid id with the bwell authority, deterministically', () => {
        const result = getBulkImportTaskUuid('import-job-1');
        expect(result).toBe(generateUUIDv5('import-job-1|bwell'));
        expect(isUuid(result)).toBe(true);
        expect(getBulkImportTaskUuid('import-job-1')).toBe(result);
        expect(getBulkImportTaskUuid('import-job-2')).not.toBe(result);
    });
});
