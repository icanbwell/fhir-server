'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    readClusterSchedulingConfig
} = require('../../../../utils/cluster/clusterSchedulingConfig');

describe('readClusterSchedulingConfig', () => {
    test.each([
        ['defaults', {}, { policy: 'round_robin', reportIntervalMs: 25, blockedMsPerRequest: 10 }],
        [
            'empty strings use defaults',
            { CLUSTER_SCHEDULING: '', CLUSTER_LOAD_REPORT_INTERVAL_MS: '' },
            { policy: 'round_robin', reportIntervalMs: 25, blockedMsPerRequest: 10 }
        ],
        [
            'least busy with overrides',
            {
                CLUSTER_SCHEDULING: 'least_busy',
                CLUSTER_LOAD_REPORT_INTERVAL_MS: '250',
                CLUSTER_BLOCKED_MS_PER_REQUEST: '20'
            },
            { policy: 'least_busy', reportIntervalMs: 250, blockedMsPerRequest: 20 }
        ]
    ])('reads %s', (_name, env, expected) => {
        expect(readClusterSchedulingConfig(env)).toEqual(expected);
    });

    test.each([
        ['unknown policy', { CLUSTER_SCHEDULING: 'leastbusy' }, 'CLUSTER_SCHEDULING'],
        [
            'zero interval',
            { CLUSTER_LOAD_REPORT_INTERVAL_MS: '0' },
            'CLUSTER_LOAD_REPORT_INTERVAL_MS'
        ],
        [
            'fractional interval',
            { CLUSTER_LOAD_REPORT_INTERVAL_MS: '1.5' },
            'CLUSTER_LOAD_REPORT_INTERVAL_MS'
        ],
        [
            'non-numeric blocked weight',
            { CLUSTER_BLOCKED_MS_PER_REQUEST: 'ten' },
            'CLUSTER_BLOCKED_MS_PER_REQUEST'
        ]
    ])('fails fast on %s', (_name, env, variable) => {
        expect(() => readClusterSchedulingConfig(env)).toThrow(variable);
    });
});
