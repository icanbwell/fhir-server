const { describe, test, expect } = require('@jest/globals');
const { WriteItem } = require('../../../../operations/writePipeline/writeItem');

describe('WriteItem', () => {
    test.each([
        { field: 'adminChange', expected: null },
        { field: 'importLine', expected: null },
        { field: 'linked', expected: [] }
    ])('a new item has $field defaulted to $expected', ({ field, expected }) => {
        const item = new WriteItem({ index: 0, incoming: { resourceType: 'Person', id: 'person-1' } });

        expect(item[field]).toStrictEqual(expected);
    });

    test('each item gets its own linked array', () => {
        const first = new WriteItem({ index: 0, incoming: { resourceType: 'Person', id: 'person-1' } });
        const second = new WriteItem({ index: 1, incoming: { resourceType: 'Person', id: 'person-2' } });

        first.linked.push({ resourceType: 'Patient', resource: { resourceType: 'Patient', id: 'patient-1' } });

        expect(second.linked).toStrictEqual([]);
    });

    test('an item keeps the import line it is given', () => {
        const importLine = { byteOffset: 42 };

        const item = new WriteItem({ index: 0, incoming: { resourceType: 'Patient', id: 'patient-1' }, importLine });

        expect(item.importLine).toStrictEqual({ byteOffset: 42 });
    });
});
