'use strict';

const { EventEmitter } = require('events');
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// The OTel meter is process-wide ambient (see metrics.js docstring), so the only honest
// seam is the @opentelemetry/api boundary. Unlike metrics.test.js's shared-instrument
// mock, this keys instruments by name so a test can assert WHICH instrument was hit.
jest.mock('@opentelemetry/api', () => {
    const counters = {};
    const histograms = {};
    return {
        metrics: {
            getMeter: () => ({
                createCounter: (name) => {
                    counters[name] = counters[name] || { add: jest.fn() };
                    return counters[name];
                },
                createHistogram: (name) => {
                    histograms[name] = histograms[name] || { record: jest.fn() };
                    return histograms[name];
                }
            })
        },
        __counters: counters,
        __histograms: histograms
    };
});

const { __counters, __histograms } = require('@opentelemetry/api');
const { registerMongoPoolMonitoring } = require('../../../utils/mongoPoolMonitor');

const CHECKOUT_DURATION = 'fhir_mongo_pool_checkout_duration_seconds';
const CHECKOUT_FAILED = 'fhir_mongo_pool_checkout_failed_total';
const POOL_CLEARED = 'fhir_mongo_pool_cleared_total';
const CONNECTION_CREATED = 'fhir_mongo_pool_connection_created_total';

describe('registerMongoPoolMonitoring', () => {
    let client;

    beforeEach(() => {
        for (const counter of Object.values(__counters)) {
            counter.add.mockClear();
        }
        for (const histogram of Object.values(__histograms)) {
            histogram.record.mockClear();
        }
        // A real EventEmitter stands in for MongoClient: the driver emits CMAP events
        // through EventEmitter, so this exercises the real subscription path.
        client = new EventEmitter();
        registerMongoPoolMonitoring({ client, poolName: 'fhir' });
    });

    test('records connection checkout wait time in seconds', () => {
        client.emit('connectionCheckedOut', { durationMS: 13000 });

        expect(__histograms[CHECKOUT_DURATION].record).toHaveBeenCalledWith(13, { pool: 'fhir' });
    });

    test('records a fast checkout as sub-second, not rounded away', () => {
        client.emit('connectionCheckedOut', { durationMS: 250 });

        expect(__histograms[CHECKOUT_DURATION].record).toHaveBeenCalledWith(0.25, { pool: 'fhir' });
    });

    test('counts a failed checkout labelled with the driver reason', () => {
        client.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });

        expect(__counters[CHECKOUT_FAILED].add).toHaveBeenCalledWith(1, {
            pool: 'fhir',
            reason: 'timeout'
        });
    });

    test('maps an unrecognized failure reason to unknown to bound label cardinality', () => {
        client.emit('connectionCheckOutFailed', { reason: 'something-new-from-the-driver' });

        expect(__counters[CHECKOUT_FAILED].add).toHaveBeenCalledWith(1, {
            pool: 'fhir',
            reason: 'unknown'
        });
    });

    test('records the wait time of a failed checkout, which is otherwise invisible', () => {
        client.emit('connectionCheckOutFailed', { reason: 'timeout', durationMS: 30000 });

        expect(__histograms[CHECKOUT_DURATION].record).toHaveBeenCalledWith(30, { pool: 'fhir' });
    });

    test('counts pool clears, which signal the server was marked unknown', () => {
        client.emit('connectionPoolCleared', {});

        expect(__counters[POOL_CLEARED].add).toHaveBeenCalledWith(1, { pool: 'fhir' });
    });

    test('counts connections created, exposing pool churn', () => {
        client.emit('connectionCreated', {});

        expect(__counters[CONNECTION_CREATED].add).toHaveBeenCalledWith(1, { pool: 'fhir' });
    });

    test('does not record a checkout duration when the driver omits durationMS', () => {
        client.emit('connectionCheckedOut', {});

        expect(__histograms[CHECKOUT_DURATION].record).not.toHaveBeenCalled();
    });
});
