'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ISSUE, INTERACTIONS, VERSIONS, EVENTS, RESOURCES } = require('../../../../../middleware/fhir/utils/constants');

describe('middleware/fhir/utils/constants', () => {
    describe('ISSUE', () => {
        test('SEVERITY levels match FHIR spec', () => {
            expect(ISSUE.SEVERITY.FATAL).toBe('fatal');
            expect(ISSUE.SEVERITY.ERROR).toBe('error');
            expect(ISSUE.SEVERITY.WARNING).toBe('warning');
            expect(ISSUE.SEVERITY.INFO).toBe('information');
        });

        test('CODE has standard issue types', () => {
            expect(ISSUE.CODE.INVALID).toBe('invalid');
            expect(ISSUE.CODE.NOT_FOUND).toBe('not-found');
            expect(ISSUE.CODE.FORBIDDEN).toBe('forbidden');
            expect(ISSUE.CODE.CONFLICT).toBe('conflict');
            expect(ISSUE.CODE.PROCESSING).toBe('processing');
            expect(ISSUE.CODE.TIMEOUT).toBe('timeout');
            expect(ISSUE.CODE.THROTTLED).toBe('throttled');
        });

        test('CODE security subcodes', () => {
            expect(ISSUE.CODE.SECURITY).toBe('security');
            expect(ISSUE.CODE.LOGIN).toBe('login');
            expect(ISSUE.CODE.UNKNOWN).toBe('unknown');
            expect(ISSUE.CODE.EXPIRED).toBe('expired');
        });
    });

    describe('INTERACTIONS', () => {
        test('CRUD operations map to correct method names', () => {
            expect(INTERACTIONS.SEARCH).toBe('search');
            expect(INTERACTIONS.SEARCH_BY_ID).toBe('searchById');
            expect(INTERACTIONS.SEARCH_BY_VID).toBe('searchByVersionId');
            expect(INTERACTIONS.CREATE).toBe('create');
            expect(INTERACTIONS.UPDATE).toBe('update');
            expect(INTERACTIONS.DELETE).toBe('remove');
            expect(INTERACTIONS.PATCH).toBe('patch');
        });

        test('history operations', () => {
            expect(INTERACTIONS.HISTORY).toBe('history');
            expect(INTERACTIONS.HISTORY_BY_ID).toBe('historyById');
        });

        test('operations for custom FHIR ops', () => {
            expect(INTERACTIONS.OPERATIONS_POST).toBe('operationsPost');
            expect(INTERACTIONS.OPERATIONS_GET).toBe('operationsGet');
            expect(INTERACTIONS.OPERATIONS_DELETE).toBe('operationsDelete');
        });
    });

    describe('VERSIONS', () => {
        test('supports FHIR versions 1.0.2 through 4.0.1', () => {
            expect(VERSIONS['1_0_2']).toBe('1_0_2');
            expect(VERSIONS['3_0_1']).toBe('3_0_1');
            expect(VERSIONS['4_0_0']).toBe('4_0_0');
            expect(VERSIONS['4_0_1']).toBe('4_0_1');
        });

        test('version keys match their values', () => {
            Object.entries(VERSIONS).forEach(([key, value]) => {
                expect(key).toBe(value);
            });
        });
    });

    describe('EVENTS', () => {
        test('audit and provenance events', () => {
            expect(EVENTS.AUDIT).toBe('audit-event');
            expect(EVENTS.PROVENANCE).toBe('provenance');
        });
    });

    describe('RESOURCES', () => {
        test('practitioner resource name', () => {
            expect(RESOURCES.PRACTITIONER).toBe('practitioner');
        });
    });
});
