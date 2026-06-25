'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    W3CTraceContextPropagator,
    W3CBaggagePropagator,
    CompositePropagator
} = require('@opentelemetry/core');

/**
 * Tests that verify the OTel propagator configuration uses W3C TraceContext only
 * and does NOT include B3 headers (EA-2307).
 *
 * The manual SDK path in otel_instrumentation.js configures:
 *   new CompositePropagator({
 *       propagators: [
 *           new W3CTraceContextPropagator(),
 *           new W3CBaggagePropagator()
 *       ]
 *   })
 *
 * These tests verify the propagator contract: fields() must include 'traceparent'
 * and must not include 'b3'.
 */
describe('OTel propagator — W3C TraceContext only (EA-2307)', () => {
    // GIVEN the propagators configured in otel_instrumentation.js (manual SDK path)
    const propagators = [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator()
    ];
    const composite = new CompositePropagator({ propagators });

    describe('composite propagator fields', () => {
        test('includes traceparent — W3C TraceContext header is present', () => {
            // GIVEN the composite W3C propagator
            // WHEN we inspect its fields
            const fields = composite.fields();

            // THEN traceparent must be present
            expect(fields).toContain('traceparent');
        });

        test('includes tracestate — W3C TraceContext state header is present', () => {
            // GIVEN the composite W3C propagator
            // WHEN we inspect its fields
            const fields = composite.fields();

            // THEN tracestate must be present
            expect(fields).toContain('tracestate');
        });

        test('does NOT include b3 — legacy B3 single-header is absent', () => {
            // GIVEN the composite W3C propagator
            // WHEN we inspect its fields
            const fields = composite.fields();

            // THEN b3 must NOT be present (EA-2307 retirement)
            expect(fields).not.toContain('b3');
        });

        test('does NOT include X-B3-TraceId — legacy B3 multi-header is absent', () => {
            // GIVEN the composite W3C propagator
            // WHEN we inspect its fields
            const fields = composite.fields();

            // THEN X-B3-TraceId must NOT be present
            expect(fields).not.toContain('X-B3-TraceId');
        });
    });

    describe.each([
        ['W3CTraceContextPropagator', new W3CTraceContextPropagator(), ['traceparent', 'tracestate'], []],
        ['W3CBaggagePropagator', new W3CBaggagePropagator(), ['baggage'], ['b3', 'X-B3-TraceId']]
    ])('%s fields contract', (name, propagator, expectedFields, forbiddenFields) => {
        test(`${name} injects expected fields`, () => {
            // GIVEN the individual propagator
            // WHEN we inspect its fields
            const fields = propagator.fields();

            // THEN all expected fields are present
            for (const field of expectedFields) {
                expect(fields).toContain(field);
            }
        });

        test(`${name} does not inject b3 or B3 multi-headers`, () => {
            // GIVEN the individual propagator
            // WHEN we inspect its fields
            const fields = propagator.fields();

            // THEN no B3 headers are present
            for (const field of forbiddenFields) {
                expect(fields).not.toContain(field);
            }
        });
    });

    describe('W3C inject produces traceparent header, not b3', () => {
        test('inject sets traceparent on the carrier', () => {
            // GIVEN an active root span context
            const { trace, context: otelContext } = require('@opentelemetry/api');
            const spanContext = {
                traceId: 'a'.repeat(32),
                spanId:  'b'.repeat(16),
                traceFlags: 1,
                isRemote: false
            };
            const ctx = trace.setSpanContext(otelContext.active(), spanContext);

            // WHEN we inject via the composite propagator
            const carrier = {};
            composite.inject(ctx, carrier, {
                set (c, key, value) { c[key] = value; }
            });

            // THEN traceparent is present and b3 is absent
            expect(carrier).toHaveProperty('traceparent');
            expect(carrier).not.toHaveProperty('b3');
        });

        test('inject does NOT set b3 header', () => {
            // GIVEN an active root span context
            const { trace, context: otelContext } = require('@opentelemetry/api');
            const spanContext = {
                traceId: 'c'.repeat(32),
                spanId:  'd'.repeat(16),
                traceFlags: 1,
                isRemote: false
            };
            const ctx = trace.setSpanContext(otelContext.active(), spanContext);

            // WHEN we inject via the composite propagator
            const carrier = {};
            composite.inject(ctx, carrier, {
                set (c, key, value) { c[key] = value; }
            });

            // THEN b3 is absent
            expect(Object.keys(carrier)).not.toContain('b3');
        });
    });
});
