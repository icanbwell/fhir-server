// test file
const enounter1 = require('./fixtures/Encounter/encounter1.json');
const enounter2 = require('./fixtures/Encounter/encounter2.json');
const careplan1 = require('./fixtures/CarePlan/careplan1.json');
const careplan2 = require('./fixtures/CarePlan/careplan2.json');
const medicationStatement1 = require('./fixtures/MedicationStatement/medicationstatement1.json');
const medicationStatement2 = require('./fixtures/MedicationStatement/medicationstatement2.json');
const task1 = require('./fixtures/Task/task1.json');
const task2 = require('./fixtures/Task/task2.json');
const observation1 = require('./fixtures/Observation/observation1.json');
const observation2 = require('./fixtures/Observation/observation2.json');
const verificationResult1 = require('./fixtures/VerificationResult/verificationresult1.json');
const verificationResult2 = require('./fixtures/VerificationResult/verificationresult2.json');
const person1 = require('./fixtures/Person/person1.json');
const person2 = require('./fixtures/Person/person2.json');
const coverage1 = require('./fixtures/Coverage/coverage1.json');
const coverage2 = require('./fixtures/Coverage/coverage2.json');
const eob1 = require('./fixtures/ExplanationOfBenefit/eob1.json');
const eob2 = require('./fixtures/ExplanationOfBenefit/eob2.json');
const allergyIntolerance1 = require('./fixtures/AllergyIntolerance/allergyintolerance1.json');
const allergyIntolerance2 = require('./fixtures/AllergyIntolerance/allergyintolerance2.json');
const allergyIntolerance3 = require('./fixtures/AllergyIntolerance/allergyintolerance3.json');
const allergyIntolerance4 = require('./fixtures/AllergyIntolerance/allergyintolerance4.json');
const procedure1 = require('./fixtures/Procedure/procedure1.json');
const procedure2 = require('./fixtures/Procedure/procedure2.json');

const {
    commonBeforeEach, commonAfterEach, createTestRequest, getHeaders, getHeadersWithAdmin, getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

const FAKE_TIMER_OPTIONS = {
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
};

describe('_sort field hardening tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('_sort recognizes raw period.start/period.end values without needing _periodStart/_periodEnd (Encounter)', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Encounter/$merge').send([enounter1, enounter2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // enounter1.period is 2014, enounter2.period is 2026 (see fixtures)
        resp = await request.get('/4_0_0/Encounter?_sort=period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['encounter-2014', 'encounter-2026']);

        resp = await request.get('/4_0_0/Encounter?_sort=-period.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['encounter-2026', 'encounter-2014']);
    });

    test('_sort recognizes CarePlan period.start/period.end via the generic period-type fallback', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/CarePlan/$merge').send([careplan1, careplan2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // careplan1.period is 2015, careplan2.period is 2027 (see fixtures)
        resp = await request.get('/4_0_0/CarePlan?_sort=period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2015', 'careplan-2027']);

        resp = await request.get('/4_0_0/CarePlan?_sort=-period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2027', 'careplan-2015']);
    });

    // CarePlan has two independently-declared Period-typed fields: the top-level 'period' (from
    // the 'date' search parameter) and the nested 'activity.detail.scheduledPeriod' (from the
    // 'activity-date' search parameter). The fixtures deliberately set these in reverse order of
    // each other (careplan-2015's nested period is later than careplan-2027's) so that sorting by
    // each field independently produces opposite orderings -- proving resolvePeriodBoundarySortField
    // resolves each dotted path on its own declared field, not by coincidence.
    test("_sort recognizes CarePlan's nested activity.detail.scheduledPeriod.start/.end independently from the top-level period field", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/CarePlan/$merge').send([careplan1, careplan2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // top-level period: careplan-2015 (2015) before careplan-2027 (2027)
        resp = await request.get('/4_0_0/CarePlan?_sort=period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2015', 'careplan-2027']);

        // nested activity.detail.scheduledPeriod: careplan-2027 (2020) before careplan-2015 (2025) -- reversed
        resp = await request.get('/4_0_0/CarePlan?_sort=activity.detail.scheduledPeriod.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2027', 'careplan-2015']);

        resp = await request.get('/4_0_0/CarePlan?_sort=-activity.detail.scheduledPeriod.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2015', 'careplan-2027']);
    });

    test('_sort recognizes MedicationStatement effectivePeriod.start/effectivePeriod.end via the generic period-type fallback', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/MedicationStatement/$merge')
            .send([medicationStatement1, medicationStatement2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // medicationStatement1.effectivePeriod is 2016, medicationStatement2.effectivePeriod is 2028 (see fixtures)
        resp = await request.get('/4_0_0/MedicationStatement?_sort=effectivePeriod.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['medicationstatement-2016', 'medicationstatement-2028']);

        resp = await request.get('/4_0_0/MedicationStatement?_sort=-effectivePeriod.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['medicationstatement-2028', 'medicationstatement-2016']);
    });

    test('_sort silently ignores fields that are not real search parameters instead of erroring', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/CarePlan/$merge').send([careplan1, careplan2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // a lone unrecognized field: request succeeds, no data is lost, order falls back to the default tie-breaker
        resp = await request.get('/4_0_0/CarePlan?_sort=totally.bogus.field&_bundle=1').set(getHeadersWithAdmin());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry.map(e => e.resource.id).sort()).toEqual(['careplan-2015', 'careplan-2027']);

        // an injection-shaped nested path probe: also dropped, not treated as a valid sort target
        resp = await request.get('/4_0_0/CarePlan?_sort=meta.extension.url.nested.field.that.does.not.exist&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry.map(e => e.resource.id).sort()).toEqual(['careplan-2015', 'careplan-2027']);

        // mixed with a real field: the unrecognized field is dropped, the real field still decides order
        resp = await request.get('/4_0_0/CarePlan?_sort=garbage.nested.nonexistent.field,period.start&_bundle=1')
            .set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2015', 'careplan-2027']);
    });

    test('_sort ignores the _id search-parameter code and the raw id field', async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/CarePlan/$merge').send([careplan1, careplan2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request.get('/4_0_0/CarePlan?_sort=_id&_bundle=1').set(getHeadersWithAdmin());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry.map(e => e.resource.id).sort()).toEqual(['careplan-2015', 'careplan-2027']);

        // the raw 'id' field resolves to the same ambiguous field as '_id' and must also be dropped
        resp = await request.get('/4_0_0/CarePlan?_sort=id&_bundle=1').set(getHeadersWithAdmin());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry.map(e => e.resource.id).sort()).toEqual(['careplan-2015', 'careplan-2027']);

        // mixed with a real field: _id is dropped, the real field still decides order
        resp = await request.get('/4_0_0/CarePlan?_sort=_id,-period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2027', 'careplan-2015']);
    });

    test("_sort resolves Task's _lastUpdated search-parameter code to meta.lastUpdated, but still ignores _id", async () => {
        const request = await createTestRequest();

        jest.useFakeTimers(FAKE_TIMER_OPTIONS);

        jest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
        let resp = await request.post('/4_0_0/Task/$merge').send(task1).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        jest.setSystemTime(new Date('2022-01-01T00:00:00Z'));
        resp = await request.post('/4_0_0/Task/$merge').send(task2).set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        jest.useRealTimers();

        resp = await request.get('/4_0_0/Task?_sort=_lastUpdated&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['task-first', 'task-second']);

        resp = await request.get('/4_0_0/Task?_sort=-_lastUpdated&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['task-second', 'task-first']);

        resp = await request.get('/4_0_0/Task?_sort=_id&_bundle=1').set(getHeadersWithAdmin());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry.map(e => e.resource.id).sort()).toEqual(['task-first', 'task-second']);
    });

    test("_sort resolves Observation's date search-parameter code to effectiveDateTime", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Observation/$merge').send([observation1, observation2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // observation1.effectiveDateTime is 2017, observation2.effectiveDateTime is 2029 (see fixtures)
        resp = await request.get('/4_0_0/Observation?_sort=date&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['observation-2017', 'observation-2029']);

        resp = await request.get('/4_0_0/Observation?_sort=-date&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['observation-2029', 'observation-2017']);
    });

    test("_sort recognizes VerificationResult's statusDate via the temporary custom-sort-field allowlist, though no search parameter declares that field", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/VerificationResult/$merge')
            .send([verificationResult1, verificationResult2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // verificationResult1.statusDate is 2021, verificationResult2.statusDate is 2023 (see fixtures)
        resp = await request.get('/4_0_0/VerificationResult?_sort=statusDate&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['verificationresult-1', 'verificationresult-2']);

        resp = await request.get('/4_0_0/VerificationResult?_sort=-statusDate&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['verificationresult-2', 'verificationresult-1']);
    });

    test("_sort recognizes Person's active via the temporary custom-sort-field allowlist, though no search parameter declares that field", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Person/$merge').send([person1, person2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // active ascending: false (0) before true (1)
        resp = await request.get('/4_0_0/Person?_sort=active&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['person-active-false', 'person-active-true']);

        resp = await request.get('/4_0_0/Person?_sort=-active&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['person-active-true', 'person-active-false']);
    });

    test("_sort recognizes CarePlan's created via the temporary custom-sort-field allowlist, though no search parameter declares that field", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/CarePlan/$merge').send([careplan1, careplan2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // careplan-2015.created is 2030, careplan-2027.created is 2010 (deliberately reversed vs. period)
        resp = await request.get('/4_0_0/CarePlan?_sort=created&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2027', 'careplan-2015']);

        resp = await request.get('/4_0_0/CarePlan?_sort=-created&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['careplan-2015', 'careplan-2027']);
    });

    test("_sort recognizes Coverage's period.start/period.end via the temporary custom-sort-field allowlist, since Coverage has no period-typed field declared", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Coverage/$merge').send([coverage1, coverage2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // coverage1.period is 2016, coverage2.period is 2028 (see fixtures)
        resp = await request.get('/4_0_0/Coverage?_sort=period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['coverage-2016', 'coverage-2028']);

        resp = await request.get('/4_0_0/Coverage?_sort=-period.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['coverage-2028', 'coverage-2016']);
    });

    test("_sort recognizes ExplanationOfBenefit's billablePeriod.start/billablePeriod.end via the temporary custom-sort-field allowlist, since billablePeriod is not declared as a period-typed field", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/ExplanationOfBenefit/$merge').send([eob1, eob2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // eob1.billablePeriod is 2017, eob2.billablePeriod is 2029 (see fixtures)
        resp = await request.get('/4_0_0/ExplanationOfBenefit?_sort=billablePeriod.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['eob-2017', 'eob-2029']);

        resp = await request.get('/4_0_0/ExplanationOfBenefit?_sort=-billablePeriod.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['eob-2029', 'eob-2017']);
    });

    test("_sort recognizes AllergyIntolerance's onsetDateTime via the temporary custom-sort-field allowlist, since only reaction.onset is declared for the 'onset' search parameter", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/AllergyIntolerance/$merge')
            .send([allergyIntolerance1, allergyIntolerance2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // allergyIntolerance1.onsetDateTime is 2018, allergyIntolerance2.onsetDateTime is 2030 (see fixtures)
        resp = await request.get('/4_0_0/AllergyIntolerance?_sort=onsetDateTime&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['allergyintolerance-2018', 'allergyintolerance-2030']);

        resp = await request.get('/4_0_0/AllergyIntolerance?_sort=-onsetDateTime&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['allergyintolerance-2030', 'allergyintolerance-2018']);
    });

    test("_sort recognizes AllergyIntolerance's onsetPeriod.start/onsetPeriod.end via the temporary custom-sort-field allowlist, since AllergyIntolerance has no period-typed field declared", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/AllergyIntolerance/$merge')
            .send([allergyIntolerance3, allergyIntolerance4]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // allergyIntolerance3.onsetPeriod is 2019, allergyIntolerance4.onsetPeriod is 2031 (see fixtures)
        resp = await request.get('/4_0_0/AllergyIntolerance?_sort=onsetPeriod.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['allergyintolerance-onsetperiod-2019', 'allergyintolerance-onsetperiod-2031']);

        resp = await request.get('/4_0_0/AllergyIntolerance?_sort=-onsetPeriod.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['allergyintolerance-onsetperiod-2031', 'allergyintolerance-onsetperiod-2019']);
    });

    // Procedure.encounter is a Reference, and the generated Reference class (src/fhir/classes/
    // 4_0_0/complex_types/reference.js) silently drops any 'period' property on construction, so
    // $merge can never populate encounter.period.start/.end. To prove the custom-sort-field
    // resolution itself works against whatever ends up in Mongo (regardless of how it got there),
    // this test writes the fixtures via $merge first, then sets encounter.period directly on the
    // persisted documents with a raw Mongo update.
    test("_sort recognizes Procedure's encounter.period.start/encounter.period.end via the temporary custom-sort-field allowlist, since encounter is a Reference and has no period field", async () => {
        const request = await createTestRequest();

        let resp = await request.post('/4_0_0/Procedure/$merge').send([procedure1, procedure2]).set(getHeaders());
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        const container = getTestContainer();
        const fhirDb = await container.mongoDatabaseManager.getClientDbAsync();
        const procedureCollection = fhirDb.collection('Procedure_4_0_0');

        // procedure-encounter-2020's encounter.period is 2020, procedure-encounter-2032's is 2032
        await procedureCollection.updateOne(
            { id: 'procedure-encounter-2020' },
            { $set: { 'encounter.period': { start: '2020-06-19T01:15:45+00:00', end: '2020-06-19T01:30:45+00:00' } } }
        );
        await procedureCollection.updateOne(
            { id: 'procedure-encounter-2032' },
            { $set: { 'encounter.period': { start: '2032-06-19T01:15:45+00:00', end: '2032-06-19T01:30:45+00:00' } } }
        );

        resp = await request.get('/4_0_0/Procedure?_sort=encounter.period.start&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['procedure-encounter-2020', 'procedure-encounter-2032']);

        resp = await request.get('/4_0_0/Procedure?_sort=-encounter.period.end&_bundle=1').set(getHeadersWithAdmin());
        expect(resp.body.entry.map(e => e.resource.id)).toEqual(['procedure-encounter-2032', 'procedure-encounter-2020']);
    });
});
