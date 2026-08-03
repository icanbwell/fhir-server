'use strict';

const { describe, test, expect } = require('@jest/globals');
const { assertTypeEquals, assertIsValid, assertFail } = require('../../../utils/assertType');

describe('assertType', () => {
    describe('assertTypeEquals', () => {
        test('does not throw for correct instance', () => {
            class MyClass {}
            const obj = new MyClass();
            expect(() => assertTypeEquals(obj, MyClass)).not.toThrow();
        });

        test('throws for null', () => {
            class MyClass {}
            expect(() => assertTypeEquals(null, MyClass)).toThrow('obj of type MyClass is null or undefined');
        });

        test('throws for undefined', () => {
            class MyClass {}
            expect(() => assertTypeEquals(undefined, MyClass)).toThrow('obj of type MyClass is null or undefined');
        });

        test('throws for wrong type', () => {
            class MyClass {}
            class OtherClass {}
            const obj = new OtherClass();
            expect(() => assertTypeEquals(obj, MyClass)).toThrow('is not the expected type MyClass');
        });

        test('uses custom message when provided', () => {
            class MyClass {}
            expect(() => assertTypeEquals(null, MyClass, 'custom msg')).toThrow('custom msg');
        });

        test('works with inheritance', () => {
            class Base {}
            class Child extends Base {}
            const obj = new Child();
            expect(() => assertTypeEquals(obj, Base)).not.toThrow();
        });
    });

    describe('assertIsValid', () => {
        test('does not throw for truthy values', () => {
            expect(() => assertIsValid(true)).not.toThrow();
            expect(() => assertIsValid('hello')).not.toThrow();
            expect(() => assertIsValid(42)).not.toThrow();
            expect(() => assertIsValid({})).not.toThrow();
        });

        test('throws for null', () => {
            expect(() => assertIsValid(null)).toThrow('obj is null or undefined');
        });

        test('throws for undefined', () => {
            expect(() => assertIsValid(undefined)).toThrow('obj is null or undefined');
        });

        test('throws for empty string', () => {
            expect(() => assertIsValid('')).toThrow('obj is null or undefined');
        });

        test('throws for zero', () => {
            expect(() => assertIsValid(0)).toThrow('obj is null or undefined');
        });

        test('uses custom message', () => {
            expect(() => assertIsValid(null, 'must be set')).toThrow('must be set');
        });
    });

    describe('assertFail', () => {
        test('throws with source and message', () => {
            expect(() => assertFail({ source: 'TestModule', message: 'bad state', args: {} }))
                .toThrow('TestModule: bad state');
        });

        test('includes args in error message', () => {
            expect(() => assertFail({ source: 'Mod', message: 'err', args: { key: 'val' } }))
                .toThrow('Mod: err | {"key":"val"}');
        });

        test('throws RethrownError when error is provided', () => {
            const original = new Error('original');
            expect(() => assertFail({ source: 'Src', message: 'wrap', args: {}, error: original }))
                .toThrow('Src: wrap');
        });
    });
});
