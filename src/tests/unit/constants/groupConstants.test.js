'use strict';

const { describe, test, expect } = require('@jest/globals');
const { CONTEXT_KEYS, PATCH_OPERATIONS, PATCH_PATHS, DEFAULT_CLICKHOUSE } = require('../../../constants/groupConstants');

describe('groupConstants', () => {
    describe('CONTEXT_KEYS', () => {
        test('GROUP_MEMBERS generates correct key', () => {
            expect(CONTEXT_KEYS.GROUP_MEMBERS('abc-123')).toBe('group-members-abc-123');
        });

        test('GROUP_MEMBERS_CHANGED generates correct key', () => {
            expect(CONTEXT_KEYS.GROUP_MEMBERS_CHANGED('xyz')).toBe('group-members-changed-xyz');
        });
    });

    describe('PATCH_OPERATIONS', () => {
        test('has ADD and REMOVE', () => {
            expect(PATCH_OPERATIONS.ADD).toBe('add');
            expect(PATCH_OPERATIONS.REMOVE).toBe('remove');
        });
    });

    describe('PATCH_PATHS', () => {
        test('MEMBER_PREFIX is /member', () => {
            expect(PATCH_PATHS.MEMBER_PREFIX).toBe('/member');
        });

        test('MEMBER_PATH ends with slash', () => {
            expect(PATCH_PATHS.MEMBER_PATH).toBe('/member/');
        });

        test('MEMBER_APPEND uses dash syntax', () => {
            expect(PATCH_PATHS.MEMBER_APPEND).toBe('/member/-');
        });
    });

    describe('DEFAULT_CLICKHOUSE', () => {
        test('has sensible defaults', () => {
            expect(DEFAULT_CLICKHOUSE.HOST).toBe('127.0.0.1');
            expect(DEFAULT_CLICKHOUSE.PORT).toBe(8123);
            expect(DEFAULT_CLICKHOUSE.DATABASE).toBe('fhir');
            expect(DEFAULT_CLICKHOUSE.MAX_CONNECTIONS).toBe(100);
        });

        test('request timeout is 3 minutes', () => {
            expect(DEFAULT_CLICKHOUSE.REQUEST_TIMEOUT_MS).toBe(180000);
        });
    });
});
