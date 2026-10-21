'use strict';

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

describe('ConfigManager.enablePatientScopedBinary', () => {
    let original;

    beforeEach(() => {
        original = process.env.ENABLE_PATIENT_SCOPED_BINARY;
    });

    afterEach(() => {
        if (original === undefined) {
            delete process.env.ENABLE_PATIENT_SCOPED_BINARY;
        } else {
            process.env.ENABLE_PATIENT_SCOPED_BINARY = original;
        }
    });

    test('defaults to false when the env var is unset', () => {
        delete process.env.ENABLE_PATIENT_SCOPED_BINARY;
        expect(new ConfigManager().enablePatientScopedBinary).toBe(false);
    });

    test('is true when ENABLE_PATIENT_SCOPED_BINARY=1', () => {
        process.env.ENABLE_PATIENT_SCOPED_BINARY = '1';
        expect(new ConfigManager().enablePatientScopedBinary).toBe(true);
    });
});
