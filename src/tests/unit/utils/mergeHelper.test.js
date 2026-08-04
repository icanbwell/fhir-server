'use strict';

const { describe, test, expect } = require('@jest/globals');
const { mergeObject } = require('../../../utils/mergeHelper');

describe('mergeHelper - mergeObject', () => {
    describe('simple object merge', () => {
        test('merges flat objects', () => {
            const old = { a: 1, b: 2 };
            const newer = { b: 3, c: 4 };
            const result = mergeObject(old, newer);
            expect(result).toEqual({ a: 1, b: 3, c: 4 });
        });

        test('new properties are added', () => {
            const result = mergeObject({ a: 1 }, { b: 2 });
            expect(result).toEqual({ a: 1, b: 2 });
        });

        test('new values overwrite old values', () => {
            const result = mergeObject({ status: 'draft' }, { status: 'active' });
            expect(result.status).toBe('active');
        });

        test('null new value replaces old value', () => {
            const result = mergeObject({ a: 1, b: 2 }, { b: null });
            expect(result.b).toBeNull();
        });

        test('null old value is replaced by new value', () => {
            const result = mergeObject({ a: null }, { a: 'hello' });
            expect(result.a).toBe('hello');
        });
    });

    describe('nested object merge', () => {
        test('merges nested objects deeply', () => {
            const old = { meta: { versionId: '1', lastUpdated: '2024-01-01' } };
            const newer = { meta: { versionId: '2' } };
            const result = mergeObject(old, newer);
            expect(result.meta.versionId).toBe('2');
            expect(result.meta.lastUpdated).toBe('2024-01-01');
        });

        test('deeply nested merge', () => {
            const old = { a: { b: { c: 1, d: 2 } } };
            const newer = { a: { b: { c: 3 } } };
            const result = mergeObject(old, newer);
            expect(result.a.b.c).toBe(3);
            expect(result.a.b.d).toBe(2);
        });
    });

    describe('array merge - primitives', () => {
        test('primitive arrays are replaced entirely', () => {
            const old = { tags: ['a', 'b', 'c'] };
            const newer = { tags: ['x', 'y'] };
            const result = mergeObject(old, newer);
            expect(result.tags).toEqual(['x', 'y']);
        });
    });

    describe('array merge - objects without id or sequence', () => {
        test('new unique items are appended', () => {
            const old = { name: [{ family: 'Smith' }] };
            const newer = { name: [{ family: 'Jones' }] };
            const result = mergeObject(old, newer);
            expect(result.name).toHaveLength(2);
            expect(result.name[0].family).toBe('Smith');
            expect(result.name[1].family).toBe('Jones');
        });

        test('duplicate items are not appended', () => {
            const old = { name: [{ family: 'Smith' }] };
            const newer = { name: [{ family: 'Smith' }] };
            const result = mergeObject(old, newer);
            expect(result.name).toHaveLength(1);
        });

        test('null items in new array are handled without crash', () => {
            const old = { items: [{ val: 1 }] };
            const newer = { items: [null, { val: 2 }] };
            expect(() => mergeObject(old, newer)).not.toThrow();
        });
    });

    describe('array merge - with id property', () => {
        test('merges items by matching id', () => {
            const old = { telecom: [{ id: 'phone-1', system: 'phone', value: '555-1234' }] };
            const newer = { telecom: [{ id: 'phone-1', value: '555-5678' }] };
            const result = mergeObject(old, newer);
            expect(result.telecom).toHaveLength(1);
            expect(result.telecom[0].system).toBe('phone');
            expect(result.telecom[0].value).toBe('555-5678');
        });

        test('new items with non-matching id are appended', () => {
            const old = { telecom: [{ id: 'phone-1', system: 'phone', value: '555-1234' }] };
            const newer = { telecom: [{ id: 'email-1', system: 'email', value: 'test@example.com' }] };
            const result = mergeObject(old, newer);
            expect(result.telecom).toHaveLength(2);
        });

        test('null item in old array does not crash when new item has non-matching id', () => {
            const old = { telecom: [null, { id: 'phone-1', system: 'phone', value: '555-1234' }] };
            const newer = { telecom: [{ id: 'email-1', system: 'email', value: 'test@example.com' }] };
            expect(() => mergeObject(old, newer)).not.toThrow();
            const result = mergeObject(old, newer);
            expect(result.telecom).toContainEqual({ id: 'email-1', system: 'email', value: 'test@example.com' });
        });
    });

    describe('array merge - delete by id suffix', () => {
        test('removes items when new item has id ending in -delete', () => {
            const old = {
                telecom: [
                    { id: 'phone-1', system: 'phone', value: '555-1234' },
                    { id: 'email-1', system: 'email', value: 'test@test.com' }
                ]
            };
            const newer = { telecom: [{ id: 'phone-1-delete' }] };
            const result = mergeObject(old, newer);
            expect(result.telecom).toHaveLength(1);
            expect(result.telecom[0].id).toBe('email-1');
        });

        test('delete + add in same merge', () => {
            const old = {
                address: [
                    { id: 'addr-1', city: 'Boston' },
                    { id: 'addr-2', city: 'NYC' }
                ]
            };
            const newer = {
                address: [
                    { id: 'addr-1-delete' },
                    { id: 'addr-3', city: 'LA' }
                ]
            };
            const result = mergeObject(old, newer);
            expect(result.address.find(a => a.id === 'addr-1')).toBeUndefined();
            expect(result.address.find(a => a.id === 'addr-3')).toBeDefined();
            expect(result.address.find(a => a.id === 'addr-2')).toBeDefined();
        });

        test('delete non-existent id is no-op', () => {
            const old = { items: [{ id: 'a', val: 1 }] };
            const newer = { items: [{ id: 'nonexistent-delete' }] };
            const result = mergeObject(old, newer);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].id).toBe('a');
        });
    });

    describe('array merge - with sequence property', () => {
        test('inserts at correct position based on sequence', () => {
            const old = {
                items: [
                    { sequence: 1, desc: 'first' },
                    { sequence: 3, desc: 'third' }
                ]
            };
            const newer = {
                items: [{ sequence: 2, desc: 'second' }]
            };
            const result = mergeObject(old, newer);
            expect(result.items[0].sequence).toBe(1);
            expect(result.items[1].sequence).toBe(2);
            expect(result.items[2].sequence).toBe(3);
        });

        test('appends at end when sequence is highest', () => {
            const old = { items: [{ sequence: 1, val: 'a' }] };
            const newer = { items: [{ sequence: 5, val: 'b' }] };
            const result = mergeObject(old, newer);
            expect(result.items[result.items.length - 1].sequence).toBe(5);
        });

        test('null item in old array does not crash when new item has a sequence', () => {
            const old = { items: [null, { sequence: 1, val: 'a' }] };
            const newer = { items: [{ sequence: 2, val: 'b' }] };
            expect(() => mergeObject(old, newer)).not.toThrow();
            const result = mergeObject(old, newer);
            expect(result.items).toContainEqual({ sequence: 2, val: 'b' });
        });
    });

    describe('does not mutate original objects', () => {
        test('original old object unchanged', () => {
            const old = { name: [{ family: 'Smith' }] };
            const newer = { name: [{ family: 'Jones' }] };
            mergeObject(old, newer);
            expect(old.name).toHaveLength(1);
            expect(old.name[0].family).toBe('Smith');
        });

        test('original new object unchanged', () => {
            const old = { a: 1 };
            const newer = { b: 2 };
            mergeObject(old, newer);
            expect(newer).toEqual({ b: 2 });
        });
    });

    describe('FHIR-specific merge scenarios', () => {
        test('merges Patient resource name arrays', () => {
            const existingPatient = {
                resourceType: 'Patient',
                name: [
                    { id: 'name-1', use: 'official', family: 'Smith', given: ['John'] }
                ]
            };
            const incomingPatient = {
                resourceType: 'Patient',
                name: [
                    { id: 'name-1', given: ['Jonathan'] }
                ]
            };
            const result = mergeObject(existingPatient, incomingPatient);
            expect(result.name).toHaveLength(1);
            expect(result.name[0].family).toBe('Smith');
            expect(result.name[0].given).toContain('Jonathan');
        });

        test('merges identifier arrays by id', () => {
            const old = {
                identifier: [
                    { id: 'mrn', system: 'http://hospital.org/mrn', value: '12345' }
                ]
            };
            const newer = {
                identifier: [
                    { id: 'mrn', value: '67890' }
                ]
            };
            const result = mergeObject(old, newer);
            expect(result.identifier).toHaveLength(1);
            expect(result.identifier[0].system).toBe('http://hospital.org/mrn');
            expect(result.identifier[0].value).toBe('67890');
        });
    });
});
