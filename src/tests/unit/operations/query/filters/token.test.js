const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the query builder utilities
const mockTokenQueryBuilder = jestObj.fn();
const mockExactMatchQueryBuilder = jestObj.fn();
const mockExtensionQueryBuilder = jestObj.fn();

jestObj.mock('../../../../../operations/query/filters/baseFilter', () => ({
    BaseFilter: class BaseFilter {
        constructor(filterParameters) {
            this.propertyObj = filterParameters.propertyObj;
            this.parsedArg = filterParameters.parsedArg;
            this.fieldMapper = filterParameters.fieldMapper;
            this.fnUseAccessIndex = filterParameters.fnUseAccessIndex;
            this.resourceType = filterParameters.resourceType;
        }
    }
}));

jestObj.mock('../../../../../utils/querybuilder.util', () => ({
    tokenQueryBuilder: mockTokenQueryBuilder,
    exactMatchQueryBuilder: mockExactMatchQueryBuilder,
    extensionQueryBuilder: mockExtensionQueryBuilder
}));

const { FilterByToken } = require('../../../../../operations/query/filters/token');

describe('FilterByToken', () => {
    let filter;
    let mockFieldMapper;

    beforeEach(() => {
        mockTokenQueryBuilder.mockReset();
        mockExactMatchQueryBuilder.mockReset();
        mockExtensionQueryBuilder.mockReset();

        mockTokenQueryBuilder.mockReturnValue({ tokenResult: true });
        mockExactMatchQueryBuilder.mockReturnValue({ exactResult: true });
        mockExtensionQueryBuilder.mockReturnValue({ extensionResult: true });

        mockFieldMapper = { getFieldName: jestObj.fn((f) => f) };
    });

    function createFilter(overrides = {}) {
        return new FilterByToken({
            propertyObj: overrides.propertyObj || { fieldType: 'string' },
            parsedArg: overrides.parsedArg || { queryParameterValue: { value: 'test' } },
            fieldMapper: overrides.fieldMapper || mockFieldMapper,
            fnUseAccessIndex: overrides.fnUseAccessIndex || (() => false),
            resourceType: overrides.resourceType || 'Patient'
        });
    }

    describe('email fieldFilter', () => {
        test('routes to tokenQueryBuilder with required=email', () => {
            filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='email']", fieldType: 'ContactPoint' }
            });

            filter.filterByItem('telecom', 'test@example.com');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'test@example.com',
                type: 'value',
                field: 'telecom',
                required: 'email',
                resourceType: 'Patient'
            });
        });

        test('uses fieldMapper.getFieldName for the field', () => {
            mockFieldMapper.getFieldName.mockReturnValue('telecom_mapped');
            filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='email']", fieldType: 'ContactPoint' }
            });

            filter.filterByItem('telecom', 'user@domain.com');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('telecom');
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'telecom_mapped' })
            );
        });

        test('returns tokenQueryBuilder result', () => {
            mockTokenQueryBuilder.mockReturnValue({ matched: 'email-filter' });
            filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='email']", fieldType: 'ContactPoint' }
            });

            const result = filter.filterByItem('telecom', 'x@y.com');

            expect(result).toEqual({ matched: 'email-filter' });
        });
    });

    describe('phone fieldFilter', () => {
        test('routes to tokenQueryBuilder with required=phone', () => {
            filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='phone']", fieldType: 'ContactPoint' }
            });

            filter.filterByItem('telecom', '555-1234');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: '555-1234',
                type: 'value',
                field: 'telecom',
                required: 'phone',
                resourceType: 'Patient'
            });
        });

        test('uses fieldMapper.getFieldName for the field', () => {
            mockFieldMapper.getFieldName.mockReturnValue('phone_mapped');
            filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='phone']", fieldType: 'ContactPoint' }
            });

            filter.filterByItem('telecom', '555-0000');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('telecom');
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'phone_mapped' })
            );
        });
    });

    describe('identifier field', () => {
        test('uses tokenQueryBuilder with type=value for identifier field', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Identifier' }
            });

            filter.filterByItem('identifier', 'http://sys|123');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://sys|123',
                type: 'value',
                field: 'identifier',
                resourceType: 'Patient'
            });
        });

        test('does NOT pass required parameter', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Identifier' }
            });

            filter.filterByItem('identifier', 'abc');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.not.objectContaining({ required: expect.anything() })
            );
        });

        test('identifier takes priority over fieldType', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' }
            });

            filter.filterByItem('identifier', 'sys|val');

            // Should hit the identifier branch, not Coding branch
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'value' })
            );
        });
    });

    describe('extension field', () => {
        test('uses extensionQueryBuilder with type=valueString', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'string' }
            });

            filter.filterByItem('extension', 'http://ext|someValue');

            expect(mockExtensionQueryBuilder).toHaveBeenCalledWith({
                target: 'http://ext|someValue',
                type: 'valueString',
                field: 'extension',
                resourceType: 'Patient'
            });
        });

        test('extension takes priority over fieldType', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'CodeableConcept' }
            });

            filter.filterByItem('extension', 'url|value');

            expect(mockExtensionQueryBuilder).toHaveBeenCalled();
            expect(mockTokenQueryBuilder).not.toHaveBeenCalled();
        });

        test('returns extensionQueryBuilder result', () => {
            mockExtensionQueryBuilder.mockReturnValue({ ext: 'result' });
            filter = createFilter({
                propertyObj: { fieldType: 'string' }
            });

            const result = filter.filterByItem('extension', 'url|val');

            expect(result).toEqual({ ext: 'result' });
        });
    });

    describe('meta.security field', () => {
        test('uses tokenQueryBuilder with type=code', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' }
            });

            filter.filterByItem('meta.security', 'http://sys|code1');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://sys|code1',
                type: 'code',
                field: 'meta.security',
                resourceType: 'Patient'
            });
        });

        test('meta.security takes priority over fieldType Coding', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' }
            });

            filter.filterByItem('meta.security', 'value');

            // Should still hit the meta.security branch specifically
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({
                    field: 'meta.security',
                    type: 'code'
                })
            );
        });
    });

    describe('meta.tag field', () => {
        test('uses tokenQueryBuilder with type=code', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' }
            });

            filter.filterByItem('meta.tag', 'http://tag|active');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://tag|active',
                type: 'code',
                field: 'meta.tag',
                resourceType: 'Patient'
            });
        });
    });

    describe('fieldType: Coding', () => {
        test('uses tokenQueryBuilder with type=code', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' }
            });

            filter.filterByItem('status', 'active');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'active',
                type: 'code',
                field: 'status',
                resourceType: 'Patient'
            });
        });

        test('does not append .coding to field for Coding type', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' }
            });

            filter.filterByItem('code', 'http://loinc|12345');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('code');
        });
    });

    describe('fieldType: CodeableConcept', () => {
        test('appends .coding to the field before passing to fieldMapper', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'CodeableConcept' }
            });

            filter.filterByItem('code', 'http://loinc|12345');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('code.coding');
        });

        test('uses tokenQueryBuilder with type=code', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'CodeableConcept' }
            });

            filter.filterByItem('category', 'http://sys|val');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://sys|val',
                type: 'code',
                field: 'category.coding',
                resourceType: 'Patient'
            });
        });

        test('mapped field name with .coding appended is used', () => {
            mockFieldMapper.getFieldName.mockImplementation((f) => `mapped_${f}`);
            filter = createFilter({
                propertyObj: { fieldType: 'CodeableConcept' }
            });

            filter.filterByItem('code', 'val');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'mapped_code.coding' })
            );
        });
    });

    describe('fieldType: Identifier', () => {
        test('uses tokenQueryBuilder with type=value', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Identifier' }
            });

            // Note: using a field name that is NOT 'identifier' to hit this branch
            filter.filterByItem('someIdentifier', 'http://sys|val');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://sys|val',
                type: 'value',
                field: 'someIdentifier',
                resourceType: 'Patient'
            });
        });
    });

    describe('fieldType: ContactPoint', () => {
        test('uses exactMatchQueryBuilder on field.value', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'ContactPoint' }
            });

            filter.filterByItem('telecom', '555-1234');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: '555-1234',
                field: 'telecom.value'
            });
        });

        test('appends .value to the field', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'ContactPoint' }
            });

            filter.filterByItem('contact', 'number');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('contact.value');
        });
    });

    describe('fieldType: boolean', () => {
        test('converts string "true" to boolean true', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'boolean' }
            });

            filter.filterByItem('active', 'true');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: true,
                field: 'active'
            });
        });

        test('converts string "false" to boolean false', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'boolean' }
            });

            filter.filterByItem('active', 'false');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: false,
                field: 'active'
            });
        });

        test('any non-"true" string becomes false', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'boolean' }
            });

            filter.filterByItem('active', 'yes');

            // value === 'true' evaluates to false for 'yes'
            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: false,
                field: 'active'
            });
        });

        test('empty string becomes false', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'boolean' }
            });

            filter.filterByItem('active', '');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: false,
                field: 'active'
            });
        });
    });

    describe('fieldType: code', () => {
        test('uses exactMatchQueryBuilder with string target', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'code' }
            });

            filter.filterByItem('status', 'active');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: 'active',
                field: 'status'
            });
        });
    });

    describe('fieldType: uri', () => {
        test('uses exactMatchQueryBuilder with string target', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'uri' }
            });

            filter.filterByItem('url', 'http://example.com/fhir');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: 'http://example.com/fhir',
                field: 'url'
            });
        });
    });

    describe('fieldType: string', () => {
        test('uses exactMatchQueryBuilder with string target', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'string' }
            });

            filter.filterByItem('name', 'Smith');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: 'Smith',
                field: 'name'
            });
        });
    });

    describe('unknown fieldType (default)', () => {
        test('returns $or with 3 alternatives', () => {
            mockExactMatchQueryBuilder.mockReturnValue({ exact: 'match' });
            mockTokenQueryBuilder
                .mockReturnValueOnce({ token: 'field' })
                .mockReturnValueOnce({ token: 'field.coding' });

            filter = createFilter({
                propertyObj: { fieldType: 'UnknownType' }
            });

            const result = filter.filterByItem('someField', 'someValue');

            expect(result).toHaveProperty('$or');
            expect(result.$or).toHaveLength(3);
        });

        test('first alternative is exactMatchQueryBuilder on the field', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'SomeRandomType' }
            });

            filter.filterByItem('myField', 'myValue');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: 'myValue',
                field: 'myField'
            });
        });

        test('second alternative is tokenQueryBuilder with type=code on field', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'SomeRandomType' }
            });

            filter.filterByItem('myField', 'myValue');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'myValue',
                type: 'code',
                field: 'myField',
                resourceType: 'Patient'
            });
        });

        test('third alternative is tokenQueryBuilder with type=code on field.coding', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'SomeRandomType' }
            });

            filter.filterByItem('myField', 'myValue');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'myValue',
                type: 'code',
                field: 'myField.coding',
                resourceType: 'Patient'
            });
        });

        test('fieldMapper.getFieldName is called for field and field.coding', () => {
            filter = createFilter({
                propertyObj: { fieldType: undefined }
            });

            filter.filterByItem('someField', 'val');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('someField');
            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('someField.coding');
        });
    });

    describe('resourceType propagation', () => {
        test('passes the correct resourceType to tokenQueryBuilder', () => {
            filter = createFilter({
                propertyObj: { fieldType: 'Coding' },
                resourceType: 'Observation'
            });

            filter.filterByItem('code', 'val');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Observation' })
            );
        });
    });

    describe('fieldMapper integration', () => {
        test('fieldMapper transforms field names', () => {
            mockFieldMapper.getFieldName.mockImplementation((f) => `prefix.${f}`);
            filter = createFilter({
                propertyObj: { fieldType: 'code' }
            });

            filter.filterByItem('status', 'active');

            expect(mockExactMatchQueryBuilder).toHaveBeenCalledWith({
                target: 'active',
                field: 'prefix.status'
            });
        });
    });
});
