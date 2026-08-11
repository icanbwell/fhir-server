'use strict';

/**
 * Regression tests for DCON-4962: PROA consented-data-access expansion
 * (`DataSharingManager.updateQueryConsideringDataSharing`) must remain scoped to
 * Person/Patient `$everything` only — never to plain FHIR search, the Patient instance-read
 * API (`GET /Patient/{id}`), or GraphQL.
 *
 * `SearchManager.constructQueryAsync` only performs the PROA expansion when its caller passes
 * `allowConsentedProaDataAccess: true` (it defaults to `false`). Rather than trust that claim,
 * this walks the actual `src/` tree (excluding `src/tests`) and asserts the exact, closed set
 * of files that pass `allowConsentedProaDataAccess: true`. If a future change wires this flag
 * into `searchBundle.js`, `searchById.js`, `searchStreaming.js`, `graphHelpers.js`, or
 * `bulkDataExportRunner.js`, this test fails and the $everything-only scoping must be
 * re-verified.
 */
const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('@jest/globals');

function findFilesReferencing (rootDir, needle) {
    const matches = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'tests') {
                continue;
            }
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                const contents = fs.readFileSync(fullPath, 'utf8');
                if (contents.includes(needle)) {
                    matches.push(path.relative(rootDir, fullPath).split(path.sep).join('/'));
                }
            }
        }
    };
    walk(rootDir);
    return matches.sort();
}

describe('DCON-4962: PROA consented data access is scoped to $everything only (confirmed by scanning the real source tree)', () => {
    test('allowConsentedProaDataAccess: true is only ever passed from operations/everything/everythingHelper.js', () => {
        const srcDir = path.resolve(__dirname, '../../../../../src');

        const callSites = findFilesReferencing(srcDir, 'allowConsentedProaDataAccess: true');

        expect(callSites).toEqual([
            'operations/everything/everythingHelper.js'
        ]);

        // Explicitly confirm search, Patient instance-read, GraphQL, and bulk export do NOT set it.
        for (const file of [
            'operations/search/searchBundle.js',
            'operations/search/searchStreaming.js',
            'operations/searchById/searchById.js',
            'operations/graph/graphHelpers.js',
            'operations/export/script/bulkDataExportRunner.js'
        ]) {
            expect(fs.readFileSync(path.join(srcDir, file), 'utf8'))
                .not.toContain('allowConsentedProaDataAccess: true');
        }
    });
});
