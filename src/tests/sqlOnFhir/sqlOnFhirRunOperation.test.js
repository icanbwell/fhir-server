const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { Writable } = require('stream');
const { SqlOnFhirRunOperation } = require('../../operations/sqlOnFhir/sqlOnFhirRunOperation');
const { ViewResolver } = require('../../operations/sqlOnFhir/viewResolver');
const { ViewDefinitionValidator } = require('../../operations/sqlOnFhir/viewDefinitionValidator');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');
const { ParsedArgs } = require('../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../operations/query/queryParameterValue');

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

/**
 * Builds a real ParsedArgsItem (not a stub) for a given search param.
 * @param {string} queryParameter
 * @param {string} value
 * @returns {ParsedArgsItem}
 */
function buildParsedArgsItem(queryParameter, value) {
    return new ParsedArgsItem({
        queryParameter,
        queryParameterValue: new QueryParameterValue({ value }),
        propertyObj: undefined,
        modifiers: []
    });
}

/**
 * Builds a real ParsedArgs instance (not a stub) with the given items.
 * @param {ParsedArgsItem[]} parsedArgItems
 * @returns {ParsedArgs}
 */
function buildParsedArgs(parsedArgItems = []) {
    return new ParsedArgs({ base_version: '4_0_0', parsedArgItems });
}

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

describe('SqlOnFhirRunOperation (stored, guardrail D2)', () => {
    test('rejects a stored $run with no filter and no _count, writes zero bytes, never queries', async () => {
        const createQuery = jestGlobal.fn();
        const constructQueryAsync = jestGlobal.fn();
        const op = new SqlOnFhirRunOperation({
            viewResolver: new ViewResolver(),
            viewDefinitionValidator: new ViewDefinitionValidator(),
            fhirPathEvaluator: new FhirPathEvaluator(),
            searchManager: { constructQueryAsync },
            databaseQueryFactory: { createQuery },
            configManager: {}
        });
        const res = fakeRes();
        const body = {
            resourceType: 'Parameters',
            parameter: [{ name: 'viewResource', resource: view }]
        };
        // real ParsedArgs, no search-param items at all — no filter, no _count.
        const parsedArgs = buildParsedArgs([]);

        await expect(
            op.runAsync({
                requestInfo: { accept: ['application/x-ndjson'] },
                parsedArgs,
                body,
                resourceType: 'Patient',
                res
            })
        ).rejects.toThrow(/filter|_count/i);

        expect(res._body).toBe('');
        expect(constructQueryAsync).not.toHaveBeenCalled();
        expect(createQuery).not.toHaveBeenCalled();
    });

    test('stored $run with a real filter routes through constructQueryAsync and streams rows', async () => {
        const fakeCursor = {
            _returned: false,
            async hasNext() {
                return !this._returned;
            },
            async next() {
                this._returned = true;
                return { resourceType: 'Patient', id: 'stored-1' };
            }
        };
        const findAsync = jestGlobal.fn().mockResolvedValue(fakeCursor);
        const createQuery = jestGlobal.fn().mockReturnValue({ findAsync });
        const constructQueryAsync = jestGlobal.fn().mockResolvedValue({
            base_version: '4_0_0',
            columns: new Set(),
            query: { id: 'stored-1' }
        });
        const op = new SqlOnFhirRunOperation({
            viewResolver: new ViewResolver(),
            viewDefinitionValidator: new ViewDefinitionValidator(),
            fhirPathEvaluator: new FhirPathEvaluator(),
            searchManager: { constructQueryAsync },
            databaseQueryFactory: { createQuery },
            configManager: {}
        });
        const res = fakeRes();
        const body = {
            resourceType: 'Parameters',
            parameter: [{ name: 'viewResource', resource: view }]
        };
        // real ParsedArgs with a real search-param filter (patient), satisfying the guardrail.
        const parsedArgs = buildParsedArgs([buildParsedArgsItem('patient', 'p1')]);

        await op.runAsync({
            requestInfo: { accept: ['application/x-ndjson'], user: 'u1', scope: 'patient/*.read' },
            parsedArgs,
            body,
            resourceType: 'Patient',
            res
        });

        expect(constructQueryAsync).toHaveBeenCalledTimes(1);
        expect(constructQueryAsync.mock.calls[0][0].parsedArgs).toBe(parsedArgs);
        expect(createQuery).toHaveBeenCalledTimes(1);
        expect(findAsync).toHaveBeenCalledTimes(1);
        // the query handed to findAsync is the one returned by constructQueryAsync — no
        // raw hand-rolled query bypasses the authorization gate.
        expect(findAsync.mock.calls[0][0].query).toEqual({ id: 'stored-1' });
        expect(res._body).toBe('{"id":"stored-1"}\n');
    });
});
