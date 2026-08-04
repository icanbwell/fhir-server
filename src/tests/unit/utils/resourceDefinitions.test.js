const { describe, test, expect } = require('@jest/globals');
const { resourceDefinitions } = require('../../../utils/resourceDefinitions');

describe('resourceDefinitions', () => {
    test('is an array', () => {
        expect(Array.isArray(resourceDefinitions)).toBe(true);
    });

    test('contains more than 0 entries', () => {
        expect(resourceDefinitions.length).toBeGreaterThan(0);
    });

    test('each entry has required properties: name, description, url', () => {
        for (const definition of resourceDefinitions) {
            expect(definition).toHaveProperty('name');
            expect(definition).toHaveProperty('description');
            expect(definition).toHaveProperty('url');
        }
    });

    test('each name is a non-empty string', () => {
        for (const definition of resourceDefinitions) {
            expect(typeof definition.name).toBe('string');
            expect(definition.name.length).toBeGreaterThan(0);
        }
    });

    test('each description is a non-empty string', () => {
        for (const definition of resourceDefinitions) {
            expect(typeof definition.description).toBe('string');
            expect(definition.description.length).toBeGreaterThan(0);
        }
    });

    test('each url is a valid URL string', () => {
        for (const definition of resourceDefinitions) {
            expect(typeof definition.url).toBe('string');
            expect(definition.url).toMatch(/^https?:\/\//);
        }
    });

    test('contains known FHIR resources', () => {
        const names = resourceDefinitions.map(d => d.name);
        expect(names).toContain('Patient');
        expect(names).toContain('Observation');
        expect(names).toContain('Condition');
        expect(names).toContain('Encounter');
        expect(names).toContain('Practitioner');
        expect(names).toContain('Organization');
        expect(names).toContain('Medication');
    });

    test('all resource names are unique', () => {
        const names = resourceDefinitions.map(d => d.name);
        const uniqueNames = new Set(names);
        expect(uniqueNames.size).toBe(names.length);
    });

    test('Patient resource has correct structure', () => {
        const patient = resourceDefinitions.find(d => d.name === 'Patient');
        expect(patient).toBeDefined();
        expect(patient.description).toContain('Demographics');
        expect(patient.url).toContain('patient');
    });

    test('Observation resource has correct structure', () => {
        const observation = resourceDefinitions.find(d => d.name === 'Observation');
        expect(observation).toBeDefined();
        expect(observation.description).toContain('Measurements');
        expect(observation.url).toContain('observation');
    });

    test('Account resource is present (first alphabetically)', () => {
        const account = resourceDefinitions.find(d => d.name === 'Account');
        expect(account).toBeDefined();
        expect(account.description).toContain('financial');
        expect(account.url).toContain('account');
    });

    test('ValueSet resource is present', () => {
        const valueSet = resourceDefinitions.find(d => d.name === 'ValueSet');
        expect(valueSet).toBeDefined();
        expect(valueSet.description).toContain('codes');
        expect(valueSet.url).toContain('valueset');
    });

    test('no entry has extra unexpected properties', () => {
        const allowedKeys = new Set(['name', 'description', 'url']);
        for (const definition of resourceDefinitions) {
            const keys = Object.keys(definition);
            for (const key of keys) {
                expect(allowedKeys.has(key)).toBe(true);
            }
        }
    });

    test('definitions array has the expected count of resources', () => {
        expect(resourceDefinitions.length).toBe(42);
    });
});
