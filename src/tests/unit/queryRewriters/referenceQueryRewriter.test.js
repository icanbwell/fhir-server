const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../utils/referenceParser', () => {
    const { jest: j } = require('@jest/globals');
    return {
        ReferenceParser: {
            parseReference: j.fn(),
            createReference: j.fn()
        }
    };
});

jest.mock('../../../utils/uid.util', () => {
    const { jest: j } = require('@jest/globals');
    return {
        isUuid: j.fn(),
        generateUUIDv5: j.fn()
    };
});

const { ReferenceQueryRewriter } = require('../../../queryRewriters/rewriters/referenceQueryRewriter');
const { QueryParameterValue } = require('../../../operations/query/queryParameterValue');
const { fhirFilterTypes } = require('../../../operations/query/customQueries');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { isUuid, generateUUIDv5 } = require('../../../utils/uid.util');

describe('ReferenceQueryRewriter', () => {
    let rewriter;

    beforeEach(() => {
        rewriter = new ReferenceQueryRewriter();
        jest.clearAllMocks();
    });

    /**
     * Helper to build a parsedArgs object with a single parsedArgItem
     */
    function buildParsedArgs ({ queryParameter, propertyObj, value, operator }) {
        return {
            parsedArgItems: [
                {
                    queryParameter,
                    propertyObj,
                    queryParameterValue: new QueryParameterValue({
                        value,
                        operator: operator || '$and'
                    })
                }
            ]
        };
    }

    describe('happy path - UUID references pass through correctly', () => {
        test('should rewrite a UUID reference using createReference with resourceType', async () => {
            const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: 'Patient',
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference.mockReturnValue(`Patient/${uuid}`);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: `Patient/${uuid}`
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.parseReference).toHaveBeenCalledWith(`Patient/${uuid}`);
            expect(isUuid).toHaveBeenCalledWith(uuid);
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                resourceType: 'Patient',
                id: uuid
            });
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(`Patient/${uuid}`);
        });

        test('should handle _id query parameter even without reference type in propertyObj', async () => {
            const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: undefined,
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference.mockReturnValue(uuid);

            const parsedArgs = buildParsedArgs({
                queryParameter: '_id',
                propertyObj: { type: fhirFilterTypes.string },
                value: uuid
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                resourceType: undefined,
                id: uuid
            });
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(uuid);
        });

        test('should handle id query parameter', async () => {
            const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: undefined,
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference.mockReturnValue(uuid);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'id',
                propertyObj: { type: fhirFilterTypes.string },
                value: uuid
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                resourceType: undefined,
                id: uuid
            });
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(uuid);
        });
    });

    describe('non-reference query parameters are not rewritten', () => {
        test('should not rewrite string-type parameters that are not _id or id', async () => {
            const parsedArgs = buildParsedArgs({
                queryParameter: 'name',
                propertyObj: { type: fhirFilterTypes.string },
                value: 'John'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.parseReference).not.toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe('John');
        });

        test('should not rewrite token-type parameters', async () => {
            const parsedArgs = buildParsedArgs({
                queryParameter: 'identifier',
                propertyObj: { type: fhirFilterTypes.token },
                value: 'http://example.org|12345'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.parseReference).not.toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe('http://example.org|12345');
        });

        test('should not rewrite date-type parameters', async () => {
            const parsedArgs = buildParsedArgs({
                queryParameter: 'date',
                propertyObj: { type: fhirFilterTypes.date },
                value: '2023-01-01'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.parseReference).not.toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe('2023-01-01');
        });
    });

    describe('sourceAssigningAuthority-based UUID generation', () => {
        test('should generate deterministic UUID when sourceAssigningAuthority is present', async () => {
            const generatedUuid = 'aaaaaaaa-bbbb-5ccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: '12345',
                resourceType: 'Patient',
                sourceAssigningAuthority: 'clientA'
            });
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue(generatedUuid);
            ReferenceParser.createReference.mockReturnValue(`Patient/${generatedUuid}`);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/12345|clientA'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(generateUUIDv5).toHaveBeenCalledWith('12345|clientA');
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                resourceType: 'Patient',
                id: generatedUuid
            });
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(`Patient/${generatedUuid}`);
        });

        test('should produce the same UUID for the same id and sourceAssigningAuthority combination', async () => {
            const generatedUuid = 'aaaaaaaa-bbbb-5ccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: '12345',
                resourceType: 'Patient',
                sourceAssigningAuthority: 'clientA'
            });
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue(generatedUuid);
            ReferenceParser.createReference.mockReturnValue(`Patient/${generatedUuid}`);

            const parsedArgs1 = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/12345|clientA'
            });
            const parsedArgs2 = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/12345|clientA'
            });

            await rewriter.rewriteArgsAsync({ parsedArgs: parsedArgs1 });
            await rewriter.rewriteArgsAsync({ parsedArgs: parsedArgs2 });

            // Both calls should use the same input to generateUUIDv5
            expect(generateUUIDv5).toHaveBeenCalledTimes(2);
            expect(generateUUIDv5).toHaveBeenNthCalledWith(1, '12345|clientA');
            expect(generateUUIDv5).toHaveBeenNthCalledWith(2, '12345|clientA');
        });

        test('should produce different UUIDs for different sourceAssigningAuthority values', async () => {
            ReferenceParser.parseReference
                .mockReturnValueOnce({
                    id: '12345',
                    resourceType: 'Patient',
                    sourceAssigningAuthority: 'clientA'
                })
                .mockReturnValueOnce({
                    id: '12345',
                    resourceType: 'Patient',
                    sourceAssigningAuthority: 'clientB'
                });
            isUuid.mockReturnValue(false);
            generateUUIDv5
                .mockReturnValueOnce('uuid-for-clientA')
                .mockReturnValueOnce('uuid-for-clientB');
            ReferenceParser.createReference
                .mockReturnValueOnce('Patient/uuid-for-clientA')
                .mockReturnValueOnce('Patient/uuid-for-clientB');

            const parsedArgsA = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/12345|clientA'
            });
            const parsedArgsB = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/12345|clientB'
            });

            const resultA = await rewriter.rewriteArgsAsync({ parsedArgs: parsedArgsA });
            const resultB = await rewriter.rewriteArgsAsync({ parsedArgs: parsedArgsB });

            expect(generateUUIDv5).toHaveBeenNthCalledWith(1, '12345|clientA');
            expect(generateUUIDv5).toHaveBeenNthCalledWith(2, '12345|clientB');
            expect(resultA.parsedArgItems[0].queryParameterValue.value).toBe('Patient/uuid-for-clientA');
            expect(resultB.parsedArgItems[0].queryParameterValue.value).toBe('Patient/uuid-for-clientB');
        });
    });

    describe('values without UUID or sourceAssigningAuthority pass through unchanged', () => {
        test('should return original value when id is not UUID and no sourceAssigningAuthority', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'simple-id',
                resourceType: 'Patient',
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(false);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/simple-id'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.createReference).not.toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe('Patient/simple-id');
        });
    });

    describe('SECURITY: comma-separated value injection via join()', () => {
        test('join() with multiple values creates a comma-separated string that QueryParameterValue splits', async () => {
            // The rewriter uses newValues.join() which defaults to comma separator.
            // When the resulting comma-separated string is passed to QueryParameterValue,
            // it will be split on commas and operator set to $or.
            // This means multiple values will be joined and re-split, changing semantics.
            const uuid1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            const uuid2 = 'ffffffff-1111-2222-3333-444444444444';

            ReferenceParser.parseReference
                .mockReturnValueOnce({ id: uuid1, resourceType: 'Patient', sourceAssigningAuthority: undefined })
                .mockReturnValueOnce({ id: uuid2, resourceType: 'Patient', sourceAssigningAuthority: undefined });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference
                .mockReturnValueOnce(`Patient/${uuid1}`)
                .mockReturnValueOnce(`Patient/${uuid2}`);

            // Start with a comma-separated value (multiple values)
            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: `Patient/${uuid1},Patient/${uuid2}`,
                operator: '$or'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // The rewritten value is joined with comma into a single string
            const rewrittenValue = result.parsedArgItems[0].queryParameterValue.value;
            expect(rewrittenValue).toBe(`Patient/${uuid1},Patient/${uuid2}`);

            // The QueryParameterValue splits this back into an array via the values getter
            const values = result.parsedArgItems[0].queryParameterValue.values;
            expect(values).toEqual([`Patient/${uuid1}`, `Patient/${uuid2}`]);
        });

        test('a value containing a comma gets incorrectly split after join', async () => {
            // If a single reference value happens to contain a comma (edge case),
            // after join() it becomes part of the comma-separated string and
            // QueryParameterValue will split it into multiple values
            const commaValue = 'Organization/org,name-with-comma';
            ReferenceParser.parseReference.mockReturnValue({
                id: 'org,name-with-comma',
                resourceType: 'Organization',
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(false);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'performer',
                propertyObj: { type: fhirFilterTypes.reference },
                value: commaValue
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // The value passes through unchanged since it's not UUID and no sourceAssigningAuthority
            const rewrittenValue = result.parsedArgItems[0].queryParameterValue.value;
            expect(rewrittenValue).toBe(commaValue);

            // But QueryParameterValue will split on the comma, creating two values
            // This is the bug: a single value with a comma becomes two values
            const values = result.parsedArgItems[0].queryParameterValue.values;
            expect(values).toHaveLength(2);
            expect(values).toEqual(['Organization/org', 'name-with-comma']);
        });
    });

    describe('SECURITY: sourceAssigningAuthority hash collision attack vector', () => {
        test('attacker-controlled sourceAssigningAuthority generates UUID from concatenated string', async () => {
            // An attacker can craft sourceAssigningAuthority such that
            // `${id}|${sourceAssigningAuthority}` produces a UUID matching another resource.
            // For example, id="123" with saa="client" generates UUID from "123|client"
            // But id="123|cli" with saa="ent" also generates UUID from "123|cli|ent" (different)
            // The pipe in the concatenation format means the attacker needs to find
            // a collision in UUIDv5, but the input is fully attacker-controlled.

            ReferenceParser.parseReference.mockReturnValue({
                id: 'malicious-id',
                resourceType: 'Patient',
                sourceAssigningAuthority: 'attacker-saa'
            });
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue('target-resource-uuid');
            ReferenceParser.createReference.mockReturnValue('Patient/target-resource-uuid');

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/malicious-id|attacker-saa'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // The UUID is generated purely from attacker-controlled input
            expect(generateUUIDv5).toHaveBeenCalledWith('malicious-id|attacker-saa');
            // The rewritten reference now points to the target UUID
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe('Patient/target-resource-uuid');
        });

        test('different id|saa combinations that could produce same hash input are disambiguated by pipe', async () => {
            // Verify that "id1|saa1" and "id1|" + "saa1" go through different code paths
            // "123|client" as id with no saa vs "123" as id with "client" as saa
            ReferenceParser.parseReference
                .mockReturnValueOnce({
                    id: '123',
                    resourceType: 'Patient',
                    sourceAssigningAuthority: 'client'
                })
                .mockReturnValueOnce({
                    id: '123|client',
                    resourceType: 'Patient',
                    sourceAssigningAuthority: undefined
                });

            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue('generated-uuid');
            ReferenceParser.createReference.mockReturnValue('Patient/generated-uuid');

            const parsedArgs1 = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/123|client'
            });

            const parsedArgs2 = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: 'Patient/123|client'
            });

            await rewriter.rewriteArgsAsync({ parsedArgs: parsedArgs1 });
            await rewriter.rewriteArgsAsync({ parsedArgs: parsedArgs2 });

            // First call: id="123", saa="client" -> generates UUID from "123|client"
            expect(generateUUIDv5).toHaveBeenCalledWith('123|client');

            // Second call: id="123|client", saa=undefined -> no UUID generation, passes through
            expect(generateUUIDv5).toHaveBeenCalledTimes(1);
        });
    });

    describe('BUG: rewriter applies to ALL reference-type parsedArgItems', () => {
        test('rewrites all parsedArgItems with type=reference, not just the target field', async () => {
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: 'Patient',
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference.mockReturnValue(`Patient/${uuid}`);

            // Simulate multiple reference-type parsedArgItems in the same query
            const parsedArgs = {
                parsedArgItems: [
                    {
                        queryParameter: 'subject',
                        propertyObj: { type: fhirFilterTypes.reference },
                        queryParameterValue: new QueryParameterValue({
                            value: `Patient/${uuid}`,
                            operator: '$and'
                        })
                    },
                    {
                        queryParameter: '_security',
                        propertyObj: { type: fhirFilterTypes.reference },
                        queryParameterValue: new QueryParameterValue({
                            value: `Patient/${uuid}`,
                            operator: '$and'
                        })
                    }
                ]
            };

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // Both items get rewritten because both have type=reference
            // This is a bug: security-related fields should not be rewritten
            expect(ReferenceParser.parseReference).toHaveBeenCalledTimes(2);
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(`Patient/${uuid}`);
            expect(result.parsedArgItems[1].queryParameterValue.value).toBe(`Patient/${uuid}`);
        });
    });

    describe('BUG: empty resourceType produces invalid reference format', () => {
        test('when parseReference returns undefined resourceType, createReference produces id-only reference', async () => {
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: undefined,
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            // When resourceType is undefined, createReference returns just the id
            ReferenceParser.createReference.mockReturnValue(uuid);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: uuid
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // createReference is called with undefined resourceType
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                resourceType: undefined,
                id: uuid
            });
            // The resulting reference has no resourceType prefix
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(uuid);
        });

        test('when sourceAssigningAuthority is present but resourceType is empty, invalid reference is created', async () => {
            const generatedUuid = 'aaaaaaaa-bbbb-5ccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: '12345',
                resourceType: undefined,
                sourceAssigningAuthority: 'clientA'
            });
            isUuid.mockReturnValue(false);
            generateUUIDv5.mockReturnValue(generatedUuid);
            // Without resourceType, createReference returns just the uuid (no slash prefix)
            ReferenceParser.createReference.mockReturnValue(generatedUuid);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: '12345|clientA'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // createReference is called with undefined resourceType
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                resourceType: undefined,
                id: generatedUuid
            });
            // For a reference-type query parameter, a value without resourceType
            // prefix is potentially invalid in FHIR context
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(generatedUuid);
        });
    });

    describe('edge cases', () => {
        test('should handle parsedArgItem with no values (values returns null)', async () => {
            const parsedArgs = {
                parsedArgItems: [
                    {
                        queryParameter: 'subject',
                        propertyObj: { type: fhirFilterTypes.reference },
                        queryParameterValue: new QueryParameterValue({
                            value: '',
                            operator: '$and'
                        })
                    }
                ]
            };

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            // values returns null for empty string, so the rewriter skips it
            expect(ReferenceParser.parseReference).not.toHaveBeenCalled();
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe('');
        });

        test('should handle parsedArgItem with no propertyObj', async () => {
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: undefined,
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference.mockReturnValue(uuid);

            // _id without propertyObj should still be rewritten
            const parsedArgs = {
                parsedArgItems: [
                    {
                        queryParameter: '_id',
                        propertyObj: undefined,
                        queryParameterValue: new QueryParameterValue({
                            value: uuid,
                            operator: '$and'
                        })
                    }
                ]
            };

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(ReferenceParser.parseReference).toHaveBeenCalledWith(uuid);
            expect(result.parsedArgItems[0].queryParameterValue.value).toBe(uuid);
        });

        test('should preserve the operator from the original queryParameterValue', async () => {
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            ReferenceParser.parseReference.mockReturnValue({
                id: uuid,
                resourceType: 'Patient',
                sourceAssigningAuthority: undefined
            });
            isUuid.mockReturnValue(true);
            ReferenceParser.createReference.mockReturnValue(`Patient/${uuid}`);

            const parsedArgs = buildParsedArgs({
                queryParameter: 'subject',
                propertyObj: { type: fhirFilterTypes.reference },
                value: `Patient/${uuid}`,
                operator: '$or'
            });

            const result = await rewriter.rewriteArgsAsync({ parsedArgs });

            expect(result.parsedArgItems[0].queryParameterValue.operator).toBe('$or');
        });
    });
});
