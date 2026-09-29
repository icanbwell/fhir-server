'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { resourceReferenceUpdater } = require('../../../utils/resourceUpdater');

describe('resourceReferenceUpdater', () => {
    test('updates reference objects using provided function', async () => {
        const obj = {
            subject: { reference: 'Patient/123' },
            name: 'test'
        };
        const updateFn = jestObj.fn(async (ref) => ({
            ...ref,
            reference: ref.reference + '-updated'
        }));

        const result = await resourceReferenceUpdater(obj, updateFn);

        expect(result.subject.reference).toBe('Patient/123-updated');
        expect(updateFn).toHaveBeenCalledTimes(1);
    });

    test('recursively processes nested objects', async () => {
        const obj = {
            contained: {
                inner: {
                    performer: { reference: 'Practitioner/456' }
                }
            }
        };
        const updateFn = jestObj.fn(async (ref) => ({
            ...ref,
            reference: 'UPDATED'
        }));

        const result = await resourceReferenceUpdater(obj, updateFn);

        expect(result.contained.inner.performer.reference).toBe('UPDATED');
    });

    test('returns null/undefined inputs unchanged', async () => {
        const updateFn = jestObj.fn();
        expect(await resourceReferenceUpdater(null, updateFn)).toBeNull();
        expect(await resourceReferenceUpdater(undefined, updateFn)).toBeUndefined();
        expect(updateFn).not.toHaveBeenCalled();
    });

    test('returns non-object inputs unchanged', async () => {
        const updateFn = jestObj.fn();
        expect(await resourceReferenceUpdater('string', updateFn)).toBe('string');
        expect(await resourceReferenceUpdater(42, updateFn)).toBe(42);
    });

    test('handles arrays as objects (iterates entries)', async () => {
        const obj = {
            entry: [
                { resource: { subject: { reference: 'Patient/1' } } },
                { resource: { subject: { reference: 'Patient/2' } } }
            ]
        };
        const updateFn = jestObj.fn(async (ref) => ({
            ...ref,
            reference: ref.reference + '!'
        }));

        await resourceReferenceUpdater(obj, updateFn);

        expect(updateFn).toHaveBeenCalledTimes(2);
    });

    test('does not call updateFn for non-string reference values', async () => {
        const obj = {
            subject: { reference: 123 }
        };
        const updateFn = jestObj.fn();

        await resourceReferenceUpdater(obj, updateFn);

        expect(updateFn).not.toHaveBeenCalled();
    });

    test('does not call updateFn for objects without reference key', async () => {
        const obj = {
            meta: { versionId: '1', lastUpdated: '2023-01-01' }
        };
        const updateFn = jestObj.fn();

        await resourceReferenceUpdater(obj, updateFn);

        expect(updateFn).not.toHaveBeenCalled();
    });
});
