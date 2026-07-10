const { describe, test, expect } = require('@jest/globals');
const { Writable } = require('stream');
const { SqlOnFhirRunOperation } = require('../../operations/sqlOnFhir/sqlOnFhirRunOperation');
const { ViewResolver } = require('../../operations/sqlOnFhir/viewResolver');
const { ViewDefinitionValidator } = require('../../operations/sqlOnFhir/viewDefinitionValidator');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

function fakeRes() {
    const res = new Writable({
        write(chunk, enc, cb) {
            res._body += chunk.toString();
            cb();
        }
    });
    res._body = '';
    res.headers = {};
    res.setHeader = (k, v) => (res.headers[k] = v);
    res.status = (c) => {
        res.statusCode = c;
        return res;
    };
    return res;
}

function makeOperation() {
    return new SqlOnFhirRunOperation({
        viewResolver: new ViewResolver(),
        viewDefinitionValidator: new ViewDefinitionValidator(),
        fhirPathEvaluator: new FhirPathEvaluator(),
        // matches the REAL SearchManager.constructQueryAsync return shape:
        // { base_version, columns, query }
        searchManager: {
            constructQueryAsync: async () => ({
                base_version: '4_0_0',
                columns: new Set(),
                query: {}
            })
        },
        databaseQueryFactory: {},
        configManager: {}
    });
}

const view = {
    resourceType: 'ViewDefinition',
    resource: 'Patient',
    select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
};

describe('SqlOnFhirRunOperation (inline)', () => {
    test('streams NDJSON rows from inline resources', async () => {
        const op = makeOperation();
        const res = fakeRes();
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } }
            ]
        };
        await op.runAsync({
            requestInfo: { accept: ['application/x-ndjson'] },
            parsedArgs: {},
            body,
            resourceType: 'Patient',
            res
        });
        expect(res._body).toBe('{"id":"p1"}\n');
        expect(res.headers['Content-Type']).toMatch(/ndjson/);
    });

    test('rejects an invalid view with 400 before streaming', async () => {
        const op = makeOperation();
        const res = fakeRes();
        const badView = { resourceType: 'ViewDefinition', select: [] }; // no resource
        await expect(
            op.runAsync({
                requestInfo: { accept: ['application/x-ndjson'] },
                parsedArgs: {},
                body: { resourceType: 'ViewDefinition', ...badView },
                resourceType: 'Patient',
                res
            })
        ).rejects.toThrow(/resource/i);
        expect(res._body).toBe('');
    });
});
