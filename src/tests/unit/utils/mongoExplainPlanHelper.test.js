const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { MongoExplainPlanHelper } = require('../../../utils/mongoExplainPlanHelper');

describe('MongoExplainPlanHelper', () => {
    let helper;

    beforeEach(() => {
        helper = new MongoExplainPlanHelper();
    });

    describe('quick_explain', () => {
        test('should use executionStages when executionStats has them', () => {
            const explanation = {
                executionStats: {
                    nReturned: 10,
                    executionTimeMillis: 5,
                    totalKeysExamined: 100,
                    totalDocsExamined: 50,
                    executionStages: {
                        stage: 'FETCH',
                        inputStage: {
                            stage: 'IXSCAN',
                            indexName: 'myIndex'
                        }
                    }
                },
                queryPlanner: {
                    winningPlan: {
                        stage: 'COLLSCAN'
                    }
                }
            };
            const query = { name: 'test' };

            const result = helper.quick_explain({ explanation, query });

            // Should use executionStages, not winningPlan
            expect(result.step.step.stage).toBe('FETCH');
            expect(result.step.children).toBeDefined();
            expect(result.step.children[0].step.stage).toBe('IXSCAN');
            expect(result.step.children[0].step.indexName).toBe('myIndex');
        });

        test('should fall back to queryPlanner.winningPlan when no executionStages', () => {
            const explanation = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'COLLSCAN'
                    }
                }
            };
            const query = { status: 'active' };

            const result = helper.quick_explain({ explanation, query });

            expect(result.step.step.stage).toBe('COLLSCAN');
        });

        test('should return executionStats when available', () => {
            const explanation = {
                executionStats: {
                    nReturned: 42,
                    executionTimeMillis: 15,
                    totalKeysExamined: 200,
                    totalDocsExamined: 100,
                    executionStages: {
                        stage: 'FETCH'
                    }
                }
            };
            const query = {};

            const result = helper.quick_explain({ explanation, query });

            expect(result.executionStats).toEqual({
                nReturned: 42,
                executionTimeMillis: 15,
                totalKeysExamined: 200,
                totalDocsExamined: 100
            });
        });

        test('should return empty executionStats when not available in explanation', () => {
            const explanation = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'COLLSCAN'
                    }
                }
            };
            const query = {};

            const result = helper.quick_explain({ explanation, query });

            expect(result.executionStats).toEqual({});
        });

        test('should pass through the query in the result', () => {
            const explanation = {
                queryPlanner: {
                    winningPlan: { stage: 'IXSCAN', indexName: 'idx1' }
                }
            };
            const query = { resourceType: 'Patient', name: 'Smith' };

            const result = helper.quick_explain({ explanation, query });

            expect(result.query).toBe(query);
        });

        test('should handle empty explanation gracefully', () => {
            const explanation = {};
            const query = {};

            const result = helper.quick_explain({ explanation, query });

            // winningPlan is {}, so stage is undefined
            expect(result.step.step.stage).toBeUndefined();
        });
    });

    describe('parseInputStage', () => {
        test('should parse a simple stage with no children', () => {
            const step = { stage: 'COLLSCAN' };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.stepNo).toBe(1);
            expect(result.step.stage).toBe('COLLSCAN');
            expect(result.step.friendlyStage).toBe('for a collection scan');
            expect(result.children).toBeUndefined();
        });

        test('should parse inputStage recursively', () => {
            const step = {
                stage: 'FETCH',
                inputStage: {
                    stage: 'IXSCAN',
                    indexName: 'name_1'
                }
            };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.stage).toBe('FETCH');
            expect(result.children).toHaveLength(1);
            expect(result.children[0].step.stage).toBe('IXSCAN');
            expect(result.children[0].step.indexName).toBe('name_1');
        });

        test('should parse multiple inputStages', () => {
            const step = {
                stage: 'SHARD_MERGE',
                inputStages: [
                    { stage: 'IXSCAN', indexName: 'idx_a' },
                    { stage: 'IXSCAN', indexName: 'idx_b' }
                ]
            };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.stage).toBe('SHARD_MERGE');
            expect(result.step.friendlyStage).toBe('for merging results from shards');
            expect(result.children).toHaveLength(2);
            expect(result.children[0].step.indexName).toBe('idx_a');
            expect(result.children[1].step.indexName).toBe('idx_b');
        });

        test('should include both inputStage and inputStages children', () => {
            const step = {
                stage: 'FETCH',
                inputStage: {
                    stage: 'IXSCAN',
                    indexName: 'primary'
                },
                inputStages: [
                    { stage: 'IXSCAN', indexName: 'secondary' }
                ]
            };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.children).toHaveLength(2);
            expect(result.children[0].step.indexName).toBe('primary');
            expect(result.children[1].step.indexName).toBe('secondary');
        });

        test('should capture filter property', () => {
            const step = {
                stage: 'FETCH',
                filter: { name: { $eq: 'test' } }
            };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.filter).toEqual({ name: { $eq: 'test' } });
        });

        test('should capture docsExamined', () => {
            const step = { stage: 'FETCH', docsExamined: 500 };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.docsExamined).toBe(500);
        });

        test('should capture keysExamined', () => {
            const step = { stage: 'IXSCAN', keysExamined: 1000, indexName: 'idx1' };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.keysExamined).toBe(1000);
        });

        test('should capture numReads', () => {
            const step = { stage: 'IXSCAN', numReads: 250 };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.numReads).toBe(250);
        });

        test('should capture nReturned', () => {
            const step = { stage: 'FETCH', nReturned: 42 };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.nReturned).toBe(42);
        });

        test('should capture executionTimeMillisEstimate', () => {
            const step = { stage: 'FETCH', executionTimeMillisEstimate: 123 };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.executionTimeMillisEstimate).toBe(123);
        });

        test('should add friendlyStage for known stages', () => {
            const stages = {
                COLLSCAN: 'for a collection scan',
                IXSCAN: 'scanning index keys',
                FETCH: 'retrieving documents',
                GROUP: 'for grouping documents',
                SHARD_MERGE: 'for merging results from shards',
                SHARDING_FILTER: 'for filtering out orphan documents from shards'
            };

            for (const [stage, expected] of Object.entries(stages)) {
                const result = helper.parseInputStage({ stepNo: 1, step: { stage } });
                expect(result.step.friendlyStage).toBe(expected);
            }
        });

        test('should not add friendlyStage for unknown stages', () => {
            const step = { stage: 'SORT' };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.friendlyStage).toBeUndefined();
        });

        test('should not include properties that are not present on the step', () => {
            const step = { stage: 'COLLSCAN' };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step).not.toHaveProperty('indexName');
            expect(result.step).not.toHaveProperty('filter');
            expect(result.step).not.toHaveProperty('docsExamined');
            expect(result.step).not.toHaveProperty('keysExamined');
            expect(result.step).not.toHaveProperty('numReads');
            expect(result.step).not.toHaveProperty('nReturned');
            expect(result.step).not.toHaveProperty('executionTimeMillisEstimate');
        });

        test('should handle deeply nested inputStages', () => {
            const step = {
                stage: 'FETCH',
                inputStage: {
                    stage: 'SORT',
                    inputStage: {
                        stage: 'IXSCAN',
                        indexName: 'deep_idx'
                    }
                }
            };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.stage).toBe('FETCH');
            expect(result.children[0].step.stage).toBe('SORT');
            expect(result.children[0].children[0].step.stage).toBe('IXSCAN');
            expect(result.children[0].children[0].step.indexName).toBe('deep_idx');
        });

        test('should capture zero values for numeric properties', () => {
            const step = {
                stage: 'IXSCAN',
                docsExamined: 0,
                keysExamined: 0,
                numReads: 0,
                nReturned: 0,
                executionTimeMillisEstimate: 0
            };

            const result = helper.parseInputStage({ stepNo: 1, step });

            expect(result.step.docsExamined).toBe(0);
            expect(result.step.keysExamined).toBe(0);
            expect(result.step.numReads).toBe(0);
            expect(result.step.nReturned).toBe(0);
            expect(result.step.executionTimeMillisEstimate).toBe(0);
        });
    });
});
