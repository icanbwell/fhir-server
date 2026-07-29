'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { QueryRewriter } = require('../../../../queryRewriters/rewriters/queryRewriter');

describe('QueryRewriter (base class)', () => {
    let rewriter;

    beforeEach(() => {
        rewriter = new QueryRewriter();
    });

    describe('rewriteQueryAsync', () => {
        test('returns query and columns unchanged (passthrough)', async () => {
            const query = { 'subject.reference': 'Patient/123', 'meta.security': { $elemMatch: { code: 'tenant-a' } } };
            const columns = new Set(['id', 'resourceType', 'subject']);

            const result = await rewriter.rewriteQueryAsync({
                base_version: '4_0_0',
                query,
                columns,
                resourceType: 'Observation',
                operation: 'READ'
            });

            expect(result.query).toBe(query);
            expect(result.columns).toBe(columns);
        });

        test('does not mutate the input query object', async () => {
            const query = { 'patient.reference': 'Patient/456' };
            const originalKeys = Object.keys(query);

            await rewriter.rewriteQueryAsync({
                base_version: '4_0_0',
                query,
                columns: new Set(),
                resourceType: 'Condition',
                operation: 'WRITE'
            });

            expect(Object.keys(query)).toEqual(originalKeys);
        });

        test('handles empty query and columns', async () => {
            const result = await rewriter.rewriteQueryAsync({
                base_version: '4_0_0',
                query: {},
                columns: new Set(),
                resourceType: 'Patient',
                operation: 'READ'
            });

            expect(result.query).toEqual({});
            expect(result.columns.size).toBe(0);
        });
    });

    describe('rewriteArgsAsync', () => {
        test('returns parsedArgs unchanged (passthrough)', async () => {
            const parsedArgs = { patient: 'Patient/123', _count: 10 };

            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs,
                resourceType: 'Observation',
                operation: 'READ'
            });

            expect(result).toBe(parsedArgs);
        });

        test('handles null-like parsedArgs without throwing', async () => {
            const result = await rewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs: {},
                resourceType: 'Patient',
                operation: 'WRITE'
            });

            expect(result).toEqual({});
        });
    });

    describe('subclass contract', () => {
        test('subclass can override rewriteQueryAsync and modify query', async () => {
            class TenantScopingRewriter extends QueryRewriter {
                async rewriteQueryAsync({ base_version, query, columns, resourceType, operation }) {
                    return {
                        query: { ...query, 'meta.security.code': 'tenant-injected' },
                        columns
                    };
                }
            }

            const subRewriter = new TenantScopingRewriter();
            const result = await subRewriter.rewriteQueryAsync({
                base_version: '4_0_0',
                query: { status: 'active' },
                columns: new Set(),
                resourceType: 'Observation',
                operation: 'READ'
            });

            expect(result.query['meta.security.code']).toBe('tenant-injected');
            expect(result.query.status).toBe('active');
        });

        test('subclass can override rewriteArgsAsync and transform args', async () => {
            class PatientExpanderRewriter extends QueryRewriter {
                async rewriteArgsAsync({ base_version, parsedArgs, resourceType, operation }) {
                    return { ...parsedArgs, _expandedPatients: ['Patient/1', 'Patient/2'] };
                }
            }

            const subRewriter = new PatientExpanderRewriter();
            const result = await subRewriter.rewriteArgsAsync({
                base_version: '4_0_0',
                parsedArgs: { patient: 'Patient/person.abc' },
                resourceType: 'Observation',
                operation: 'READ'
            });

            expect(result._expandedPatients).toEqual(['Patient/1', 'Patient/2']);
            expect(result.patient).toBe('Patient/person.abc');
        });
    });
});
