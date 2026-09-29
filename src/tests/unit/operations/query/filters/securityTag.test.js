const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the query builder utilities
const mockTokenQueryBuilder = jestObj.fn();

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
    tokenQueryBuilder: mockTokenQueryBuilder
}));

// Use real SystemValueParser since it's simple logic
jestObj.mock('../../../../../utils/systemValueParser', () => ({
    SystemValueParser: {
        parse: (text) => {
            const parts = text.split('|');
            if (parts.length > 1) {
                return { system: parts[0], value: parts[1] };
            }
            return { system: undefined, value: text };
        }
    }
}));

jestObj.mock('../../../../../utils/securityTagSystem', () => ({
    SecurityTagSystem: {
        access: 'https://www.icanbwell.com/access',
        owner: 'https://www.icanbwell.com/owner'
    }
}));

const { FilterBySecurityTag } = require('../../../../../operations/query/filters/securityTag');

describe('FilterBySecurityTag', () => {
    let mockFieldMapper;

    beforeEach(() => {
        mockTokenQueryBuilder.mockReset();
        mockTokenQueryBuilder.mockReturnValue({ tokenResult: true });
        mockFieldMapper = { getFieldName: jestObj.fn((f) => f) };
    });

    function createFilter(overrides = {}) {
        return new FilterBySecurityTag({
            propertyObj: overrides.propertyObj || {},
            parsedArg: overrides.parsedArg || { queryParameterValue: { value: 'test' } },
            fieldMapper: overrides.fieldMapper || mockFieldMapper,
            fnUseAccessIndex: overrides.fnUseAccessIndex || (() => false),
            resourceType: overrides.resourceType || 'Patient'
        });
    }

    describe('email fieldFilter routing', () => {
        test('routes to tokenQueryBuilder with required=email', () => {
            const filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='email']" }
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

        test('uses fieldMapper to transform field name for email', () => {
            mockFieldMapper.getFieldName.mockReturnValue('mapped.telecom');
            const filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='email']" }
            });

            filter.filterByItem('telecom', 'user@test.com');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'mapped.telecom' })
            );
            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('telecom');
        });
    });

    describe('phone fieldFilter routing', () => {
        test('routes to tokenQueryBuilder with required=phone', () => {
            const filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='phone']" }
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
    });

    describe('identifier field routing', () => {
        test('routes to tokenQueryBuilder with type=value for identifier field', () => {
            const filter = createFilter();

            filter.filterByItem('identifier', 'http://hl7.org|12345');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://hl7.org|12345',
                type: 'value',
                field: 'identifier',
                resourceType: 'Patient'
            });
        });

        test('does not include required param for identifier', () => {
            const filter = createFilter();

            filter.filterByItem('identifier', 'some-id');

            const callArgs = mockTokenQueryBuilder.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('required');
        });
    });

    describe('meta.security field', () => {
        test('uses access index when system is access and fnUseAccessIndex returns true', () => {
            const filter = createFilter({
                fnUseAccessIndex: (code) => code === 'client-a'
            });

            const result = filter.filterByItem(
                'meta.security',
                'https://www.icanbwell.com/access|client-a'
            );

            expect(result).toEqual({ '_access.client-a': 1 });
            expect(mockTokenQueryBuilder).not.toHaveBeenCalled();
        });

        test('applies fieldMapper to access index path', () => {
            mockFieldMapper.getFieldName.mockImplementation((f) => `mapped.${f}`);
            const filter = createFilter({
                fnUseAccessIndex: () => true
            });

            const result = filter.filterByItem(
                'meta.security',
                'https://www.icanbwell.com/access|my-code'
            );

            expect(result).toEqual({ 'mapped._access.my-code': 1 });
            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('_access.my-code');
        });

        test('falls back to tokenQueryBuilder when access system but fnUseAccessIndex returns false', () => {
            const filter = createFilter({
                fnUseAccessIndex: () => false
            });

            filter.filterByItem(
                'meta.security',
                'https://www.icanbwell.com/access|client-a'
            );

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'https://www.icanbwell.com/access|client-a',
                type: 'code',
                field: 'meta.security',
                resourceType: 'Patient'
            });
        });

        test('uses tokenQueryBuilder for non-access system', () => {
            const filter = createFilter({
                fnUseAccessIndex: () => true
            });

            filter.filterByItem(
                'meta.security',
                'https://www.icanbwell.com/owner|bwell'
            );

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'https://www.icanbwell.com/owner|bwell',
                type: 'code',
                field: 'meta.security',
                resourceType: 'Patient'
            });
        });

        test('uses tokenQueryBuilder when no system (bare code)', () => {
            const filter = createFilter();

            filter.filterByItem('meta.security', 'some-code');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'some-code',
                type: 'code',
                field: 'meta.security',
                resourceType: 'Patient'
            });
        });

        test('decodes URL-encoded values before parsing', () => {
            const filter = createFilter({
                fnUseAccessIndex: (code) => code === 'client-a'
            });

            // URL encode the pipe character
            const encoded = 'https%3A%2F%2Fwww.icanbwell.com%2Faccess|client-a';
            const result = filter.filterByItem('meta.security', encoded);

            // After decoding: "https://www.icanbwell.com/access|client-a"
            // system = "https://www.icanbwell.com/access", value = "client-a"
            expect(result).toEqual({ '_access.client-a': 1 });
        });

        test('decodes URL-encoded pipe character in value', () => {
            const filter = createFilter({
                fnUseAccessIndex: (code) => code === 'client-a'
            });

            // Entire value URL encoded including pipe
            const encoded = 'https%3A%2F%2Fwww.icanbwell.com%2Faccess%7Cclient-a';
            const result = filter.filterByItem('meta.security', encoded);

            // After decoding: "https://www.icanbwell.com/access|client-a"
            expect(result).toEqual({ '_access.client-a': 1 });
        });
    });

    describe('meta.tag field', () => {
        test('handles meta.tag same as meta.security with access index', () => {
            const filter = createFilter({
                fnUseAccessIndex: () => true
            });

            const result = filter.filterByItem(
                'meta.tag',
                'https://www.icanbwell.com/access|tag-code'
            );

            expect(result).toEqual({ '_access.tag-code': 1 });
        });

        test('handles meta.tag with non-access system via tokenQueryBuilder', () => {
            const filter = createFilter();

            filter.filterByItem(
                'meta.tag',
                'http://example.org/tags|active'
            );

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://example.org/tags|active',
                type: 'code',
                field: 'meta.tag',
                resourceType: 'Patient'
            });
        });
    });

    describe('default field handling (any other field)', () => {
        test('returns $or with two tokenQueryBuilder calls for field and field.coding', () => {
            mockTokenQueryBuilder
                .mockReturnValueOnce({ query1: true })
                .mockReturnValueOnce({ query2: true });

            const filter = createFilter();

            const result = filter.filterByItem('code', 'http://loinc.org|1234');

            expect(result).toEqual({
                $or: [
                    { query1: true },
                    { query2: true }
                ]
            });

            expect(mockTokenQueryBuilder).toHaveBeenCalledTimes(2);
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://loinc.org|1234',
                type: 'code',
                field: 'code',
                resourceType: 'Patient'
            });
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith({
                target: 'http://loinc.org|1234',
                type: 'code',
                field: 'code.coding',
                resourceType: 'Patient'
            });
        });

        test('uses fieldMapper for both field and field.coding in default handler', () => {
            mockFieldMapper.getFieldName.mockImplementation((f) => `mapped.${f}`);
            mockTokenQueryBuilder
                .mockReturnValueOnce({ q1: true })
                .mockReturnValueOnce({ q2: true });

            const filter = createFilter();

            filter.filterByItem('category', 'vital-signs');

            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('category');
            expect(mockFieldMapper.getFieldName).toHaveBeenCalledWith('category.coding');
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'mapped.category' })
            );
            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ field: 'mapped.category.coding' })
            );
        });

        test('passes correct resourceType through for default handler', () => {
            const filter = createFilter({ resourceType: 'Observation' });

            filter.filterByItem('status', 'active');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Observation' })
            );
        });
    });

    describe('priority of routing rules', () => {
        test('email filter takes priority over identifier field', () => {
            const filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='email']" }
            });

            // Even if field is 'identifier', email filter wins due to if-else order
            filter.filterByItem('identifier', 'test@email.com');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ required: 'email' })
            );
        });

        test('phone filter takes priority over meta.security field', () => {
            const filter = createFilter({
                propertyObj: { fieldFilter: "[system/@value='phone']" }
            });

            filter.filterByItem('meta.security', '555-0000');

            expect(mockTokenQueryBuilder).toHaveBeenCalledWith(
                expect.objectContaining({ required: 'phone' })
            );
        });
    });
});
