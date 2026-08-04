const { describe, test, expect, jest } = require('@jest/globals');

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logError: j.fn(),
        logDebug: j.fn(),
        logWarn: j.fn()
    };
});

const { computeSafeAccessTags } = require('../../../../operations/export/script/bulkDataExportRunner');
const { logWarn } = require('../../../../operations/common/logging');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

describe('computeSafeAccessTags (DCON-4805 S3 key injection fix)', () => {
    test('passes through plain alphanumeric access tags', () => {
        const metaSecurity = [
            { system: SecurityTagSystem.access, code: 'bwell' },
            { system: SecurityTagSystem.access, code: 'client-1' },
            { system: SecurityTagSystem.access, code: 'client_2' }
        ];
        expect(computeSafeAccessTags(metaSecurity, 'export-1')).toEqual(['bwell', 'client-1', 'client_2']);
    });

    test('ignores tags on a different system', () => {
        const metaSecurity = [
            { system: SecurityTagSystem.owner, code: 'bwell' },
            { system: SecurityTagSystem.access, code: 'client1' }
        ];
        expect(computeSafeAccessTags(metaSecurity, 'export-1')).toEqual(['client1']);
    });

    test('drops an access tag containing a path segment', () => {
        const metaSecurity = [
            { system: SecurityTagSystem.access, code: '../../etc' },
            { system: SecurityTagSystem.access, code: 'client1' }
        ];
        expect(computeSafeAccessTags(metaSecurity, 'export-1')).toEqual(['client1']);
        expect(logWarn).toHaveBeenCalledWith(
            expect.stringContaining('../../etc'),
            expect.objectContaining({ exportStatusId: 'export-1' })
        );
    });

    test('drops an access tag containing a slash', () => {
        const metaSecurity = [
            { system: SecurityTagSystem.access, code: 'client1/other-tenant' }
        ];
        expect(computeSafeAccessTags(metaSecurity, 'export-1')).toEqual([]);
    });

    test('returns an empty array when meta.security is null/undefined', () => {
        expect(computeSafeAccessTags(null, 'export-1')).toEqual([]);
        expect(computeSafeAccessTags(undefined, 'export-1')).toEqual([]);
    });
});
