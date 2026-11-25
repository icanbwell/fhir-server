'use strict';

const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');

jest.mock('../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));

const { logWarn } = require('../../../operations/common/logging');
const { ConfigManager } = require('../../../utils/configManager');

const KEYS = [
    'BASE64_FIELD_CLOUD_STORAGE_ENABLED',
    'BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED'
];

describe('ConfigManager.enableBase64FieldCloudStorageForDocumentReference', () => {
    let saved;

    beforeEach(() => {
        saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
        KEYS.forEach((k) => delete process.env[k]);
        logWarn.mockClear();
    });

    afterEach(() => {
        KEYS.forEach((k) => {
            if (saved[k] === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = saved[k];
            }
        });
    });

    test.each([
        ['both off', undefined, undefined, false, 0],
        ['only the base64 feature on', '1', undefined, false, 0],
        ['only the DocumentReference flag on (ignored, warns)', undefined, '1', false, 1],
        ['both on', '1', '1', true, 0]
    ])('%s', (_name, base64Enabled, documentReferenceEnabled, expected, warnings) => {
        if (base64Enabled) process.env.BASE64_FIELD_CLOUD_STORAGE_ENABLED = base64Enabled;
        if (documentReferenceEnabled) {
            process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED = documentReferenceEnabled;
        }
        const configManager = new ConfigManager();

        expect(configManager.enableBase64FieldCloudStorageForDocumentReference).toBe(expected);
        expect(logWarn).toHaveBeenCalledTimes(warnings);
    });

    test('warns only once however often the flag is read', () => {
        process.env.BASE64_FIELD_CLOUD_STORAGE_DOCUMENT_REFERENCE_ENABLED = '1';
        const configManager = new ConfigManager();

        for (let i = 0; i < 5; i++) {
            expect(configManager.enableBase64FieldCloudStorageForDocumentReference).toBe(false);
        }

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(logWarn.mock.calls[0])).toContain(
            'BASE64_FIELD_CLOUD_STORAGE_ENABLED is off'
        );
    });
});
