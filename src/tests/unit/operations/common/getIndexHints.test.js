'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

const { getIndexHints } = require('../../../../operations/common/getIndexHints');

describe('getIndexHints', () => {
    let columns;

    beforeEach(() => {
        columns = new Set();
    });

    describe('with propertyObj.fields (multiple fields)', () => {
        test('adds all fields to columns when no fieldName specified', () => {
            const propertyObj = { fields: ['address', 'name'] };
            getIndexHints(columns, propertyObj);
            expect(columns).toEqual(new Set(['address', 'name']));
        });

        test('appends fieldName to each field when fieldName specified', () => {
            const propertyObj = { fields: ['subject', 'patient'] };
            getIndexHints(columns, propertyObj, 'reference');
            expect(columns).toEqual(new Set(['subject.reference', 'patient.reference']));
        });

        test('adds to existing columns without removing them', () => {
            columns.add('existing');
            const propertyObj = { fields: ['new1', 'new2'] };
            getIndexHints(columns, propertyObj);
            expect(columns).toEqual(new Set(['existing', 'new1', 'new2']));
        });

        test('handles single element fields array', () => {
            const propertyObj = { fields: ['performer'] };
            getIndexHints(columns, propertyObj, 'reference');
            expect(columns).toEqual(new Set(['performer.reference']));
        });

        test('handles empty fields array gracefully', () => {
            const propertyObj = { fields: [] };
            getIndexHints(columns, propertyObj, 'reference');
            expect(columns).toEqual(new Set());
        });

        test('does not add duplicates to the set', () => {
            columns.add('subject.reference');
            const propertyObj = { fields: ['subject', 'patient'] };
            getIndexHints(columns, propertyObj, 'reference');
            expect(columns.size).toBe(2);
            expect(columns).toEqual(new Set(['subject.reference', 'patient.reference']));
        });
    });

    describe('with propertyObj.field (single field)', () => {
        test('adds single field to columns when no fieldName specified', () => {
            const propertyObj = { field: 'status' };
            getIndexHints(columns, propertyObj);
            expect(columns).toEqual(new Set(['status']));
        });

        test('appends fieldName to field when fieldName specified', () => {
            const propertyObj = { field: 'subject' };
            getIndexHints(columns, propertyObj, 'reference');
            expect(columns).toEqual(new Set(['subject.reference']));
        });

        test('adds to existing columns without removing them', () => {
            columns.add('existing');
            const propertyObj = { field: 'code' };
            getIndexHints(columns, propertyObj);
            expect(columns).toEqual(new Set(['existing', 'code']));
        });

        test('handles dotted field names', () => {
            const propertyObj = { field: 'meta.lastUpdated' };
            getIndexHints(columns, propertyObj, 'value');
            expect(columns).toEqual(new Set(['meta.lastUpdated.value']));
        });
    });

    describe('fieldName edge cases', () => {
        test('undefined fieldName does not append anything (single field)', () => {
            const propertyObj = { field: 'category' };
            getIndexHints(columns, propertyObj, undefined);
            expect(columns).toEqual(new Set(['category']));
        });

        test('undefined fieldName does not append anything (multiple fields)', () => {
            const propertyObj = { fields: ['a', 'b'] };
            getIndexHints(columns, propertyObj, undefined);
            expect(columns).toEqual(new Set(['a', 'b']));
        });

        test('empty string fieldName still appends dot and empty string (single field)', () => {
            const propertyObj = { field: 'code' };
            getIndexHints(columns, propertyObj, '');
            // empty string is falsy, so fieldName check fails
            expect(columns).toEqual(new Set(['code']));
        });

        test('empty string fieldName still does not append (multiple fields)', () => {
            const propertyObj = { fields: ['a', 'b'] };
            getIndexHints(columns, propertyObj, '');
            // empty string is falsy
            expect(columns).toEqual(new Set(['a', 'b']));
        });
    });

    describe('propertyObj with both field and fields', () => {
        test('prefers fields array when both are present', () => {
            const propertyObj = { field: 'single', fields: ['multi1', 'multi2'] };
            getIndexHints(columns, propertyObj, 'ref');
            // fields is checked first (truthy), so multi fields are used
            expect(columns).toEqual(new Set(['multi1.ref', 'multi2.ref']));
        });
    });
});
