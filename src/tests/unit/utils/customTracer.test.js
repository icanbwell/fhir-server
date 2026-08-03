'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

const mockSpan = { end: jestObj.fn() };
const mockStartActiveSpan = jestObj.fn((name, fn) => fn(mockSpan));
jestObj.mock('@opentelemetry/api', () => ({
    trace: {
        getTracer: jestObj.fn(() => ({
            startActiveSpan: mockStartActiveSpan
        }))
    }
}));

const { CustomTracer } = require('../../../utils/customTracer');

describe('CustomTracer', () => {
    test('constructor creates otelTracer', () => {
        const tracer = new CustomTracer();
        expect(tracer.otelTracer).toBeDefined();
        expect(tracer.otelTracer.startActiveSpan).toBeDefined();
    });

    test('trace wraps async function in span', async () => {
        const tracer = new CustomTracer();
        const result = await tracer.trace({
            name: 'test-span',
            func: async () => 'hello'
        });

        expect(result).toBe('hello');
        expect(mockStartActiveSpan).toHaveBeenCalledWith('test-span', expect.any(Function));
        expect(mockSpan.end).toHaveBeenCalled();
    });

    test('trace ends span even on error', async () => {
        const tracer = new CustomTracer();
        mockSpan.end.mockClear();

        await expect(tracer.trace({
            name: 'fail-span',
            func: async () => { throw new Error('boom'); }
        })).rejects.toThrow('boom');

        expect(mockSpan.end).toHaveBeenCalled();
    });

    test('traceSync wraps synchronous function in span', () => {
        const tracer = new CustomTracer();
        const result = tracer.traceSync({
            name: 'sync-span',
            func: () => 42
        });

        expect(result).toBe(42);
        expect(mockSpan.end).toHaveBeenCalled();
    });

    test('traceSync ends span even on error', () => {
        const tracer = new CustomTracer();
        mockSpan.end.mockClear();

        expect(() => tracer.traceSync({
            name: 'sync-fail',
            func: () => { throw new Error('sync boom'); }
        })).toThrow('sync boom');

        expect(mockSpan.end).toHaveBeenCalled();
    });
});
