'use strict';

const { describe, test, expect } = require('@jest/globals');

const { BaseBundleConverter } = require('../../../converters/baseBundleConverter');

describe('BaseBundleConverter', () => {
    describe('convert', () => {
        test('throws "convert method not implemented" when called directly', () => {
            const converter = new BaseBundleConverter();
            expect(() => converter.convert({ bundle: {} })).toThrow('convert method not implemented');
        });

        test('throws an Error instance', () => {
            const converter = new BaseBundleConverter();
            expect(() => converter.convert({ bundle: {} })).toThrow(Error);
        });
    });

    describe('convertResources', () => {
        test('throws "convert method not implemented" when called directly', () => {
            const converter = new BaseBundleConverter();
            expect(() => converter.convertResources({ resources: [] })).toThrow('convert method not implemented');
        });

        test('throws an Error instance', () => {
            const converter = new BaseBundleConverter();
            expect(() => converter.convertResources({ resources: [] })).toThrow(Error);
        });
    });

    describe('class design', () => {
        test('can be instantiated without arguments', () => {
            const converter = new BaseBundleConverter();
            expect(converter).toBeInstanceOf(BaseBundleConverter);
        });

        test('serves as an abstract base class', () => {
            class ConcreteConverter extends BaseBundleConverter {
                convert({ bundle }) {
                    return Buffer.from(JSON.stringify(bundle));
                }
                convertResources({ resources }) {
                    return Buffer.from(JSON.stringify(resources));
                }
            }
            const converter = new ConcreteConverter();
            expect(converter).toBeInstanceOf(BaseBundleConverter);
            expect(converter.convert({ bundle: { type: 'test' } })).toEqual(Buffer.from('{"type":"test"}'));
            expect(converter.convertResources({ resources: [{ id: '1' }] })).toEqual(Buffer.from('[{"id":"1"}]'));
        });
    });
});
