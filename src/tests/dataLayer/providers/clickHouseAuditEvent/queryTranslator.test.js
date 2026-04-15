const { describe, test, expect, beforeEach } = require('@jest/globals');
const { AuditEventQueryTranslator } = require('../../../../dataLayer/providers/clickHouseAuditEvent/queryTranslator');

describe('AuditEventQueryTranslator', () => {
    let translator;

    beforeEach(() => {
        translator = new AuditEventQueryTranslator();
    });

    describe('Dedicated column searches', () => {
        test('date range with $gte and $lt', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { recorded: { $gte: '2024-01-01', $lt: '2024-02-01' } }
            });

            expect(query).toContain('recorded >=');
            expect(query).toContain('recorded <');
            const paramValues = Object.values(query_params);
            expect(paramValues).toContain('2024-01-01');
            expect(paramValues).toContain('2024-02-01');
        });

        test('action equality', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { action: 'R' }
            });

            expect(query).toMatch(/action = \{action_\d+:String\}/);
            expect(Object.values(query_params)).toContain('R');
        });

        test('action $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { action: { $in: ['R', 'U'] } }
            });

            expect(query).toMatch(/action IN \{action_\d+:Array\(String\)\}/);
            const paramValues = Object.values(query_params);
            expect(paramValues).toContainEqual(['R', 'U']);
        });

        test('id equality', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { id: 'audit-123' }
            });

            expect(query).toMatch(/id = \{id_\d+:String\}/);
            expect(Object.values(query_params)).toContain('audit-123');
        });

        test('_uuid equality', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { _uuid: 'AuditEvent/uuid-1' }
            });

            expect(query).toMatch(/_uuid = \{_uuid_\d+:String\}/);
            expect(Object.values(query_params)).toContain('AuditEvent/uuid-1');
        });

        test('_sourceId equality', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { _sourceId: 'src-1' }
            });

            expect(query).toMatch(/_sourceId = \{_sourceId_\d+:String\}/);
            expect(Object.values(query_params)).toContain('src-1');
        });

        test('_sourceAssigningAuthority equality', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { _sourceAssigningAuthority: 'bwell' }
            });

            expect(query).toMatch(/_sourceAssigningAuthority = \{_sourceAssigningAuthority_\d+:String\}/);
            expect(Object.values(query_params)).toContain('bwell');
        });

        test('$ne operator on dedicated column', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { action: { $ne: 'D' } }
            });

            expect(query).toMatch(/action != \{action_\d+:String\}/);
            expect(Object.values(query_params)).toContain('D');
        });

        test('$nin operator on dedicated column', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { action: { $nin: ['D', 'C'] } }
            });

            expect(query).toMatch(/action NOT IN \{action_\d+:Array\(String\)\}/);
            expect(Object.values(query_params)).toContainEqual(['D', 'C']);
        });

        test('$nin on datetime column converts values', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { recorded: { $nin: ['2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'] } }
            });

            expect(query).toMatch(/recorded NOT IN/);
            const paramValues = Object.values(query_params).find(Array.isArray);
            expect(paramValues).toContainEqual('2024-01-01 00:00:00');
            expect(paramValues).toContainEqual('2024-02-01 00:00:00');
            paramValues.forEach(v => {
                expect(v).not.toContain('T');
                expect(v).not.toContain('Z');
            });
        });
    });

    describe('Array column searches', () => {
        test('agent.who._uuid $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.who._uuid': { $in: ['Person/123'] } }
            });

            expect(query).toMatch(/hasAny\(agent_who, \{agent_who_\d+:Array\(String\)\}\)/);
            expect(Object.values(query_params)).toContainEqual(['Person/123']);
        });

        test('entity.what._uuid $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'entity.what._uuid': { $in: ['Patient/456'] } }
            });

            expect(query).toMatch(/hasAny\(entity_what, \{entity_what_\d+:Array\(String\)\}\)/);
            expect(Object.values(query_params)).toContainEqual(['Patient/456']);
        });

        test('agent.altId $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.altId': { $in: ['alt-1'] } }
            });

            expect(query).toMatch(/hasAny\(agent_altid, \{agent_altid_\d+:Array\(String\)\}\)/);
            expect(Object.values(query_params)).toContainEqual(['alt-1']);
        });

        test('agent.who nested _sourceId $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.who': { _sourceId: { $in: ['Person/123'] } } }
            });

            expect(query).toContain('hasAny(agent_who');
            expect(Object.values(query_params)).toContainEqual(['Person/123']);
        });

        test('agent.who direct string value', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.who._uuid': 'Person/direct' }
            });

            expect(query).toContain('hasAny(agent_who');
            expect(Object.values(query_params)).toContainEqual(['Person/direct']);
        });

        test('agent.who.$eq', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.who._uuid': { $eq: 'Person/eq-test' } }
            });

            expect(query).toContain('hasAny(agent_who');
            expect(Object.values(query_params)).toContainEqual(['Person/eq-test']);
        });
    });

    describe('Security / access control', () => {
        test('_access index pattern', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { '_access.bwell': 1 }
            });

            expect(query).toContain('arrayExists(x -> x.1 =');
            expect(query).toContain('https://www.icanbwell.com/access');
            expect(query).toContain('meta_security)');
            expect(Object.values(query_params)).toContain('bwell');
        });

        test('meta.security $elemMatch with system and code', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: 'bwell'
                        }
                    }
                }
            });

            expect(query).toContain('arrayExists(x ->');
            expect(query).toContain('x.1 =');
            expect(query).toContain('x.2 =');
            expect(query).toContain('meta_security)');
            expect(Object.values(query_params)).toContain('https://www.icanbwell.com/access');
            expect(Object.values(query_params)).toContain('bwell');
        });

        test('meta.security $elemMatch with code $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    'meta.security': {
                        $elemMatch: {
                            system: 'https://www.icanbwell.com/access',
                            code: { $in: ['a', 'b'] }
                        }
                    }
                }
            });

            expect(query).toContain('arrayExists(x ->');
            expect(query).toContain('x.1 =');
            expect(query).toContain('x.2 IN');
            expect(Object.values(query_params)).toContainEqual(['a', 'b']);
        });

        test('meta.security.code code-only', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'meta.security.code': 'bwell' }
            });

            expect(query).toContain('arrayExists(x -> x.2 =');
            expect(query).toContain('meta_security)');
            expect(Object.values(query_params)).toContain('bwell');
        });

        test('meta.security $not $elemMatch', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    'meta.security': {
                        $not: {
                            $elemMatch: {
                                system: 'https://www.icanbwell.com/access',
                                code: 'hidden'
                            }
                        }
                    }
                }
            });

            expect(query).toContain('NOT (arrayExists(');
            expect(Object.values(query_params)).toContain('hidden');
        });
    });

    describe('JSON fallback (unmapped fields)', () => {
        test('string search with regex prefix (case insensitive)', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.name': { $regex: '^John', $options: 'i' } }
            });

            expect(query).toContain('resource.agent.name ILIKE');
            expect(Object.values(query_params)).toContain('John%');
        });

        test('string search with regex prefix (case sensitive)', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.name': { $regex: '^John' } }
            });

            expect(query).toContain('resource.agent.name LIKE');
            expect(Object.values(query_params)).toContain('John%');
        });

        test('regex without prefix anchor uses match()', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.name': { $regex: 'John.*Doe' } }
            });

            expect(query).toContain('match(resource.agent.name');
            expect(Object.values(query_params)).toContain('John.*Doe');
        });

        test('token via JSON $elemMatch', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'type.coding': { $elemMatch: { code: '110112' } } }
            });

            expect(query).toContain('resource.type.coding.code =');
            expect(Object.values(query_params)).toContain('110112');
        });

        test('token with system and code', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    'type.coding': {
                        $elemMatch: {
                            system: 'http://dicom.nema.org/resources/ontology/DCM',
                            code: '110112'
                        }
                    }
                }
            });

            expect(query).toContain('resource.type.coding.system =');
            expect(query).toContain('resource.type.coding.code =');
            expect(Object.values(query_params)).toContain('http://dicom.nema.org/resources/ontology/DCM');
            expect(Object.values(query_params)).toContain('110112');
        });

        test('source reference via JSON path', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'source.observer._uuid': 'Person/abc' }
            });

            expect(query).toContain('resource.source.observer._uuid =');
            expect(Object.values(query_params)).toContain('Person/abc');
        });

        test('nested path equality (policy URI)', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'agent.policy': 'urn:policy:1' }
            });

            expect(query).toContain('resource.agent.policy =');
            expect(Object.values(query_params)).toContain('urn:policy:1');
        });

        test('$exists true on JSON field', () => {
            const { query } = translator.buildSearchQuery({
                query: { outcome: { $exists: true } }
            });

            expect(query).toContain('isNotNull(resource.outcome)');
        });

        test('$exists false on JSON field', () => {
            const { query } = translator.buildSearchQuery({
                query: { outcome: { $exists: false } }
            });

            expect(query).toContain('isNull(resource.outcome)');
        });

        test('$in on JSON field', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { outcome: { $in: ['0', '4'] } }
            });

            expect(query).toMatch(/resource\.outcome IN/);
            expect(Object.values(query_params)).toContainEqual(['0', '4']);
        });

        test('$nin on JSON field', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { outcome: { $nin: ['8'] } }
            });

            expect(query).toMatch(/resource\.outcome NOT IN/);
            expect(Object.values(query_params)).toContainEqual(['8']);
        });

        test('JSON $elemMatch with code $in', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    'subtype.coding': {
                        $elemMatch: {
                            code: { $in: ['read', 'vread'] }
                        }
                    }
                }
            });

            expect(query).toContain('resource.subtype.coding.code IN');
            expect(Object.values(query_params)).toContainEqual(['read', 'vread']);
        });

        test('sub-document nested field in JSON', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'source.observer': { _uuid: 'Person/nested' } }
            });

            expect(query).toContain('resource.source.observer._uuid =');
            expect(Object.values(query_params)).toContain('Person/nested');
        });
    });

    describe('Logical operators', () => {
        test('$and', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    $and: [
                        { action: 'R' },
                        { recorded: { $gte: '2024-01-01' } }
                    ]
                }
            });

            expect(query).toContain('(');
            expect(query).toMatch(/action = /);
            expect(query).toMatch(/recorded >= /);
            expect(query).toContain(' AND ');
            expect(Object.values(query_params)).toContain('R');
            expect(Object.values(query_params)).toContain('2024-01-01');
        });

        test('$or', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {
                    $or: [
                        { action: 'R' },
                        { action: 'U' }
                    ]
                }
            });

            expect(query).toContain(' OR ');
            expect(Object.values(query_params)).toContain('R');
            expect(Object.values(query_params)).toContain('U');
        });

        test('nested $and inside $or', () => {
            const { query } = translator.buildSearchQuery({
                query: {
                    $or: [
                        { $and: [{ action: 'R' }, { id: 'a1' }] },
                        { $and: [{ action: 'U' }, { id: 'a2' }] }
                    ]
                }
            });

            expect(query).toContain(' OR ');
            expect(query).toContain(' AND ');
        });

        test('empty query produces no WHERE clause', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {}
            });

            expect(query).not.toContain('WHERE');
            expect(query).toContain('SELECT resource, _uuid FROM');
            expect(query).toContain('ORDER BY');
            expect(Object.keys(query_params)).toHaveLength(0);
        });

        test('null query produces no WHERE clause', () => {
            const { query } = translator.buildSearchQuery({
                query: null
            });

            expect(query).not.toContain('WHERE');
        });
    });

    describe('Sort and pagination', () => {
        test('default sort is _uuid ASC', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: {}
            });

            expect(query).toContain('ORDER BY _uuid ASC');
        });

        test('sort by recorded DESC', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { recorded: -1 } }
            });

            expect(query).toContain('ORDER BY recorded DESC');
        });

        test('sort by recorded ASC', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { recorded: 1 } }
            });

            expect(query).toContain('ORDER BY recorded ASC');
        });

        test('sort with _id maps to _uuid', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { _id: 1 } }
            });

            expect(query).toContain('ORDER BY _uuid ASC');
        });

        test('sort by unmapped field uses resource JSON path', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { outcome: -1 } }
            });

            expect(query).toContain('ORDER BY resource.outcome DESC');
        });

        test('multi-field sort', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { recorded: -1, _uuid: 1 } }
            });

            expect(query).toContain('ORDER BY recorded DESC, _uuid ASC');
        });

        test('limit uses parameterized UInt32', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {},
                options: { limit: 20 }
            });

            expect(query).toContain('LIMIT {limit:UInt32}');
            expect(query_params.limit).toBe(20);
        });

        test('skip uses parameterized UInt32', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {},
                options: { skip: 40 }
            });

            expect(query).toContain('OFFSET {skip:UInt32}');
            expect(query_params.skip).toBe(40);
        });

        test('limit + skip combo', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {},
                options: { limit: 20, skip: 40 }
            });

            expect(query).toContain('LIMIT {limit:UInt32}');
            expect(query).toContain('OFFSET {skip:UInt32}');
            expect(query_params.limit).toBe(20);
            expect(query_params.skip).toBe(40);
        });

        test('non-numeric limit is ignored', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {},
                options: { limit: 'invalid' }
            });

            expect(query).not.toContain('LIMIT');
            expect(query_params.limit).toBeUndefined();
        });

        test('non-numeric skip is ignored', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: {},
                options: { skip: 'bad' }
            });

            expect(query).not.toContain('OFFSET');
            expect(query_params.skip).toBeUndefined();
        });

        test('no limit or skip omits LIMIT and OFFSET', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: {}
            });

            expect(query).not.toContain('LIMIT');
            expect(query).not.toContain('OFFSET');
        });
    });

    describe('buildCountQuery', () => {
        test('count with filter', () => {
            const { query, query_params } = translator.buildCountQuery({
                query: { action: 'R' }
            });

            expect(query).toContain('SELECT count() AS cnt FROM fhir.AuditEvent_4_0_0');
            expect(query).toContain('WHERE');
            expect(query).toMatch(/action = /);
            expect(Object.values(query_params)).toContain('R');
        });

        test('count without filter', () => {
            const { query, query_params } = translator.buildCountQuery({
                query: {}
            });

            expect(query).toContain('SELECT count() AS cnt FROM fhir.AuditEvent_4_0_0');
            expect(query).not.toContain('WHERE');
            expect(Object.keys(query_params)).toHaveLength(0);
        });

        test('count does not include ORDER BY', () => {
            const { query } = translator.buildCountQuery({
                query: { action: 'R' }
            });

            expect(query).not.toContain('ORDER BY');
        });
    });

    describe('Parameter uniqueness', () => {
        test('multiple fields produce unique param names', () => {
            const { query_params } = translator.buildSearchQuery({
                query: {
                    action: 'R',
                    id: 'audit-1',
                    _uuid: 'AuditEvent/uuid-1',
                    _sourceId: 'src-1',
                    recorded: { $gte: '2024-01-01', $lt: '2024-02-01' }
                }
            });

            const paramNames = Object.keys(query_params);
            const uniqueNames = new Set(paramNames);
            expect(paramNames.length).toBe(uniqueNames.size);
        });

        test('counter resets between buildSearchQuery calls', () => {
            const result1 = translator.buildSearchQuery({
                query: { action: 'R' }
            });
            const result2 = translator.buildSearchQuery({
                query: { action: 'U' }
            });

            const keys1 = Object.keys(result1.query_params);
            const keys2 = Object.keys(result2.query_params);
            expect(keys1[0]).toBe(keys2[0]);
        });
    });

    describe('SELECT clause', () => {
        test('search query selects resource and _uuid', () => {
            const { query } = translator.buildSearchQuery({
                query: {}
            });

            expect(query).toMatch(/^SELECT resource, _uuid FROM fhir\.AuditEvent_4_0_0/);
        });
    });

    describe('SQL injection prevention', () => {
        test('sort field with SQL injection is dropped', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { 'action; DROP TABLE fhir.AuditEvent_4_0_0 --': 1 } }
            });

            expect(query).not.toContain('DROP');
            expect(query).not.toContain(';');
            expect(query).toContain('ORDER BY _uuid ASC');
        });

        test('sort field with special characters is dropped', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { 'field OR 1=1': -1 } }
            });

            expect(query).not.toContain('OR 1=1');
            expect(query).toContain('ORDER BY _uuid ASC');
        });

        test('query field path with injection is dropped', () => {
            const { query } = translator.buildSearchQuery({
                query: { 'field; DROP TABLE--': 'value' }
            });

            expect(query).not.toContain('DROP');
            expect(query).not.toContain(';');
        });

        test('valid sort fields still work after sanitization', () => {
            const { query } = translator.buildSearchQuery({
                query: {},
                options: { sort: { recorded: -1 } }
            });

            expect(query).toContain('ORDER BY recorded DESC');
        });

        test('valid dotted JSON field paths still work', () => {
            const { query, query_params } = translator.buildSearchQuery({
                query: { 'source.observer._uuid': 'Person/abc' }
            });

            expect(query).toContain('resource.source.observer._uuid');
            expect(Object.values(query_params)).toContain('Person/abc');
        });

        test('elemMatch field with injection is dropped', () => {
            const { query } = translator.buildSearchQuery({
                query: {
                    'type.coding': {
                        $elemMatch: { 'code; DROP TABLE--': 'val' }
                    }
                }
            });

            expect(query).not.toContain('DROP');
        });

        test('sub-document key with injection is dropped', () => {
            const { query } = translator.buildSearchQuery({
                query: {
                    'source.observer': { 'x; DROP TABLE--': 'val' }
                }
            });

            expect(query).not.toContain('DROP');
        });
    });
});
