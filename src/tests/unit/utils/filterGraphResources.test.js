'use strict';

const { describe, test, expect } = require('@jest/globals');
const { filterGraphResources } = require('../../../utils/filterGraphResources');

describe('filterGraphResources', () => {
    test('filters out resources not in the filter list', () => {
        const graph = {
            type: 'Patient',
            link: [
                {
                    target: [
                        { type: 'Observation' },
                        { type: 'Condition' },
                        { type: 'Procedure' }
                    ]
                }
            ]
        };
        const result = filterGraphResources(graph, ['Observation', 'Condition']);
        const targetTypes = result.link[0].target.map(t => t.type);
        expect(targetTypes).toContain('Observation');
        expect(targetTypes).toContain('Condition');
        expect(targetTypes).not.toContain('Procedure');
    });

    test('removes link entirely when no targets match', () => {
        const graph = {
            type: 'Patient',
            link: [
                {
                    target: [{ type: 'MedicationRequest' }]
                }
            ]
        };
        const result = filterGraphResources(graph, ['Observation']);
        expect(result.link).toBeUndefined();
    });

    test('preserves nested links (recursive filtering)', () => {
        const graph = {
            type: 'Patient',
            link: [
                {
                    target: [
                        {
                            type: 'Encounter',
                            link: [
                                {
                                    target: [
                                        { type: 'Observation' },
                                        { type: 'DiagnosticReport' }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        };
        const result = filterGraphResources(graph, ['Observation']);
        expect(result.link).toBeDefined();
        const encounter = result.link[0].target[0];
        expect(encounter.link[0].target[0].type).toBe('Observation');
    });

    test('keeps parent with nested link even if parent type not in filter list', () => {
        const graph = {
            type: 'Patient',
            link: [
                {
                    target: [
                        {
                            type: 'Encounter',
                            link: [
                                { target: [{ type: 'Observation' }] }
                            ]
                        }
                    ]
                }
            ]
        };
        const result = filterGraphResources(graph, ['Observation']);
        expect(result.link).toBeDefined();
        expect(result.link[0].target[0].type).toBe('Encounter');
    });

    test('handles multiple links with mixed targets', () => {
        const graph = {
            type: 'Patient',
            link: [
                { target: [{ type: 'Observation' }] },
                { target: [{ type: 'Procedure' }] },
                { target: [{ type: 'Condition' }] }
            ]
        };
        const result = filterGraphResources(graph, ['Observation', 'Condition']);
        expect(result.link).toHaveLength(2);
    });

    test('does not mutate original graph', () => {
        const graph = {
            type: 'Patient',
            link: [
                { target: [{ type: 'Observation' }, { type: 'Condition' }] }
            ]
        };
        filterGraphResources(graph, ['Observation']);
        expect(graph.link[0].target).toHaveLength(2);
    });

    test('empty filter list removes all links', () => {
        const graph = {
            type: 'Patient',
            link: [
                { target: [{ type: 'Observation' }] }
            ]
        };
        const result = filterGraphResources(graph, []);
        expect(result.link).toBeUndefined();
    });

    test('preserves type on root node', () => {
        const graph = {
            type: 'Patient',
            link: [{ target: [{ type: 'Observation' }] }]
        };
        const result = filterGraphResources(graph, ['Observation']);
        expect(result.type).toBe('Patient');
    });

    test('handles deeply nested recursive structures', () => {
        const graph = {
            type: 'Patient',
            link: [
                {
                    target: [
                        {
                            type: 'Encounter',
                            link: [
                                {
                                    target: [
                                        {
                                            type: 'Procedure',
                                            link: [
                                                { target: [{ type: 'Observation' }] }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        };
        const result = filterGraphResources(graph, ['Observation']);
        expect(result.link).toBeDefined();
    });
});
