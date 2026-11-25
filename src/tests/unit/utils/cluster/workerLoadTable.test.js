'use strict';

const { describe, test, expect } = require('@jest/globals');
const { WorkerLoadTable } = require('../../../../utils/cluster/workerLoadTable');

const REPORT_INTERVAL_MS = 25;

const report = (inFlight, connectionsReceived = 0) => ({ inFlight, connectionsReceived });

/**
 * @param {Array<[number, ReturnType<typeof report>]>} entries
 * @param {{now: number}} [clock]
 */
const tableWith = (entries, clock = { now: 1000 }) => {
    const table = new WorkerLoadTable({
        reportIntervalMs: REPORT_INTERVAL_MS,
        blockedMsPerRequest: 10,
        now: () => clock.now
    });
    for (const [workerId, workerReport] of entries) {
        table.addWorker(workerId);
        table.recordReport(workerId, workerReport);
    }
    return table;
};

describe('WorkerLoadTable', () => {
    test.each([
        // [name, reports, connections dispatched to worker 1 since its report, expected worker]
        [
            'fewest in-flight requests',
            [
                [1, report(3)],
                [2, report(1)],
                [3, report(2)]
            ],
            0,
            2
        ],
        [
            'connections not yet received count against a worker',
            [
                [1, report(0)],
                [2, report(1)]
            ],
            2,
            2
        ],
        [
            'connections already received do not count twice',
            [
                [1, report(1, 2)],
                [2, report(2)]
            ],
            2,
            1
        ]
    ])(
        'picks the worker with the lowest score: %s',
        (_name, entries, dispatchedToWorker1, expected) => {
            const table = tableWith(entries);
            for (let i = 0; i < dispatchedToWorker1; i++) {
                table.recordDispatch(1);
            }

            expect(table.pickWorkerId(() => 0)).toBe(expected);
        }
    );

    test.each([
        // [name, ms since worker 1's last report, expected worker]
        ['a report that is not yet due does not count', REPORT_INTERVAL_MS, 1],
        ['an overdue report counts as blocked time', REPORT_INTERVAL_MS + 30, 2]
    ])('%s', (_name, elapsedMs, expected) => {
        const clock = { now: 1000 };
        // worker 1 was idle at its last report; worker 2 has 2 in-flight requests and keeps reporting
        const table = tableWith(
            [
                [1, report(0)],
                [2, report(2)]
            ],
            clock
        );
        clock.now += elapsedMs;
        table.recordReport(2, report(2));

        expect(table.pickWorkerId(() => 0)).toBe(expected);
    });

    test('a blocked worker is preferred again once it reports', () => {
        const clock = { now: 1000 };
        const table = tableWith(
            [
                [1, report(0)],
                [2, report(2)]
            ],
            clock
        );
        clock.now += 200;
        table.recordReport(2, report(2));
        expect(table.pickWorkerId(() => 0)).toBe(2);

        table.recordReport(1, report(0));

        expect(table.pickWorkerId(() => 0)).toBe(1);
    });

    test('spreads a burst of connections that arrives between two reports', () => {
        const table = tableWith([
            [1, report(0)],
            [2, report(0)],
            [3, report(0)]
        ]);
        const picks = [];

        for (let i = 0; i < 6; i++) {
            const workerId = table.pickWorkerId(() => 0);
            table.recordDispatch(workerId);
            picks.push(workerId);
        }

        expect(picks.sort()).toEqual([1, 1, 2, 2, 3, 3]);
    });

    test('breaks ties at random', () => {
        const table = tableWith([
            [1, report(0)],
            [2, report(0)],
            [3, report(0)]
        ]);

        expect([0, 0.4, 0.99].map((r) => table.pickWorkerId(() => r))).toEqual([1, 2, 3]);
    });

    test.each([
        ['has not reported since it was (re)registered', (table) => table.addWorker(1)],
        ['is draining', (table) => table.markDraining(1)],
        ['was removed', (table) => table.removeWorker(1)]
    ])('skips a worker that %s', (_name, mutate) => {
        const table = tableWith([
            [1, report(0)],
            [2, report(5)]
        ]);

        mutate(table);

        expect(table.pickWorkerId(() => 0)).toBe(2);
    });

    test('returns null when no worker can take a connection', () => {
        const table = tableWith([[1, report(0)]]);
        table.markDraining(1);
        table.addWorker(2);

        expect(table.pickWorkerId()).toBeNull();
    });

    test.each([
        ['null', null],
        ['negative in-flight', { inFlight: -1, connectionsReceived: 0 }],
        ['NaN count', { inFlight: 0, connectionsReceived: NaN }],
        ['missing field', { inFlight: 0 }],
        ['string field', { inFlight: '1', connectionsReceived: 0 }]
    ])('ignores an invalid report (%s) and keeps the worker not ready', (_name, badReport) => {
        const table = tableWith([]);
        table.addWorker(1);

        const applied = table.recordReport(1, badReport);

        expect(applied).toBe(false);
        expect(table.pickWorkerId()).toBeNull();
    });

    test('ignores a report for an unknown worker', () => {
        const table = tableWith([]);

        expect(table.recordReport(7, report(0))).toBe(false);
        expect(table.size()).toBe(0);
    });

    test.each([
        ['report interval', { reportIntervalMs: 0, blockedMsPerRequest: 10 }, 'reportIntervalMs'],
        ['blocked weight', { reportIntervalMs: 25, blockedMsPerRequest: 0 }, 'blockedMsPerRequest']
    ])('rejects a non-positive %s', (_name, params, message) => {
        expect(() => new WorkerLoadTable(params)).toThrow(message);
    });
});
