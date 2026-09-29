'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/isTrue', () => ({
    isTrue: jestObj.fn((val) => val === 'true' || val === true)
}));

const { PreSaveOptions } = require('../../../preSaveHandlers/preSaveOptions');

describe('PreSaveOptions', () => {
    test('constructor sets suppressUnclassifiedTag', () => {
        const opts = new PreSaveOptions({ suppressUnclassifiedTag: true });
        expect(opts.suppressUnclassifiedTag).toBe(true);
    });

    test('constructor defaults suppressUnclassifiedTag to undefined', () => {
        const opts = new PreSaveOptions();
        expect(opts.suppressUnclassifiedTag).toBeUndefined();
    });

    describe('fromRequestInfo', () => {
        test('returns PreSaveOptions with suppressUnclassifiedTag from header', () => {
            const requestInfo = {
                headers: { 'x-suppress-unclassified-tag': 'true' }
            };
            const opts = PreSaveOptions.fromRequestInfo(requestInfo);
            expect(opts).toBeInstanceOf(PreSaveOptions);
            expect(opts.suppressUnclassifiedTag).toBe(true);
        });

        test('returns PreSaveOptions with false when header is absent', () => {
            const requestInfo = { headers: {} };
            const opts = PreSaveOptions.fromRequestInfo(requestInfo);
            expect(opts.suppressUnclassifiedTag).toBeFalsy();
        });

        test('returns default PreSaveOptions when requestInfo is null', () => {
            const opts = PreSaveOptions.fromRequestInfo(null);
            expect(opts).toBeInstanceOf(PreSaveOptions);
            expect(opts.suppressUnclassifiedTag).toBeUndefined();
        });

        test('returns default PreSaveOptions when requestInfo is undefined', () => {
            const opts = PreSaveOptions.fromRequestInfo(undefined);
            expect(opts).toBeInstanceOf(PreSaveOptions);
        });
    });
});
