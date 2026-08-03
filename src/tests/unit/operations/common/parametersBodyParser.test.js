'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { ParametersBodyParser } = require('../../../../operations/common/parametersBodyParser');

describe('ParametersBodyParser', () => {
    let parser;

    beforeEach(() => {
        parser = new ParametersBodyParser();
    });

    describe('parseParametersResource', () => {
        test('extracts valueString parameters from FHIR Parameters resource', () => {
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'patient', valueString: 'Patient/123' },
                    { name: 'code', valueString: 'abc' }
                ]
            };
            const result = parser.parseParametersResource({ body, args: {} });
            expect(result.patient).toBe('Patient/123');
            expect(result.code).toBe('abc');
        });

        test('extracts resource parameters from FHIR Parameters resource', () => {
            const resource = { resourceType: 'Patient', id: '123' };
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'resource', resource }
                ]
            };
            const result = parser.parseParametersResource({ body, args: {} });
            expect(result.resource).toBe(resource);
        });

        test('valueString takes precedence over resource when both present', () => {
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'item', valueString: 'str-value', resource: { id: 'x' } }
                ]
            };
            const result = parser.parseParametersResource({ body, args: {} });
            expect(result.item).toBe('str-value');
        });

        test('merges with existing args', () => {
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'newParam', valueString: 'newVal' }
                ]
            };
            const args = { existing: 'value' };
            const result = parser.parseParametersResource({ body, args });
            expect(result.existing).toBe('value');
            expect(result.newParam).toBe('newVal');
        });

        test('parameter values override existing args', () => {
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'key', valueString: 'new' }
                ]
            };
            const args = { key: 'old' };
            const result = parser.parseParametersResource({ body, args });
            expect(result.key).toBe('new');
        });

        test('ignores parameters without name', () => {
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { valueString: 'orphan' },
                    { name: 'valid', valueString: 'ok' }
                ]
            };
            const result = parser.parseParametersResource({ body, args: {} });
            expect(result.valid).toBe('ok');
            expect(Object.keys(result)).toHaveLength(1);
        });

        test('ignores parameters without valueString or resource', () => {
            const body = {
                resourceType: 'Parameters',
                parameter: [
                    { name: 'empty' },
                    { name: 'hasInt', valueInteger: 42 },
                    { name: 'valid', valueString: 'ok' }
                ]
            };
            const result = parser.parseParametersResource({ body, args: {} });
            expect(result.valid).toBe('ok');
            expect(result.empty).toBeUndefined();
            expect(result.hasInt).toBeUndefined();
        });

        test('returns args unchanged when body is null', () => {
            const args = { foo: 'bar' };
            const result = parser.parseParametersResource({ body: null, args });
            expect(result).toEqual({ foo: 'bar' });
        });

        test('returns args unchanged when body is not Parameters resourceType', () => {
            const body = { resourceType: 'Patient', id: '123' };
            const result = parser.parseParametersResource({ body, args: { a: 1 } });
            expect(result).toEqual({ a: 1 });
        });

        test('returns args unchanged when parameter is not an array', () => {
            const body = { resourceType: 'Parameters', parameter: 'invalid' };
            const result = parser.parseParametersResource({ body, args: { x: 'y' } });
            expect(result).toEqual({ x: 'y' });
        });

        test('returns new object (does not mutate args)', () => {
            const args = { original: true };
            const body = {
                resourceType: 'Parameters',
                parameter: [{ name: 'added', valueString: 'val' }]
            };
            const result = parser.parseParametersResource({ body, args });
            expect(result).not.toBe(args);
            expect(args.added).toBeUndefined();
        });
    });

    describe('parseFormUrlEncoded', () => {
        test('copies all body keys to result', () => {
            const body = { patient: '123', code: 'abc', _count: '10' };
            const result = parser.parseFormUrlEncoded({ body, args: {} });
            expect(result.patient).toBe('123');
            expect(result.code).toBe('abc');
            expect(result._count).toBe('10');
        });

        test('merges with existing args', () => {
            const body = { newKey: 'newVal' };
            const args = { existingKey: 'existingVal' };
            const result = parser.parseFormUrlEncoded({ body, args });
            expect(result.existingKey).toBe('existingVal');
            expect(result.newKey).toBe('newVal');
        });

        test('body values override existing args', () => {
            const body = { key: 'fromBody' };
            const args = { key: 'fromArgs' };
            const result = parser.parseFormUrlEncoded({ body, args });
            expect(result.key).toBe('fromBody');
        });

        test('returns args unchanged when body is null', () => {
            const result = parser.parseFormUrlEncoded({ body: null, args: { x: 1 } });
            expect(result).toEqual({ x: 1 });
        });

        test('returns args unchanged when body is not an object', () => {
            const result = parser.parseFormUrlEncoded({ body: 'string', args: { x: 1 } });
            expect(result).toEqual({ x: 1 });
        });

        test('returns new object (does not mutate args)', () => {
            const args = { original: true };
            const body = { added: 'val' };
            const result = parser.parseFormUrlEncoded({ body, args });
            expect(result).not.toBe(args);
            expect(args.added).toBeUndefined();
        });
    });
});
