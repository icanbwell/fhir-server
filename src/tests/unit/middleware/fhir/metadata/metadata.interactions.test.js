'use strict';

const { describe, test, expect } = require('@jest/globals');
const generateInteractions = require('../../../../../middleware/fhir/metadata/metadata.interactions');

describe('metadata.interactions', () => {
    test('returns an array of interactions', () => {
        const interactions = generateInteractions('Patient');
        expect(Array.isArray(interactions)).toBe(true);
        expect(interactions.length).toBeGreaterThan(0);
    });

    test('includes search-type interaction', () => {
        const interactions = generateInteractions('Patient');
        expect(interactions).toContainEqual({ code: 'search-type' });
    });

    test('includes read interaction', () => {
        const interactions = generateInteractions('Patient');
        expect(interactions).toContainEqual({ code: 'read' });
    });

    test('includes vread interaction', () => {
        const interactions = generateInteractions('Patient');
        expect(interactions).toContainEqual({ code: 'vread' });
    });

    test('includes create interaction', () => {
        const interactions = generateInteractions('Patient');
        expect(interactions).toContainEqual({ code: 'create' });
    });

    test('includes update interaction', () => {
        const interactions = generateInteractions('Observation');
        expect(interactions).toContainEqual({ code: 'update' });
    });

    test('includes delete interaction', () => {
        const interactions = generateInteractions('Observation');
        expect(interactions).toContainEqual({ code: 'delete' });
    });

    test('includes history interactions', () => {
        const interactions = generateInteractions('Encounter');
        expect(interactions).toContainEqual({ code: 'history-type' });
        expect(interactions).toContainEqual({ code: 'history-instance' });
    });

    test('caches results for same resourceType', () => {
        const first = generateInteractions('Condition');
        const second = generateInteractions('Condition');
        expect(first).toBe(second);
    });

    test('returns 8 interactions total', () => {
        const interactions = generateInteractions('Procedure');
        expect(interactions).toHaveLength(8);
    });
});
