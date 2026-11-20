const { describe, test, expect, afterEach, jest } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');
const { WritePipelineSwitch } = require('../../../../operations/writePipeline/writePipelineSwitch');

describe('WritePipelineSwitch', () => {
    const original = process.env.WRITE_PIPELINE_OPERATIONS;
    afterEach(() => {
        if (original === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = original;
        }
        jest.restoreAllMocks();
    });
    /**
     * Builds a switch on a new `ConfigManager`, which reads the current environment.
     */
    const createSwitch = () => new WritePipelineSwitch({ configManager: new ConfigManager() });

    test.each([
        { value: undefined, operation: 'merge', expected: false },
        { value: '', operation: 'merge', expected: false },
        { value: 'merge', operation: 'merge', expected: true },
        { value: 'merge', operation: 'create', expected: false },
        { value: ' create , merge ', operation: 'merge', expected: true }
    ])('useNewPathFor($operation) with "$value" is $expected', ({ value, operation, expected }) => {
        if (value === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = value;
        }
        expect(createSwitch().useNewPathFor(operation)).toBe(expected);
    });

    test('assertValidConfiguration rejects an unknown operation', () => {
        process.env.WRITE_PIPELINE_OPERATIONS = 'merge,bogus';
        expect(() => createSwitch().assertValidConfiguration()).toThrow(
            'WRITE_PIPELINE_OPERATIONS has unknown operation(s): bogus. Allowed: create, update, patch, merge, import, admin'
        );
    });
});
