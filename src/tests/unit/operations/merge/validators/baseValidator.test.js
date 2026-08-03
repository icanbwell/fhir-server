'use strict';

const { describe, test, expect } = require('@jest/globals');
const { BaseValidator } = require('../../../../../operations/merge/validators/baseValidator');

describe('BaseValidator', () => {
    test('validate throws Not implemented error', async () => {
        const validator = new BaseValidator();
        await expect(validator.validate({
            requestInfo: {},
            incomingResources: [],
            base_version: '4_0_0',
            effectiveSmartMerge: false
        })).rejects.toThrow('Not implemented');
    });

    test('can be subclassed to override validate', async () => {
        class TestValidator extends BaseValidator {
            async validate () {
                return { preCheckErrors: [], validatedObjects: [], wasAList: false };
            }
        }
        const validator = new TestValidator();
        const result = await validator.validate({});
        expect(result.preCheckErrors).toEqual([]);
        expect(result.validatedObjects).toEqual([]);
        expect(result.wasAList).toBe(false);
    });
});
