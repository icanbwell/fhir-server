'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { QueryRewriterManager } = require('../../../queryRewriters/queryRewriterManager');
const { RethrownError } = require('../../../utils/rethrownError');

describe('QueryRewriterManager', () => {
    let manager;

    describe('rewriteQueryAsync', () => {
        describe('empty rewriters', () => {
            beforeEach(() => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {}
                });
            });

            test('passes query and columns through unchanged when no rewriters exist', async () => {
                const query = { resourceType: 'Patient', status: 'active' };
                const columns = new Set(['id', 'name']);

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query,
                    columns,
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                expect(result.query).toEqual(query);
                expect(result.columns).toEqual(columns);
            });

            test('passes through unchanged when operation has no specific rewriters', async () => {
                const query = { resourceType: 'Observation' };
                const columns = new Set(['id']);

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query,
                    columns,
                    resourceType: 'Observation',
                    operation: 'WRITE'
                });

                expect(result.query).toEqual(query);
                expect(result.columns).toEqual(columns);
            });
        });

        describe('sequential chaining (ordering)', () => {
            test('passes modified query from rewriter 1 as input to rewriter 2', async () => {
                const rewriter1 = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        return {
                            query: { ...query, addedByFirst: true },
                            columns: new Set([...columns, 'extra1'])
                        };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                const rewriter2 = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        // Verify rewriter2 receives the output from rewriter1
                        expect(query.addedByFirst).toBe(true);
                        expect(columns.has('extra1')).toBe(true);
                        return {
                            query: { ...query, addedBySecond: true },
                            columns: new Set([...columns, 'extra2'])
                        };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter1, rewriter2],
                    operationSpecificQueryRewriters: {}
                });

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: { resourceType: 'Patient' },
                    columns: new Set(['id']),
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                expect(result.query.addedByFirst).toBe(true);
                expect(result.query.addedBySecond).toBe(true);
                expect(result.columns.has('id')).toBe(true);
                expect(result.columns.has('extra1')).toBe(true);
                expect(result.columns.has('extra2')).toBe(true);
            });

            test('runs general rewriters before operation-specific rewriters', async () => {
                const executionOrder = [];

                const generalRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        executionOrder.push('general');
                        return { query: { ...query, general: true }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                const operationRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        executionOrder.push('operation');
                        // Should receive the general rewriter's output
                        expect(query.general).toBe(true);
                        return { query: { ...query, operationSpecific: true }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [generalRewriter],
                    operationSpecificQueryRewriters: { READ: [operationRewriter] }
                });

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: {},
                    columns: new Set(),
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                expect(executionOrder).toEqual(['general', 'operation']);
                expect(result.query.general).toBe(true);
                expect(result.query.operationSpecific).toBe(true);
            });

            test('does not pass original data to subsequent rewriters (mutation test)', async () => {
                const originalQuery = { original: true };
                const receivedQueries = [];

                const rewriter1 = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        receivedQueries.push({ ...query });
                        return { query: { replaced: 'completely' }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                const rewriter2 = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        receivedQueries.push({ ...query });
                        return { query, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter1, rewriter2],
                    operationSpecificQueryRewriters: {}
                });

                await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: originalQuery,
                    columns: new Set(),
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                // Rewriter 2 should NOT receive the original query
                expect(receivedQueries[1]).toEqual({ replaced: 'completely' });
                expect(receivedQueries[1]).not.toHaveProperty('original');
            });
        });

        describe('operation-specific rewriters', () => {
            test('only runs READ-specific rewriters for READ operation', async () => {
                const readRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        return { query: { ...query, readApplied: true }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                const writeRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        return { query: { ...query, writeApplied: true }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [readRewriter],
                        WRITE: [writeRewriter]
                    }
                });

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: {},
                    columns: new Set(),
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                expect(result.query.readApplied).toBe(true);
                expect(result.query.writeApplied).toBeUndefined();
            });

            test('only runs WRITE-specific rewriters for WRITE operation', async () => {
                const readRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        return { query: { ...query, readApplied: true }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                const writeRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        return { query: { ...query, writeApplied: true }, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [readRewriter],
                        WRITE: [writeRewriter]
                    }
                });

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: {},
                    columns: new Set(),
                    resourceType: 'Patient',
                    operation: 'WRITE'
                });

                expect(result.query.writeApplied).toBe(true);
                expect(result.query.readApplied).toBeUndefined();
            });
        });

        describe('security - operation parameter as object key lookup', () => {
            test('does not throw when operation is an unknown string (e.g., DELETE)', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const query = { test: true };
                const columns = new Set(['id']);

                const result = await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query,
                    columns,
                    resourceType: 'Patient',
                    operation: 'DELETE'
                });

                // The || [] fallback should prevent errors
                expect(result.query).toEqual(query);
                expect(result.columns).toEqual(columns);
            });

            test('SECURITY: operation "toString" causes TypeError due to inherited property being non-iterable', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const query = { test: true };
                const columns = new Set(['id']);

                // BUG: 'toString' is inherited from Object.prototype, so
                // operationSpecificQueryRewriters['toString'] returns the toString function
                // (truthy), the || [] fallback doesn't trigger, and spread(...function)
                // throws TypeError because functions aren't iterable.
                // Correct behavior: validate operation is 'READ' or 'WRITE' before lookup.
                await expect(manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query,
                    columns,
                    resourceType: 'Patient',
                    operation: 'toString'
                })).rejects.toThrow(TypeError);
            });

            test('SECURITY: operation "__proto__" causes TypeError due to prototype lookup', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const query = { safe: true };
                const columns = new Set(['id']);

                // BUG: '__proto__' accesses the prototype object (truthy),
                // || [] doesn't trigger, spread fails on non-iterable object.
                await expect(manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query,
                    columns,
                    resourceType: 'Patient',
                    operation: '__proto__'
                })).rejects.toThrow(TypeError);
            });

            test('SECURITY: operation "constructor" causes TypeError due to inherited property', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const query = { safe: true };
                const columns = new Set(['id']);

                // 'constructor' resolves to Object (a function) on the prototype chain.
                // It is truthy, so || [] doesn't activate. Spreading a function throws TypeError.
                // This demonstrates the security issue: attacker-controlled operation values
                // can cause denial of service. The code should validate operation is 'READ'|'WRITE'.
                await expect(manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query,
                    columns,
                    resourceType: 'Patient',
                    operation: 'constructor'
                })).rejects.toThrow(TypeError);
            });
        });

        describe('error handling', () => {
            test('wraps rewriter errors in RethrownError', async () => {
                const originalError = new Error('rewriter exploded');

                const failingRewriter = {
                    rewriteQueryAsync: async () => {
                        throw originalError;
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [failingRewriter],
                    operationSpecificQueryRewriters: {}
                });

                await expect(manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: {},
                    columns: new Set(),
                    resourceType: 'Patient',
                    operation: 'READ'
                })).rejects.toThrow(RethrownError);
            });

            test('preserves the original error in the RethrownError', async () => {
                const originalError = new Error('database connection lost');

                const failingRewriter = {
                    rewriteQueryAsync: async () => {
                        throw originalError;
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [failingRewriter],
                    operationSpecificQueryRewriters: {}
                });

                try {
                    await manager.rewriteQueryAsync({
                        base_version: '4_0_0',
                        query: {},
                        columns: new Set(),
                        resourceType: 'Patient',
                        operation: 'READ'
                    });
                    // Should not reach here
                    expect(true).toBe(false);
                } catch (e) {
                    expect(e).toBeInstanceOf(RethrownError);
                    expect(e.original_error).toBe(originalError);
                    expect(e.nested).toBe(originalError);
                    expect(e.message).toContain('Error in rewriteQueryAsync()');
                }
            });

            test('stops processing at the first failing rewriter', async () => {
                const executionOrder = [];

                const rewriter1 = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        executionOrder.push('first');
                        throw new Error('fail');
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                const rewriter2 = {
                    rewriteQueryAsync: async ({ query, columns }) => {
                        executionOrder.push('second');
                        return { query, columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter1, rewriter2],
                    operationSpecificQueryRewriters: {}
                });

                await expect(manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: {},
                    columns: new Set(),
                    resourceType: 'Patient',
                    operation: 'READ'
                })).rejects.toThrow();

                expect(executionOrder).toEqual(['first']);
            });
        });

        describe('parameters passed to rewriters', () => {
            test('passes base_version and resourceType to each rewriter', async () => {
                const receivedParams = [];

                const rewriter = {
                    rewriteQueryAsync: async (params) => {
                        receivedParams.push(params);
                        return { query: params.query, columns: params.columns };
                    },
                    rewriteArgsAsync: async ({ parsedArgs }) => parsedArgs
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter],
                    operationSpecificQueryRewriters: {}
                });

                await manager.rewriteQueryAsync({
                    base_version: '4_0_0',
                    query: { foo: 'bar' },
                    columns: new Set(['col1']),
                    resourceType: 'Observation',
                    operation: 'READ'
                });

                expect(receivedParams[0].base_version).toBe('4_0_0');
                expect(receivedParams[0].resourceType).toBe('Observation');
                expect(receivedParams[0].query).toEqual({ foo: 'bar' });
                expect(receivedParams[0].columns).toEqual(new Set(['col1']));
            });
        });
    });

    describe('rewriteArgsAsync', () => {
        describe('empty rewriters', () => {
            beforeEach(() => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {}
                });
            });

            test('passes parsedArgs through unchanged when no rewriters exist', async () => {
                const parsedArgs = { id: '123', resourceType: 'Patient' };

                const result = await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs,
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                expect(result).toEqual(parsedArgs);
            });
        });

        describe('sequential chaining (ordering)', () => {
            test('passes modified parsedArgs from rewriter 1 as input to rewriter 2', async () => {
                const rewriter1 = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        return { ...parsedArgs, addedByFirst: true };
                    }
                };

                const rewriter2 = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        // Should receive the output from rewriter1
                        expect(parsedArgs.addedByFirst).toBe(true);
                        return { ...parsedArgs, addedBySecond: true };
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter1, rewriter2],
                    operationSpecificQueryRewriters: {}
                });

                const result = await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs: { original: true },
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                expect(result.original).toBe(true);
                expect(result.addedByFirst).toBe(true);
                expect(result.addedBySecond).toBe(true);
            });

            test('does not pass original parsedArgs to subsequent rewriters', async () => {
                const receivedArgs = [];

                const rewriter1 = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        receivedArgs.push({ ...parsedArgs });
                        return { completely: 'replaced' };
                    }
                };

                const rewriter2 = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        receivedArgs.push({ ...parsedArgs });
                        return parsedArgs;
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter1, rewriter2],
                    operationSpecificQueryRewriters: {}
                });

                await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs: { original: true },
                    resourceType: 'Patient',
                    operation: 'READ'
                });

                // Rewriter 2 must NOT receive the original parsedArgs
                expect(receivedArgs[1]).toEqual({ completely: 'replaced' });
                expect(receivedArgs[1]).not.toHaveProperty('original');
            });

            test('runs general rewriters before operation-specific rewriters', async () => {
                const executionOrder = [];

                const generalRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        executionOrder.push('general');
                        return { ...parsedArgs, general: true };
                    }
                };

                const operationRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        executionOrder.push('operation');
                        expect(parsedArgs.general).toBe(true);
                        return { ...parsedArgs, operationSpecific: true };
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [generalRewriter],
                    operationSpecificQueryRewriters: { WRITE: [operationRewriter] }
                });

                const result = await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs: {},
                    resourceType: 'Patient',
                    operation: 'WRITE'
                });

                expect(executionOrder).toEqual(['general', 'operation']);
                expect(result.general).toBe(true);
                expect(result.operationSpecific).toBe(true);
            });
        });

        describe('operation-specific rewriters', () => {
            test('only runs WRITE-specific rewriters for WRITE operation', async () => {
                const readRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        return { ...parsedArgs, readApplied: true };
                    }
                };

                const writeRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async ({ parsedArgs }) => {
                        return { ...parsedArgs, writeApplied: true };
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [readRewriter],
                        WRITE: [writeRewriter]
                    }
                });

                const result = await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs: {},
                    resourceType: 'Patient',
                    operation: 'WRITE'
                });

                expect(result.writeApplied).toBe(true);
                expect(result.readApplied).toBeUndefined();
            });
        });

        describe('security - operation parameter as object key lookup', () => {
            test('does not throw when operation is an unknown string (e.g., DELETE)', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const parsedArgs = { id: '123' };

                const result = await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs,
                    resourceType: 'Patient',
                    operation: 'DELETE'
                });

                expect(result).toEqual(parsedArgs);
            });

            test('SECURITY: operation "toString" causes TypeError in rewriteArgsAsync', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const parsedArgs = { id: '123' };

                // Same bug as rewriteQueryAsync: inherited 'toString' is truthy,
                // || [] doesn't fire, spread of non-iterable throws
                await expect(manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs,
                    resourceType: 'Patient',
                    operation: 'toString'
                })).rejects.toThrow(TypeError);
            });

            test('SECURITY: operation "__proto__" causes TypeError in rewriteArgsAsync', async () => {
                manager = new QueryRewriterManager({
                    queryRewriters: [],
                    operationSpecificQueryRewriters: {
                        READ: [],
                        WRITE: []
                    }
                });

                const parsedArgs = { safe: true };

                await expect(manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs,
                    resourceType: 'Patient',
                    operation: '__proto__'
                })).rejects.toThrow(TypeError);
            });
        });

        describe('error handling', () => {
            test('does NOT wrap errors in RethrownError (unlike rewriteQueryAsync)', async () => {
                const originalError = new Error('args rewriter exploded');

                const failingRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async () => {
                        throw originalError;
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [failingRewriter],
                    operationSpecificQueryRewriters: {}
                });

                // rewriteArgsAsync does NOT have try/catch wrapping
                await expect(manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs: {},
                    resourceType: 'Patient',
                    operation: 'READ'
                })).rejects.toThrow(originalError);
            });

            test('thrown error is the original error, not wrapped', async () => {
                const originalError = new Error('specific failure');

                const failingRewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async () => {
                        throw originalError;
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [failingRewriter],
                    operationSpecificQueryRewriters: {}
                });

                try {
                    await manager.rewriteArgsAsync({
                        base_version: '4_0_0',
                        parsedArgs: {},
                        resourceType: 'Patient',
                        operation: 'READ'
                    });
                    expect(true).toBe(false); // Should not reach here
                } catch (e) {
                    expect(e).toBe(originalError);
                    expect(e).not.toBeInstanceOf(RethrownError);
                }
            });
        });

        describe('parameters passed to rewriters', () => {
            test('passes base_version and resourceType to each rewriter', async () => {
                const receivedParams = [];

                const rewriter = {
                    rewriteQueryAsync: async ({ query, columns }) => ({ query, columns }),
                    rewriteArgsAsync: async (params) => {
                        receivedParams.push(params);
                        return params.parsedArgs;
                    }
                };

                manager = new QueryRewriterManager({
                    queryRewriters: [rewriter],
                    operationSpecificQueryRewriters: {}
                });

                await manager.rewriteArgsAsync({
                    base_version: '4_0_0',
                    parsedArgs: { foo: 'bar' },
                    resourceType: 'Observation',
                    operation: 'READ'
                });

                expect(receivedParams[0].base_version).toBe('4_0_0');
                expect(receivedParams[0].resourceType).toBe('Observation');
                expect(receivedParams[0].parsedArgs).toEqual({ foo: 'bar' });
            });
        });
    });

    describe('constructor', () => {
        test('stores queryRewriters array', () => {
            const rewriters = [{ rewriteQueryAsync: async () => {} }];
            manager = new QueryRewriterManager({
                queryRewriters: rewriters,
                operationSpecificQueryRewriters: {}
            });

            expect(manager.queryRewriters).toBe(rewriters);
        });

        test('stores operationSpecificQueryRewriters object', () => {
            const opRewriters = { READ: [], WRITE: [] };
            manager = new QueryRewriterManager({
                queryRewriters: [],
                operationSpecificQueryRewriters: opRewriters
            });

            expect(manager.operationSpecificQueryRewriters).toBe(opRewriters);
        });
    });
});
