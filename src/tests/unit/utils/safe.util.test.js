'use strict';

const { describe, test, expect } = require('@jest/globals');

const { safeReference } = require('../../../utils/safe.util');

describe('safe.util - safeReference', () => {
    describe('bug: reversed logic returns empty proxy for existing properties', () => {
        test('accessing an existing property returns a proxy of empty object instead of the value', () => {
            const obj = { name: 'hello', count: 42 };
            const safe = safeReference(obj);

            // BUG: The function checks if (!result) - when result exists (truthy),
            // it falls through to return safeReference({}) - an empty proxy.
            // So accessing an existing property gives an empty proxy, not the value.
            const nameResult = safe.name;

            // The result should be 'hello' in a correct implementation,
            // but due to the bug it returns a Proxy of an empty object.
            // We can prove this by checking it's not the expected string value.
            expect(nameResult).not.toBe('hello');
            expect(typeof nameResult).toBe('object');
        });

        test('accessing a non-existent property that is undefined returns undefined', () => {
            const obj = { name: 'hello' };
            const safe = safeReference(obj);

            // When result is falsy (undefined), the code checks:
            // if (!result) -> true, so it checks (result instanceof Object)
            // undefined instanceof Object is false, so it returns result (undefined)
            const missingResult = safe.nonExistent;
            expect(missingResult).toBeUndefined();
        });

        test('accessing a property with value 0 returns 0 (falsy but not Object)', () => {
            const obj = { zero: 0 };
            const safe = safeReference(obj);

            // 0 is falsy, so !result is true. Then 0 instanceof Object is false.
            // So it returns result (0). This case actually works correctly.
            expect(safe.zero).toBe(0);
        });

        test('accessing a property with value empty string returns empty string', () => {
            const obj = { empty: '' };
            const safe = safeReference(obj);

            // '' is falsy, so !result is true. Then '' instanceof Object is false.
            // So it returns result (''). This case works correctly for primitives.
            expect(safe.empty).toBe('');
        });

        test('accessing a property with value null returns null (falsy, not Object)', () => {
            const obj = { nullable: null };
            const safe = safeReference(obj);

            // null is falsy, so !result is true. Then null instanceof Object is false.
            // So it returns result (null).
            expect(safe.nullable).toBeNull();
        });

        test('nested access on existing object property returns empty proxy chain', () => {
            const obj = { nested: { deep: { value: 'found' } } };
            const safe = safeReference(obj);

            // safe.nested -> result is { deep: { value: 'found' } } which is truthy
            // So it returns safeReference({}) - an empty proxy
            // Then .deep on empty proxy -> result is undefined (falsy)
            // And undefined instanceof Object is false, so returns undefined
            const deepResult = safe.nested.deep;
            expect(deepResult).toBeUndefined();
        });

        test('proves the bug: truthy values always produce empty proxy', () => {
            const obj = { arr: [1, 2, 3], flag: true, num: 99 };
            const safe = safeReference(obj);

            // All truthy values go through the same buggy path
            // We cannot use matchers that call Symbol methods on proxies, so use typeof
            expect(typeof safe.arr).toBe('object');
            expect(typeof safe.flag).toBe('object');
            expect(typeof safe.num).toBe('object');

            // Accessing a known property on the returned proxy proves it's empty:
            // safe.arr is proxy of {}, so .length is falsy (undefined)
            // then !undefined is true, and undefined instanceof Object is false,
            // so it returns undefined
            const arrLength = safe.arr.length;
            expect(arrLength).toBeUndefined();
        });
    });
});
