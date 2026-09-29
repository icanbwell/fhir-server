'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { SimpleContainer } = require('../../../utils/simpleContainer');

describe('SimpleContainer', () => {
    test('constructor initializes with empty services object', () => {
        const container = new SimpleContainer();
        expect(container.services).toEqual({});
    });

    test('register returns the container instance for chaining', () => {
        const container = new SimpleContainer();
        const result = container.register('foo', () => 'bar');
        expect(result).toBe(container);
    });

    test('supports chaining multiple register calls', () => {
        const container = new SimpleContainer();
        const result = container
            .register('a', () => 1)
            .register('b', () => 2)
            .register('c', () => 3);
        expect(result).toBe(container);
    });

    test('lazy initialization - callback is not called until property access', () => {
        const container = new SimpleContainer();
        const cb = jestObj.fn(() => 'value');
        container.register('myService', cb);
        expect(cb).not.toHaveBeenCalled();
        const val = container.myService;
        expect(cb).toHaveBeenCalledTimes(1);
        expect(val).toBe('value');
    });

    test('caching - callback is called only once on repeated access', () => {
        const container = new SimpleContainer();
        const cb = jestObj.fn(() => ({ data: 42 }));
        container.register('cached', cb);

        const first = container.cached;
        const second = container.cached;
        const third = container.cached;

        expect(cb).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
        expect(second).toBe(third);
    });

    test('multiple services can reference each other', () => {
        const container = new SimpleContainer();
        container
            .register('config', () => ({ port: 3000 }))
            .register('server', (c) => ({ port: c.config.port, name: 'myServer' }));

        expect(container.server).toEqual({ port: 3000, name: 'myServer' });
    });

    test('callback receives the container as argument', () => {
        const container = new SimpleContainer();
        const cb = jestObj.fn((c) => c);
        container.register('self', cb);

        const val = container.self;
        expect(cb).toHaveBeenCalledWith(container);
        expect(val).toBe(container);
    });

    test('registered properties are configurable', () => {
        const container = new SimpleContainer();
        container.register('service', () => 'original');

        const descriptor = Object.getOwnPropertyDescriptor(container, 'service');
        expect(descriptor.configurable).toBe(true);
    });

    test('registered properties are enumerable', () => {
        const container = new SimpleContainer();
        container.register('service', () => 'value');

        const descriptor = Object.getOwnPropertyDescriptor(container, 'service');
        expect(descriptor.enumerable).toBe(true);
    });

    test('registered properties appear in Object.keys', () => {
        const container = new SimpleContainer();
        container.register('alpha', () => 1).register('beta', () => 2);

        const keys = Object.keys(container);
        expect(keys).toContain('alpha');
        expect(keys).toContain('beta');
    });
});
