const { describe, test, expect } = require('@jest/globals');
const { runView } = require('../../operations/sqlOnFhir/viewRunner');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

const fhirPathEvaluator = new FhirPathEvaluator();

async function collect(view, resources) {
    const rows = [];
    for await (const row of runView(view, resources, { fhirPathEvaluator })) {
        rows.push(row);
    }
    return rows;
}

const patients = [
    {
        resourceType: 'Patient',
        id: 'p1',
        active: true,
        name: [{ family: 'Smith', given: ['Jane', 'Q'] }]
    },
    { resourceType: 'Patient', id: 'p2', active: false, name: [{ family: 'Jones' }] }
];

describe('runView', () => {
    test('one row per resource with scalar columns', async () => {
        const view = {
            resource: 'Patient',
            select: [
                {
                    column: [
                        { name: 'id', path: 'getResourceKey()' },
                        { name: 'family', path: 'name.family.first()' }
                    ]
                }
            ]
        };
        expect(await collect(view, patients)).toEqual([
            { id: 'p1', family: 'Smith' },
            { id: 'p2', family: 'Jones' }
        ]);
    });

    test('where filters resources', async () => {
        const view = {
            resource: 'Patient',
            where: [{ path: 'active = true' }],
            select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
        };
        expect(await collect(view, patients)).toEqual([{ id: 'p1' }]);
    });

    test('collection column yields an array', async () => {
        const view = {
            resource: 'Patient',
            select: [{ column: [{ name: 'given', path: 'name.given', collection: true }] }]
        };
        expect(await collect(view, [patients[0]])).toEqual([{ given: ['Jane', 'Q'] }]);
    });

    test('forEach produces one row per element', async () => {
        const view = {
            resource: 'Patient',
            select: [
                { column: [{ name: 'id', path: 'getResourceKey()' }] },
                { forEach: 'name.given', column: [{ name: 'given', path: '$this' }] }
            ]
        };
        expect(await collect(view, [patients[0]])).toEqual([
            { id: 'p1', given: 'Jane' },
            { id: 'p1', given: 'Q' }
        ]);
    });

    test('scalar column with multiple values throws (D1)', async () => {
        const view = {
            resource: 'Patient',
            select: [{ column: [{ name: 'given', path: 'name.given' }] }]
        };
        await expect(collect(view, [patients[0]])).rejects.toThrow(/single|collection/i);
    });
});
