const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { runView } = require('./viewRunner');
const { RowNdJsonWriter } = require('./rowNdJsonWriter');
const { RowCsvWriter } = require('./rowCsvWriter');
const { BadRequestError } = require('../../utils/httpErrors');

const BASE_VERSION = '4_0_0';

class SqlOnFhirRunOperation {
    /**
     * @param {Object} deps
     * @param {import('./viewResolver').ViewResolver} deps.viewResolver
     * @param {import('./viewDefinitionValidator').ViewDefinitionValidator} deps.viewDefinitionValidator
     * @param {import('../../utils/fhirPathEvaluator').FhirPathEvaluator} deps.fhirPathEvaluator
     * @param {import('../search/searchManager').SearchManager} deps.searchManager
     *        MUST expose constructQueryAsync (the authorization gate)
     * @param {import('../../dataLayer/databaseQueryFactory').DatabaseQueryFactory} deps.databaseQueryFactory
     * @param {Object} deps.configManager
     */
    constructor({
        viewResolver,
        viewDefinitionValidator,
        fhirPathEvaluator,
        searchManager,
        databaseQueryFactory,
        configManager
    }) {
        this.viewResolver = viewResolver;
        this.viewDefinitionValidator = viewDefinitionValidator;
        this.fhirPathEvaluator = fhirPathEvaluator;
        this.searchManager = searchManager;
        this.databaseQueryFactory = databaseQueryFactory;
        this.configManager = configManager;
    }

    /**
     * Orchestrates a SQL-on-FHIR $run: resolve + validate the view, build the resource
     * source (inline or secured stored cursor), run the view, and pipe the resulting
     * rows through the chosen writer directly to `res`.
     * @param {Object} params
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {Object} params.parsedArgs
     * @param {Object} params.body request body (Parameters or a bare ViewDefinition)
     * @param {string} params.resourceType
     * @param {import('stream').Writable} params.res
     * @returns {Promise<undefined>} response is written directly to `res`
     */
    async runAsync({ requestInfo, parsedArgs, body, resourceType, res }) {
        const { view, inlineResources } = this.viewResolver.resolve({ body });
        // validate BEFORE building the source or writing any headers/bytes, so a
        // malformed view fails fast with a 400 and nothing is streamed.
        this.viewDefinitionValidator.validate(view);

        const wantsCsv = (requestInfo.accept || []).some((a) => String(a).includes('csv'));
        const columns = this._columnNames(view);

        // build the source (and enforce guardrail D2) BEFORE setting headers, so a
        // guardrail rejection surfaces as a clean error with no bytes on the wire.
        const source = await this._resourceSource({
            view,
            inlineResources,
            requestInfo,
            parsedArgs
        });

        // headers must be set before any bytes are written
        res.setHeader('Content-Type', wantsCsv ? 'text/csv' : 'application/x-ndjson');

        const rows = runView(view, source, { fhirPathEvaluator: this.fhirPathEvaluator });
        const writer = wantsCsv ? new RowCsvWriter({ columns }) : new RowNdJsonWriter();

        await pipeline(Readable.from(rows), writer, res);
        return undefined;
    }

    /**
     * Resolves the set of resources the view runs over. Inline resources are returned
     * as-is. For the stored path this MUST route through searchManager.constructQueryAsync
     * (the authorization gate: SMART scopes + patient compartment + access/consent filters)
     * and then iterate a secured DatabaseCursor. A raw hand-rolled Mongo query is never used.
     * @param {Object} params
     * @param {Object} params.view
     * @param {Object[]} params.inlineResources
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {Object} params.parsedArgs
     * @returns {Promise<Iterable<Object>|AsyncIterable<Object>>}
     */
    async _resourceSource({ view, inlineResources, requestInfo, parsedArgs }) {
        if (inlineResources && inlineResources.length > 0) {
            return inlineResources;
        }

        // Guardrail D2: a stored $run with NO filter and NO explicit _count would scan the
        // entire collection. Reject before any query/stream/headers.
        // NOTE: the real ParsedArgs (src/operations/query/parsedArgs.js) attaches search
        // params as NON-ENUMERABLE getters via Object.defineProperty, so Object.keys() on
        // the instance never sees them. The actual params live in parsedArgs.parsedArgItems.
        const reservedArgs = ['_format', '_type', '_count'];
        const items = (parsedArgs && parsedArgs.parsedArgItems) || [];
        const hasFilter = items.some((a) => !reservedArgs.includes(a.queryParameter));
        const hasExplicitCount = !!(parsedArgs && parsedArgs.get && parsedArgs.get('_count'));
        if (!hasFilter && !hasExplicitCount) {
            throw new BadRequestError(
                new Error(
                    'stored $run requires a filter (e.g. patient, _lastUpdated) or an explicit _count'
                )
            );
        }

        // AUTHORIZATION GATE — never bypass this for stored resources. Returns
        // { base_version, columns, query }; only the query drives the read.
        const { query } = await this.searchManager.constructQueryAsync({
            user: requestInfo.user,
            scope: requestInfo.scope,
            isUser: requestInfo.isUser,
            userType: requestInfo.userType,
            actor: requestInfo.actor,
            resourceType: view.resource,
            useAccessIndex: this.configManager.useAccessIndex,
            personIdFromJwtToken: requestInfo.personIdFromJwtToken,
            requestId: requestInfo.requestId,
            parsedArgs,
            operation: 'READ'
        });

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: view.resource,
            base_version: BASE_VERSION
        });
        const maxTimeMS = this.configManager.sqlOnFhirMaxTimeMS || 30000;
        const cursor = await databaseQueryManager.findAsync({ query, options: { maxTimeMS } });

        async function* iterate() {
            while (await cursor.hasNext()) {
                yield await cursor.next();
            }
        }
        return iterate();
    }

    /**
     * Ordered, de-duplicated column names for the CSV header (D3). Walks columns,
     * nested selects, and unionAll branches in declaration order, keeping the first
     * occurrence of each name.
     * @param {Object} view
     * @returns {string[]}
     */
    _columnNames(view) {
        const names = [];
        const seen = new Set();
        const walk = (selections) => {
            for (const s of selections || []) {
                for (const c of s.column || []) {
                    if (!seen.has(c.name)) {
                        seen.add(c.name);
                        names.push(c.name);
                    }
                }
                walk(s.select);
                for (const b of s.unionAll || []) {
                    walk([b]);
                }
            }
        };
        walk(view.select);
        return names;
    }
}

module.exports = { SqlOnFhirRunOperation };
