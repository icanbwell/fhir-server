// Fixture provenance: the JSON files under ./fixtures/ (basic.json,
// fn_reference_keys.json, where.json) are vendored verbatim from the upstream
// HL7 SQL-on-FHIR v2 conformance test suite, repo `FHIR/sql-on-fhir-v2`, from
// branch `intro-update` at the time of vendoring, which resolved to immutable
// commit `e5345f64ff7df8214f9c39cdfa82841630d9f78b`
// (https://github.com/FHIR/sql-on-fhir-v2/commit/e5345f64ff7df8214f9c39cdfa82841630d9f78b).
// Re-vendor from that SHA (not the branch) if the fixtures ever need refreshing.
const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('@jest/globals');
const { runView } = require('../../operations/sqlOnFhir/viewRunner');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

const fhirPathEvaluator = new FhirPathEvaluator();
const fixturesDir = path.join(__dirname, 'fixtures');

async function collect(view, resources) {
    const rows = [];
    for await (const row of runView(view, resources, { fhirPathEvaluator })) {
        rows.push(row);
    }
    return rows;
}

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

describe('SQL-on-FHIR v2 conformance fixtures', () => {
    for (const file of files) {
        const suite = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
        describe(file, () => {
            for (const t of suite.tests) {
                // Some official cases assert errors (expectError) or counts (expectCount);
                // those are exercised by the hand-written unit tests. Skip and log here.
                const runner = t.expect ? test : test.skip;
                runner(t.title, async () => {
                    const rows = await collect(t.view, suite.resources);
                    expect(rows).toEqual(t.expect);
                });
            }
        });
    }
});
