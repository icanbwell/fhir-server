const { describe, test, expect } = require('@jest/globals');
const { ViewDefinitionValidator } = require('../../operations/sqlOnFhir/viewDefinitionValidator');

describe('ViewDefinitionValidator', () => {
    const validator = new ViewDefinitionValidator();

    test('accepts a valid view', () => {
        expect(() =>
            validator.validate({
                resource: 'Patient',
                select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
            })
        ).not.toThrow();
    });

    test('rejects a missing resource', () => {
        expect(() =>
            validator.validate({ select: [{ column: [{ name: 'id', path: 'id' }] }] })
        ).toThrow(/resource/i);
    });

    test('rejects an empty select', () => {
        expect(() => validator.validate({ resource: 'Patient', select: [] })).toThrow(/select/i);
    });

    test('rejects a column missing name or path', () => {
        expect(() =>
            validator.validate({ resource: 'Patient', select: [{ column: [{ path: 'id' }] }] })
        ).toThrow(/name/i);
    });

    test('rejects duplicate column names across nested selects', () => {
        expect(() =>
            validator.validate({
                resource: 'Patient',
                select: [
                    { column: [{ name: 'id', path: 'getResourceKey()' }] },
                    { select: [{ column: [{ name: 'id', path: 'id' }] }] }
                ]
            })
        ).toThrow(/duplicate/i);
    });
});
