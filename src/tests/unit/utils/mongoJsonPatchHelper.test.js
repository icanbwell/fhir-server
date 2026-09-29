'use strict';

const { describe, test, expect } = require('@jest/globals');
const { MongoJsonPatchHelper } = require('../../../utils/mongoJsonPatchHelper');

describe('MongoJsonPatchHelper', () => {
    describe('convertJsonPatchesToMongoUpdateCommand', () => {
        test('converts replace op to $set', () => {
            const patches = [{ op: 'replace', path: '/name/0/family', value: 'Smith' }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$set).toEqual({ 'name.0.family': 'Smith' });
        });

        test('converts remove op to $unset', () => {
            const patches = [{ op: 'remove', path: '/meta/tag' }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$unset).toEqual({ 'meta.tag': 1 });
        });

        test('converts add op with non-zero position to $push with $position', () => {
            const patches = [{ op: 'add', path: '/identifier/1', value: { system: 'http://x', value: 'y' } }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$push.identifier.$each).toEqual([{ system: 'http://x', value: 'y' }]);
            expect(result.$push.identifier.$position).toBe(1);
        });

        test('BUG: add op with dash does NOT correctly target array append', () => {
            // The code checks isNaN(parseInt('-')) which is true, so it resets key to 'identifier.-'
            // instead of keeping key as 'identifier'. This is a bug - dash should be handled
            // before the isNaN check since FHIR JSON Patch uses /path/- for "append to end".
            const patches = [{ op: 'add', path: '/identifier/-', value: { system: 'http://x', value: 'z' } }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            // BUG: uses 'identifier.-' as key instead of 'identifier'
            expect(result.$push['identifier.-']).toEqual({ system: 'http://x', value: 'z' });
        });

        test('converts add op without numeric position (field add) as push', () => {
            const patches = [{ op: 'add', path: '/extension', value: [{ url: 'http://x' }] }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$push.extension).toEqual([{ url: 'http://x' }]);
        });

        test('test op is a no-op', () => {
            const patches = [{ op: 'test', path: '/id', value: '123' }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result).toEqual({});
        });

        test('throws on unsupported op (move)', () => {
            const patches = [{ op: 'move', from: '/a', path: '/b' }];
            expect(() => MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches }))
                .toThrow(/Unsupported Operation/);
        });

        test('throws on unsupported op (copy)', () => {
            const patches = [{ op: 'copy', from: '/a', path: '/b' }];
            expect(() => MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches }))
                .toThrow(/Unsupported Operation/);
        });

        test('handles multiple ops in one patch set', () => {
            const patches = [
                { op: 'replace', path: '/active', value: true },
                { op: 'remove', path: '/deceasedBoolean' },
                { op: 'add', path: '/identifier/2', value: { system: 'x', value: 'y' } }
            ];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$set.active).toBe(true);
            expect(result.$unset.deceasedBoolean).toBe(1);
            expect(result.$push.identifier.$each).toEqual([{ system: 'x', value: 'y' }]);
            expect(result.$push.identifier.$position).toBe(2);
        });

        test('handles JSON pointer escape sequences (~0 for ~, ~1 for /)', () => {
            const patches = [{ op: 'replace', path: '/a~1b~0c', value: 'escaped' }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$set['a/b~c']).toBe('escaped');
        });

        test('BUG: add at position 0 throws because || null converts 0 to null', () => {
            // The code does: `const $position = (positionPart && parseInt(positionPart, 10)) || null;`
            // When positionPart is '0', parseInt gives 0, and `0 || null` = null.
            // Then the code falls through to the `else` branch and throws.
            // This is a bug: position 0 should be valid for prepending to arrays.
            const patches = [{ op: 'add', path: '/items/0', value: 'first' }];
            expect(() => MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches }))
                .toThrow(/without position/);
        });

        test('multiple adds with non-zero contiguous positions work', () => {
            const patches = [
                { op: 'add', path: '/items/1', value: 'first' },
                { op: 'add', path: '/items/2', value: 'second' }
            ];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$push.items.$each).toEqual(['first', 'second']);
            expect(result.$push.items.$position).toBe(1);
        });

        test('BUG: multiple adds to end via dash uses wrong key (identifier.-)', () => {
            // Due to the NaN check resetting key to include '-', this throws on second add
            // because it tries to convert `update.$push['tags.-']` (which is the value) to $each
            const patches = [
                { op: 'add', path: '/tags/-', value: 'a' },
                { op: 'add', path: '/tags/-', value: 'b' }
            ];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            // Due to the bug, key is 'tags.-' and second push converts to $each
            expect(result.$push['tags.-'].$each).toEqual(['a', 'b']);
        });

        test('replace with null value', () => {
            const patches = [{ op: 'replace', path: '/deceasedDateTime', value: null }];
            const result = MongoJsonPatchHelper.convertJsonPatchesToMongoUpdateCommand({ patches });
            expect(result.$set.deceasedDateTime).toBeNull();
        });
    });
});
