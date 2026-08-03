'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ResourceOperationAccessProvider } = require('../../../utils/resourceOperationAccessProvider');

describe('ResourceOperationAccessProvider', () => {
    const provider = new ResourceOperationAccessProvider();

    describe('verifyAccess', () => {
        test('blocks update on AuditEvent', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'AuditEvent',
                operation: 'update'
            })).toThrow(/not allowed/);
        });

        test('blocks patch on AuditEvent', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'AuditEvent',
                operation: 'patch'
            })).toThrow(/not allowed/);
        });

        test('blocks remove on AuditEvent', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'AuditEvent',
                operation: 'remove'
            })).toThrow(/not allowed/);
        });

        test('blocks remove_by_query on AuditEvent', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'AuditEvent',
                operation: 'remove_by_query'
            })).toThrow(/not allowed/);
        });

        test('allows search on AuditEvent (not restricted)', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'AuditEvent',
                operation: 'search'
            })).not.toThrow();
        });

        test('allows create on AuditEvent (not restricted)', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'AuditEvent',
                operation: 'create'
            })).not.toThrow();
        });

        test('allows any operation on Patient (unrestricted resource)', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'Patient',
                operation: 'update'
            })).not.toThrow();
        });

        test('allows any operation on Observation (unrestricted resource)', () => {
            expect(() => provider.verifyAccess({
                requestInfo: {},
                resourceType: 'Observation',
                operation: 'remove'
            })).not.toThrow();
        });

        test('error message includes the resource type', () => {
            try {
                provider.verifyAccess({ requestInfo: {}, resourceType: 'AuditEvent', operation: 'update' });
            } catch (err) {
                expect(err.message).toContain('AuditEvent');
            }
        });
    });
});
