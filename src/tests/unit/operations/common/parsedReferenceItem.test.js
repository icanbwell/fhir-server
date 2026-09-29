'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ParsedReferenceItem } = require('../../../../operations/query/parsedReferenceItem');

describe('ParsedReferenceItem', () => {
    test('stores resourceType, id, and sourceAssigningAuthority', () => {
        const item = new ParsedReferenceItem({
            resourceType: 'Patient',
            id: '123',
            sourceAssigningAuthority: 'bwell'
        });
        expect(item.resourceType).toBe('Patient');
        expect(item.id).toBe('123');
        expect(item.sourceAssigningAuthority).toBe('bwell');
    });

    describe('idPlusSourceAssigningAuthority', () => {
        test('returns id|authority when authority is present', () => {
            const item = new ParsedReferenceItem({ id: '123', sourceAssigningAuthority: 'bwell' });
            expect(item.idPlusSourceAssigningAuthority).toBe('123|bwell');
        });

        test('returns id only when authority is absent', () => {
            const item = new ParsedReferenceItem({ id: '123' });
            expect(item.idPlusSourceAssigningAuthority).toBe('123');
        });

        test('returns id only when authority is undefined', () => {
            const item = new ParsedReferenceItem({ id: 'abc', sourceAssigningAuthority: undefined });
            expect(item.idPlusSourceAssigningAuthority).toBe('abc');
        });
    });

    describe('clone', () => {
        test('creates new instance with same values', () => {
            const original = new ParsedReferenceItem({
                resourceType: 'Observation',
                id: 'obs-1',
                sourceAssigningAuthority: 'source'
            });
            const clone = original.clone();
            expect(clone).not.toBe(original);
            expect(clone.resourceType).toBe('Observation');
            expect(clone.id).toBe('obs-1');
            expect(clone.sourceAssigningAuthority).toBe('source');
        });

        test('clone is independent of original', () => {
            const original = new ParsedReferenceItem({ id: '1', sourceAssigningAuthority: 'a' });
            const clone = original.clone();
            clone.id = '2';
            expect(original.id).toBe('1');
        });
    });

    describe('toJSON', () => {
        test('includes all defined fields', () => {
            const item = new ParsedReferenceItem({
                resourceType: 'Patient',
                id: '123',
                sourceAssigningAuthority: 'bwell'
            });
            expect(item.toJSON()).toEqual({
                resourceType: 'Patient',
                id: '123',
                sourceAssigningAuthority: 'bwell'
            });
        });

        test('omits null fields', () => {
            const item = new ParsedReferenceItem({ id: '123' });
            const json = item.toJSON();
            expect(json.id).toBe('123');
            expect('resourceType' in json).toBe(false);
            expect('sourceAssigningAuthority' in json).toBe(false);
        });
    });
});
