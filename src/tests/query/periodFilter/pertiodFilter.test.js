// test file
const enounter1 = require('./fixtures/Encounter/encounter1.json');
const enounter2 = require('./fixtures/Encounter/encounter2.json');

// expected
const expectedEncounterPeriodStartEq2020 = require('./fixtures/expected/encounter_periodstart_eq2020.json');
const expectedEncounterPeriodStartNe2020 = require('./fixtures/expected/encounter_periodstart_ne2020.json');
const expectedEncounterPeriodStartGt2020 = require('./fixtures/expected/encounter_periodstart_gt2020.json');
const expectedEncounterPeriodStartLt2020 = require('./fixtures/expected/encounter_periodstart_lt2020.json');
const expectedEncounterPeriodStartGe2020 = require('./fixtures/expected/encounter_periodstart_ge2020.json');
const expectedEncounterPeriodStartLe2020 = require('./fixtures/expected/encounter_periodstart_le2020.json');
const expectedEncounterPeriodStartSa2020 = require('./fixtures/expected/encounter_periodstart_sa2020.json');
const expectedEncounterPeriodStartEb2020 = require('./fixtures/expected/encounter_periodstart_eb2020.json');
const expectedEncounterPeriodStartAp2020 = require('./fixtures/expected/encounter_periodstart_ap2020.json');
const expectedEncounterPeriodEndgt2020 = require('./fixtures/expected/encounter_periodend_gt2020.json');
const expectedObservationPeriodStartEq2026 = require('./fixtures/expected/observation_effectivePeriodStart.json');

const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('Period start/end field search tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('encounter period start tests', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Encounter/$merge').send([enounter1, enounter2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request.get('/4_0_0/Encounter?_periodStart=eq2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartEq2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=ne2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartNe2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=gt2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartGt2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=lt2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartLt2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=ge2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartGe2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=le2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartLe2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=sa2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartSa2020);

        resp = await request.get('/4_0_0/Encounter?_periodStart=eb2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartEb2020);

        jest.useFakeTimers({
            doNotFake: [
                'hrtime',
                'nextTick',
                'performance',
                'queueMicrotask',
                'requestAnimationFrame',
                'cancelAnimationFrame',
                'requestIdleCallback',
                'cancelIdleCallback',
                'setImmediate',
                'clearImmediate',
                'setInterval',
                'clearInterval',
                'setTimeout',
                'clearTimeout'
            ]
        });
        jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

        resp = await request.get('/4_0_0/Encounter?_periodStart=ap2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodStartAp2020);

        jest.useRealTimers();

        resp = await request.get('/4_0_0/Encounter?_periodEnd=gt2020-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedEncounterPeriodEndgt2020);
    });

    test('observation effective period start tests', async () => {
        const request = await createTestRequest();

        let resp = await request.get('/4_0_0/Observation?_effectivePeriodStart=eq2026-01-01&_debug=1&_bundle=1').set(getHeaders());
        expect(resp).toHaveResponse(expectedObservationPeriodStartEq2026);
    });
});
