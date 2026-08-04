'use strict';

const { describe, test, expect } = require('@jest/globals');
const { QueryItem } = require('../../../../operations/graph/queryItem');

describe('QueryItem', () => {
    test('stores all constructor properties', () => {
        const item = new QueryItem({
            query: { id: '123' },
            resourceType: 'Patient',
            collectionName: 'Patient_4_0_0',
            property: 'subject',
            reverse_filter: 'Observation.subject',
            explanations: [{ queryPlanner: {} }]
        });
        expect(item.query).toEqual({ id: '123' });
        expect(item.resourceType).toBe('Patient');
        expect(item.collectionName).toBe('Patient_4_0_0');
        expect(item.property).toBe('subject');
        expect(item.reverse_filter).toBe('Observation.subject');
        expect(item.explanations).toEqual([{ queryPlanner: {} }]);
    });

    test('optional properties default to undefined', () => {
        const item = new QueryItem({
            query: { _uuid: 'abc' },
            resourceType: 'Observation',
            collectionName: 'Observation_4_0_0'
        });
        expect(item.property).toBeUndefined();
        expect(item.reverse_filter).toBeUndefined();
        expect(item.explanations).toBeUndefined();
    });

    test('query can be a complex MongoDB filter', () => {
        const complexQuery = {
            $and: [
                { 'meta.security.code': 'bwell' },
                { 'subject.reference': { $in: ['Patient/1', 'Patient/2'] } }
            ]
        };
        const item = new QueryItem({
            query: complexQuery,
            resourceType: 'Encounter',
            collectionName: 'Encounter_4_0_0'
        });
        expect(item.query).toBe(complexQuery);
    });

    test('resourceType and collectionName can be null', () => {
        const item = new QueryItem({
            query: {},
            resourceType: null,
            collectionName: null
        });
        expect(item.resourceType).toBeNull();
        expect(item.collectionName).toBeNull();
    });
});
