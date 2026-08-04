'use strict';

const { describe, test, expect } = require('@jest/globals');
const { validateReferences, fastValidateReferences } = require('../../../utils/referenceValidator');

/**
 * Helper: creates an object whose constructor.name === 'Reference'
 */
function createReferenceInstance(referenceValue) {
    function Reference() {
        this.reference = referenceValue;
    }
    return new Reference();
}

describe('referenceValidator', () => {
    describe('checkReferenceValue (tested via fastValidateReferences)', () => {
        describe('contained references (starts with #)', () => {
            test('valid contained reference passes', () => {
                const resource = {
                    subject: { reference: '#contained-1' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toEqual([]);
            });

            test('SECURITY: reference with only "#" passes validation but refers to nothing', () => {
                const resource = {
                    subject: { reference: '#' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // Bug: '#' alone passes isContainedReference because referenceValue[0] === '#'
                // but it does not actually reference any contained resource
                expect(errors).toEqual([]);
            });
        });

        describe('absolute URLs', () => {
            test('https URL passes', () => {
                const resource = {
                    subject: { reference: 'https://example.com/Patient/123' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toEqual([]);
            });

            test('http URL passes', () => {
                const resource = {
                    subject: { reference: 'http://example.com/Patient/123' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toEqual([]);
            });

            test('SECURITY: protocol-relative URL //evil.com/Patient/1 passes as absolute URL', () => {
                const resource = {
                    subject: { reference: '//evil.com/Patient/1' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // Bug: /^(?:[a-z+]+:)?\/\//i matches protocol-relative URLs
                // because the protocol part is optional (the `?` after the group)
                expect(errors).toEqual([]);
            });

            test('custom protocol like fhir+https:// passes', () => {
                const resource = {
                    subject: { reference: 'fhir+https://server.com/Patient/1' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toEqual([]);
            });
        });

        describe('relative URLs', () => {
            test('valid relative reference Patient/123 passes', () => {
                const resource = {
                    subject: { reference: 'Patient/123' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toEqual([]);
            });

            test('valid relative reference Observation/abc-def passes', () => {
                const resource = {
                    subject: { reference: 'Observation/abc-def' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toEqual([]);
            });

            test('SECURITY: Patient/123/extra (2 slashes) fails validation even though some nested FHIR paths exist', () => {
                const resource = {
                    subject: { reference: 'Patient/123/extra' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // Bug: split('/').length - 1 === 1 means exactly one slash required
                // Two slashes means split produces 3 parts, length-1 = 2 !== 1 -> fails
                expect(errors).toHaveLength(1);
                expect(errors[0]).toContain('Patient/123/extra');
                expect(errors[0]).toContain('invalid reference');
            });

            test('SECURITY: Patient/123|tenant-a (pipe in reference) passes because it has exactly 1 slash', () => {
                const resource = {
                    subject: { reference: 'Patient/123|tenant-a' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // Bug: pipe characters in IDs should be invalid per business rules
                // but isRelativeUrl only checks slash count, not ID format
                expect(errors).toEqual([]);
            });
        });

        describe('invalid references', () => {
            test('plain string with no slashes fails', () => {
                const resource = {
                    subject: { reference: 'invalid-no-slash' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toHaveLength(1);
                expect(errors[0]).toContain('invalid-no-slash');
                expect(errors[0]).toContain('invalid reference');
            });

            test('reference with three slashes (not absolute URL) fails', () => {
                const resource = {
                    subject: { reference: 'Patient/123/history/1' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                expect(errors).toHaveLength(1);
                expect(errors[0]).toContain('Patient/123/history/1');
            });

            test('string with only slashes like "///" fails since not matching absolute URL regex fully', () => {
                // "///" has the pattern of protocol-relative URL (starts with //)
                // The regex /^(?:[a-z+]+:)?\/\//i actually matches "///" because it starts with //
                const resource = {
                    subject: { reference: '///' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // Matches absolute URL regex, so no error
                expect(errors).toEqual([]);
            });
        });

        describe('empty and falsy references', () => {
            test('SECURITY: empty string reference returns no error (treated as no reference)', () => {
                const resource = {
                    subject: { reference: '' }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // Bug: empty string is falsy, so checkReferenceValue returns null (no error)
                // But an empty reference field is invalid FHIR
                expect(errors).toEqual([]);
            });

            test('reference value of null has no reference property string check', () => {
                const resource = {
                    subject: { reference: null }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // fastValidateReferences checks typeof value.reference === 'string'
                // null is not a string, so it won't call checkReferenceValue
                expect(errors).toEqual([]);
            });

            test('reference value of undefined skips validation', () => {
                const resource = {
                    subject: { reference: undefined }
                };
                const errors = fastValidateReferences(resource, 'Resource');
                // typeof undefined !== 'string', so it won't call checkReferenceValue
                expect(errors).toEqual([]);
            });
        });
    });

    describe('validateReferences (constructor.name check)', () => {
        test('SECURITY: plain objects are NOT detected as References (constructor.name !== "Reference")', () => {
            const resource = {
                subject: { reference: 'invalid-no-slash' }
            };
            const errors = validateReferences(resource, 'Resource');
            // Bug: plain objects have constructor.name === 'Object', not 'Reference'
            // So the reference check is never triggered; no errors reported
            expect(errors).toEqual([]);
        });

        test('Reference class instances ARE detected and validated', () => {
            const ref = createReferenceInstance('invalid-no-slash');
            const resource = { subject: ref };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('invalid-no-slash');
            expect(errors[0]).toContain('invalid reference');
        });

        test('valid Reference class instance with correct relative reference passes', () => {
            const ref = createReferenceInstance('Patient/123');
            const resource = { subject: ref };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toEqual([]);
        });

        test('valid Reference class instance with contained reference passes', () => {
            const ref = createReferenceInstance('#contained-1');
            const resource = { subject: ref };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toEqual([]);
        });

        test('valid Reference class instance with absolute URL passes', () => {
            const ref = createReferenceInstance('https://fhir.example.com/Patient/456');
            const resource = { subject: ref };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toEqual([]);
        });

        test('null resourceObj returns empty array', () => {
            const errors = validateReferences(null, 'Resource');
            expect(errors).toEqual([]);
        });

        test('undefined resourceObj returns empty array', () => {
            const errors = validateReferences(undefined, 'Resource');
            expect(errors).toEqual([]);
        });
    });

    describe('fastValidateReferences (duck-typing)', () => {
        test('detects invalid references on plain objects (more reliable than validateReferences)', () => {
            const resource = {
                subject: { reference: 'invalid-no-slash' }
            };
            const errors = fastValidateReferences(resource, 'Resource');
            // fastValidateReferences uses duck-typing: checks for 'reference' property
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('invalid-no-slash');
        });

        test('null resourceObj returns empty array', () => {
            const errors = fastValidateReferences(null, 'Resource');
            expect(errors).toEqual([]);
        });

        test('undefined resourceObj returns empty array', () => {
            const errors = fastValidateReferences(undefined, 'Resource');
            expect(errors).toEqual([]);
        });

        test('non-object resourceObj returns empty array', () => {
            const errors = fastValidateReferences('string-value', 'Resource');
            expect(errors).toEqual([]);
        });

        test('number resourceObj returns empty array', () => {
            const errors = fastValidateReferences(42, 'Resource');
            expect(errors).toEqual([]);
        });
    });

    describe('recursive traversal', () => {
        test('deeply nested references are found by fastValidateReferences', () => {
            const resource = {
                level1: {
                    level2: {
                        level3: {
                            level4: {
                                subject: { reference: 'no-slash-invalid' }
                            }
                        }
                    }
                }
            };
            const errors = fastValidateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('no-slash-invalid');
            expect(errors[0]).toContain('Resource.level1.level2.level3.level4.subject');
        });

        test('deeply nested Reference instances are found by validateReferences', () => {
            const ref = createReferenceInstance('no-slash-invalid');
            const resource = {
                level1: {
                    level2: {
                        level3: {
                            subject: ref
                        }
                    }
                }
            };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('no-slash-invalid');
            expect(errors[0]).toContain('Resource.level1.level2.level3.subject');
        });

        test('multiple invalid references at different depths are all reported', () => {
            const resource = {
                subject: { reference: 'bad-ref-one' },
                nested: {
                    performer: { reference: 'bad-ref-two' },
                    deep: {
                        focus: { reference: 'bad-ref-three' }
                    }
                }
            };
            const errors = fastValidateReferences(resource, 'Resource');
            expect(errors).toHaveLength(3);
            expect(errors).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('bad-ref-one'),
                    expect.stringContaining('bad-ref-two'),
                    expect.stringContaining('bad-ref-three')
                ])
            );
        });

        test('mix of valid and invalid references reports only invalid ones', () => {
            const resource = {
                subject: { reference: 'Patient/123' },
                performer: { reference: 'no-slash' },
                contained: { reference: '#local' },
                basedOn: { reference: 'https://example.com/ServiceRequest/1' },
                focus: { reference: 'also-no-slash' }
            };
            const errors = fastValidateReferences(resource, 'Resource');
            expect(errors).toHaveLength(2);
            expect(errors[0]).toContain('no-slash');
            expect(errors[1]).toContain('also-no-slash');
        });
    });

    describe('arrays of references', () => {
        test('validateReferences handles arrays of Reference instances', () => {
            const refs = [
                createReferenceInstance('Patient/1'),
                createReferenceInstance('bad-ref'),
                createReferenceInstance('Patient/2')
            ];
            const errors = validateReferences(refs, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('bad-ref');
        });

        test('validateReferences iterates array with index in path', () => {
            const refs = [
                createReferenceInstance('Patient/1'),
                createReferenceInstance('no-slash-here')
            ];
            const errors = validateReferences(refs, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Resource.1');
        });

        test('fastValidateReferences handles objects containing arrays with references', () => {
            const resource = {
                performer: [
                    { reference: 'Practitioner/1' },
                    { reference: 'bad-reference' },
                    { reference: 'Practitioner/2' }
                ]
            };
            const errors = fastValidateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('bad-reference');
        });

        test('fastValidateReferences handles nested arrays', () => {
            const resource = {
                contained: [
                    {
                        subject: { reference: 'invalid-one' }
                    },
                    {
                        subject: { reference: 'Patient/valid' }
                    },
                    {
                        subject: { reference: 'invalid-two' }
                    }
                ]
            };
            const errors = fastValidateReferences(resource, 'Resource');
            expect(errors).toHaveLength(2);
            expect(errors).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('invalid-one'),
                    expect.stringContaining('invalid-two')
                ])
            );
        });

        test('empty array returns no errors', () => {
            const errors = validateReferences([], 'Resource');
            expect(errors).toEqual([]);
        });
    });

    describe('path construction', () => {
        test('path is correctly built for nested properties', () => {
            const resource = {
                subject: { reference: 'no-slash' }
            };
            const errors = fastValidateReferences(resource, 'Bundle.entry');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Bundle.entry.subject');
        });

        test('path works with empty initial path', () => {
            const resource = {
                subject: { reference: 'no-slash' }
            };
            const errors = fastValidateReferences(resource, '');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('subject');
        });

        test('validateReferences builds path for array indices', () => {
            const refs = [
                createReferenceInstance('no-slash')
            ];
            const errors = validateReferences(refs, 'Bundle');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('Bundle.0');
        });
    });

    describe('edge cases', () => {
        test('object with reference property that is not a string is skipped by fastValidateReferences', () => {
            const resource = {
                subject: { reference: 12345 }
            };
            const errors = fastValidateReferences(resource, 'Resource');
            // typeof value.reference === 'string' check fails for number
            expect(errors).toEqual([]);
        });

        test('object with reference property that is an object is skipped by fastValidateReferences', () => {
            const resource = {
                subject: { reference: { nested: 'value' } }
            };
            const errors = fastValidateReferences(resource, 'Resource');
            // typeof value.reference === 'string' check fails for object
            expect(errors).toEqual([]);
        });

        test('circular-like deep nesting does not cause infinite loop (finite depth)', () => {
            // Build a deeply nested structure (not truly circular, just deep)
            let current = { reference: 'no-slash' };
            for (let i = 0; i < 50; i++) {
                current = { child: current };
            }
            const resource = { root: current };
            const errors = fastValidateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('no-slash');
        });

        test('validateReferences skips null properties in object iteration', () => {
            const resource = {
                subject: null,
                performer: createReferenceInstance('no-slash')
            };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('no-slash');
        });

        test('validateReferences skips primitive properties', () => {
            const resource = {
                id: '123',
                active: true,
                count: 5,
                performer: createReferenceInstance('bad-ref')
            };
            const errors = validateReferences(resource, 'Resource');
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('bad-ref');
        });

        test('fastValidateReferences handles resource with no reference fields', () => {
            const resource = {
                id: '123',
                resourceType: 'Patient',
                name: [{ family: 'Smith', given: ['John'] }],
                active: true
            };
            const errors = fastValidateReferences(resource, 'Patient');
            expect(errors).toEqual([]);
        });
    });
});
