const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
const mockGetResource = jestObj.fn();
const mockAssertIsValid = jestObj.fn();

jestObj.mock('../../../operations/common/getResource', () => ({
    getResource: mockGetResource
}));

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: mockAssertIsValid
}));

jestObj.mock('../../../middleware/fhir/utils/constants', () => ({
    VERSIONS: { '4_0_0': '4_0_0' }
}));

jestObj.mock('../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args, source }) {
            super(message);
            this.innerError = error;
            this.args = args;
            this.source = source;
        }
    }
}));

jestObj.mock('../../../utils/httpErrors', () => ({
    BadRequestError: class BadRequestError extends Error {
        constructor(error) {
            super(error.message);
            this.statusCode = 400;
        }
    }
}));

// Mock Resource base class
class MockResource {
    constructor(data) {
        Object.assign(this, data);
    }
}

jestObj.mock('../../../fhir/classes/4_0_0/resources/resource', () => MockResource);

// Mock BundleEntry
class MockBundleEntry {
    constructor(data) {
        Object.assign(this, data);
        this._isBundleEntry = true;
    }
}

jestObj.mock('../../../fhir/classes/4_0_0/backbone_elements/bundleEntry', () => MockBundleEntry);

const { FhirResourceCreator } = require('../../../fhir/fhirResourceCreator');

describe('FhirResourceCreator', () => {
    beforeEach(() => {
        mockGetResource.mockReset();
        mockAssertIsValid.mockReset();

        // Default: assertIsValid does nothing (passes)
        mockAssertIsValid.mockImplementation(() => {});
    });

    describe('create', () => {
        test('returns obj directly when it is already a Resource instance', () => {
            const resource = new MockResource({ id: '1', resourceType: 'Patient' });

            const result = FhirResourceCreator.create(resource);

            expect(result).toBe(resource);
            expect(mockGetResource).not.toHaveBeenCalled();
        });

        test('uses provided ResourceConstructor when given', () => {
            class CustomConstructor {
                constructor(data) {
                    this.data = data;
                    this.custom = true;
                }
            }

            const obj = { id: '2', resourceType: 'Patient' };
            const result = FhirResourceCreator.create(obj, CustomConstructor);

            expect(result).toBeInstanceOf(CustomConstructor);
            expect(result.data).toBe(obj);
            expect(result.custom).toBe(true);
        });

        test('throws when obj is null (assertIsValid fails)', () => {
            mockAssertIsValid.mockImplementation((val, msg) => {
                if (!val) throw new Error(msg);
            });

            expect(() => FhirResourceCreator.create(null)).toThrow();
        });

        test('throws BadRequestError wrapped in RethrownError when resourceType is missing', () => {
            const obj = { id: '3' }; // no resourceType

            try {
                FhirResourceCreator.create(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in creating resource');
                expect(e.innerError.message).toBe('resourceType is null');
                expect(e.innerError.statusCode).toBe(400);
                expect(e.source).toBe('FhirResourceCreator.create');
            }
        });

        test('looks up resource creator by resourceType and instantiates', () => {
            class PatientResource {
                constructor(data) {
                    Object.assign(this, data);
                    this._created = true;
                }
            }
            mockGetResource.mockReturnValue(PatientResource);

            const obj = { id: '4', resourceType: 'Patient' };
            const result = FhirResourceCreator.create(obj);

            expect(mockGetResource).toHaveBeenCalledWith('4_0_0', 'Patient');
            expect(result._created).toBe(true);
            expect(result.id).toBe('4');
        });

        test('throws BadRequestError when resourceType is not supported', () => {
            mockGetResource.mockReturnValue(null);

            const obj = { id: '5', resourceType: 'FakeResource' };

            try {
                FhirResourceCreator.create(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in creating resource');
                expect(e.innerError.message).toBe('ResourceType FakeResource is not supported');
            }
        });

        test('wraps constructor errors in RethrownError', () => {
            class ThrowingResource {
                constructor() {
                    throw new Error('constructor exploded');
                }
            }
            mockGetResource.mockReturnValue(ThrowingResource);

            const obj = { id: '6', resourceType: 'Patient' };

            try {
                FhirResourceCreator.create(obj);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in creating resource');
                expect(e.innerError.message).toBe('constructor exploded');
                expect(e.args.resource).toBe(obj);
            }
        });

        test('calls assertIsValid with the obj', () => {
            class SimpleResource {
                constructor(data) { Object.assign(this, data); }
            }
            mockGetResource.mockReturnValue(SimpleResource);

            const obj = { id: '7', resourceType: 'Patient' };
            FhirResourceCreator.create(obj);

            expect(mockAssertIsValid).toHaveBeenCalledWith(obj, 'obj is null');
        });
    });

    describe('createByResourceType', () => {
        test('returns obj directly when it is already a Resource instance', () => {
            const resource = new MockResource({ id: '1', resourceType: 'Patient' });

            const result = FhirResourceCreator.createByResourceType(resource, 'Observation');

            expect(result).toBe(resource);
            expect(mockGetResource).not.toHaveBeenCalled();
        });

        test('uses specified resourceType to look up creator', () => {
            class ObservationResource {
                constructor(data) { Object.assign(this, data); this._type = 'Observation'; }
            }
            mockGetResource.mockReturnValue(ObservationResource);

            const obj = { id: '8', status: 'final' };
            const result = FhirResourceCreator.createByResourceType(obj, 'Observation');

            expect(mockGetResource).toHaveBeenCalledWith('4_0_0', 'Observation');
            expect(result._type).toBe('Observation');
        });

        test('throws RethrownError when getResource returns undefined', () => {
            mockGetResource.mockReturnValue(undefined);

            const obj = { id: '9' };

            try {
                FhirResourceCreator.createByResourceType(obj, 'BadType');
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in creating resource');
                expect(e.source).toBe('FhirResourceCreator.createByResourceType');
            }
        });

        test('throws when obj is null', () => {
            mockAssertIsValid.mockImplementation((val, msg) => {
                if (!val) throw new Error(msg);
            });

            expect(() => FhirResourceCreator.createByResourceType(null, 'Patient')).toThrow();
        });
    });

    describe('createArray', () => {
        test('maps array of objects to resources', () => {
            class PatientResource {
                constructor(data) { Object.assign(this, data); this._created = true; }
            }
            mockGetResource.mockReturnValue(PatientResource);

            const arr = [
                { id: '1', resourceType: 'Patient' },
                { id: '2', resourceType: 'Patient' }
            ];

            const result = FhirResourceCreator.createArray(arr);

            expect(result).toHaveLength(2);
            expect(result[0]._created).toBe(true);
            expect(result[1]._created).toBe(true);
        });

        test('filters out falsy values from array', () => {
            class PatientResource {
                constructor(data) { Object.assign(this, data); this._created = true; }
            }
            mockGetResource.mockReturnValue(PatientResource);

            const arr = [
                { id: '1', resourceType: 'Patient' },
                null,
                undefined,
                { id: '2', resourceType: 'Patient' }
            ];

            const result = FhirResourceCreator.createArray(arr);

            expect(result).toHaveLength(2);
        });

        test('wraps single object in array', () => {
            class PatientResource {
                constructor(data) { Object.assign(this, data); this._created = true; }
            }
            mockGetResource.mockReturnValue(PatientResource);

            const obj = { id: '3', resourceType: 'Patient' };
            const result = FhirResourceCreator.createArray(obj);

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]._created).toBe(true);
        });

        test('passes ResourceConstructor to each create call', () => {
            class CustomConstructor {
                constructor(data) { this.data = data; this.custom = true; }
            }

            const arr = [{ id: '1' }, { id: '2' }];
            const result = FhirResourceCreator.createArray(arr, CustomConstructor);

            expect(result).toHaveLength(2);
            expect(result[0].custom).toBe(true);
            expect(result[1].custom).toBe(true);
        });

        test('throws RethrownError when any item fails creation', () => {
            mockGetResource.mockReturnValue(null); // will cause BadRequestError

            const arr = [{ id: '1', resourceType: 'Unknown' }];

            try {
                FhirResourceCreator.createArray(arr);
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in creating resource');
                expect(e.source).toBe('FhirResourceCreator.createArray');
            }
        });
    });

    describe('mapDocumentToResourceObject', () => {
        test('creates BundleEntry when doc has resource property', () => {
            const doc = { resource: { resourceType: 'Patient', id: '1' }, fullUrl: 'urn:uuid:123' };

            const result = FhirResourceCreator.mapDocumentToResourceObject(doc, 'Patient');

            expect(result._isBundleEntry).toBe(true);
            expect(result.resource).toEqual({ resourceType: 'Patient', id: '1' });
        });

        test('uses doc.resourceType when available', () => {
            class ObservationResource {
                constructor(data) { Object.assign(this, data); this._type = 'Observation'; }
            }
            mockGetResource.mockReturnValue(ObservationResource);

            const doc = { id: '2', resourceType: 'Observation', status: 'final' };
            const result = FhirResourceCreator.mapDocumentToResourceObject(doc, 'Patient');

            // Should use doc.resourceType ('Observation') not classResourceType ('Patient')
            expect(mockGetResource).toHaveBeenCalledWith('4_0_0', 'Observation');
        });

        test('falls back to classResourceType when doc has no resourceType', () => {
            class PatientResource {
                constructor(data) { Object.assign(this, data); this._type = 'Patient'; }
            }
            mockGetResource.mockReturnValue(PatientResource);

            const doc = { id: '3', name: 'John' };
            const result = FhirResourceCreator.mapDocumentToResourceObject(doc, 'Patient');

            expect(mockGetResource).toHaveBeenCalledWith('4_0_0', 'Patient');
        });

        test('throws RethrownError when mapping fails', () => {
            mockGetResource.mockReturnValue(undefined);

            const doc = { id: '4', resourceType: 'Unknown' };

            try {
                FhirResourceCreator.mapDocumentToResourceObject(doc, 'Unknown');
                throw new Error('should have thrown');
            } catch (e) {
                expect(e.message).toBe('Error in mapping resource to Resource Object');
                expect(e.source).toBe('FhirResourceCreator.mapDocumentToResourceObject');
                expect(e.args.resource).toBe(doc);
            }
        });

        test('prefers BundleEntry detection over resourceType', () => {
            // If doc has 'resource' key, it's always a BundleEntry
            const doc = { resource: { id: '5' }, resourceType: 'Observation' };

            const result = FhirResourceCreator.mapDocumentToResourceObject(doc, 'Patient');

            expect(result._isBundleEntry).toBe(true);
        });
    });
});
