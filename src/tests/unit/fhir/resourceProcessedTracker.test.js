const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');
const { ResourceProccessedTracker } = require('../../../fhir/resourceProcessedTracker');

describe('ResourceProccessedTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = new ResourceProccessedTracker();
    });

    describe('constructor', () => {
        test('initializes with empty sets', () => {
            expect(tracker.uuidSet.size).toBe(0);
            expect(tracker.sourceIdSet.size).toBe(0);
            expect(tracker.sourceIdSourceAssigningAuthoritySet.size).toBe(0);
        });
    });

    describe('add', () => {
        test('adds resource identifier to all three sets', () => {
            const identifier = {
                resourceType: 'Patient',
                _uuid: 'uuid-123',
                _sourceId: 'source-456',
                _sourceAssigningAuthority: 'auth-789'
            };
            tracker.add(identifier);
            expect(tracker.uuidSet.has('Patient/uuid-123')).toBe(true);
            expect(tracker.sourceIdSet.has('Patient/source-456')).toBe(true);
            expect(tracker.sourceIdSourceAssigningAuthoritySet.has('Patient/source-456|auth-789')).toBe(true);
        });

        test('can add multiple identifiers', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceId: 'src-1',
                _sourceAssigningAuthority: 'auth-1'
            });
            tracker.add({
                resourceType: 'Observation',
                _uuid: 'uuid-2',
                _sourceId: 'src-2',
                _sourceAssigningAuthority: 'auth-2'
            });
            expect(tracker.uuidSet.size).toBe(2);
            expect(tracker.sourceIdSet.size).toBe(2);
            expect(tracker.sourceIdSourceAssigningAuthoritySet.size).toBe(2);
        });

        test('does not create duplicates when adding same identifier twice', () => {
            const identifier = {
                resourceType: 'Patient',
                _uuid: 'uuid-dup',
                _sourceId: 'src-dup',
                _sourceAssigningAuthority: 'auth-dup'
            };
            tracker.add(identifier);
            tracker.add(identifier);
            expect(tracker.uuidSet.size).toBe(1);
            expect(tracker.sourceIdSet.size).toBe(1);
            expect(tracker.sourceIdSourceAssigningAuthoritySet.size).toBe(1);
        });

        test('constructs keys using resourceType/value format', () => {
            tracker.add({
                resourceType: 'Encounter',
                _uuid: 'enc-uuid',
                _sourceId: 'enc-src',
                _sourceAssigningAuthority: 'enc-auth'
            });
            expect(tracker.uuidSet.has('Encounter/enc-uuid')).toBe(true);
            expect(tracker.sourceIdSet.has('Encounter/enc-src')).toBe(true);
            expect(tracker.sourceIdSourceAssigningAuthoritySet.has('Encounter/enc-src|enc-auth')).toBe(true);
        });
    });

    describe('has', () => {
        test('returns true when uuid matches', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'uuid-match',
                _sourceId: 'src-a',
                _sourceAssigningAuthority: 'auth-a'
            });
            const lookup = {
                resourceType: 'Patient',
                _uuid: 'uuid-match',
                _sourceId: 'different-src',
                _sourceAssigningAuthority: 'different-auth'
            };
            expect(tracker.has(lookup)).toBe(true);
        });

        test('returns true when sourceId+sourceAssigningAuthority matches', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'uuid-original',
                _sourceId: 'src-match',
                _sourceAssigningAuthority: 'auth-match'
            });
            const lookup = {
                resourceType: 'Patient',
                _uuid: 'uuid-different',
                _sourceId: 'src-match',
                _sourceAssigningAuthority: 'auth-match'
            };
            expect(tracker.has(lookup)).toBe(true);
        });

        test('returns false when neither uuid nor sourceId+auth matches', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'uuid-x',
                _sourceId: 'src-x',
                _sourceAssigningAuthority: 'auth-x'
            });
            const lookup = {
                resourceType: 'Patient',
                _uuid: 'uuid-y',
                _sourceId: 'src-y',
                _sourceAssigningAuthority: 'auth-y'
            };
            expect(tracker.has(lookup)).toBe(false);
        });

        test('returns false when sourceId matches but authority does not', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceId: 'shared-src',
                _sourceAssigningAuthority: 'auth-1'
            });
            const lookup = {
                resourceType: 'Patient',
                _uuid: 'uuid-2',
                _sourceId: 'shared-src',
                _sourceAssigningAuthority: 'auth-2'
            };
            expect(tracker.has(lookup)).toBe(false);
        });

        test('returns false when resourceType differs even if uuid value matches', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'shared-uuid',
                _sourceId: 'src-1',
                _sourceAssigningAuthority: 'auth-1'
            });
            const lookup = {
                resourceType: 'Observation',
                _uuid: 'shared-uuid',
                _sourceId: 'src-1',
                _sourceAssigningAuthority: 'auth-1'
            };
            expect(tracker.has(lookup)).toBe(false);
        });

        test('returns false on empty tracker', () => {
            const lookup = {
                resourceType: 'Patient',
                _uuid: 'uuid-1',
                _sourceId: 'src-1',
                _sourceAssigningAuthority: 'auth-1'
            };
            expect(tracker.has(lookup)).toBe(false);
        });

        test('does NOT use sourceId alone for matching (requires authority too)', () => {
            tracker.add({
                resourceType: 'Patient',
                _uuid: 'uuid-orig',
                _sourceId: 'src-same',
                _sourceAssigningAuthority: 'auth-orig'
            });
            // lookup with same sourceId but different authority and different uuid
            const lookup = {
                resourceType: 'Patient',
                _uuid: 'uuid-other',
                _sourceId: 'src-same',
                _sourceAssigningAuthority: 'auth-other'
            };
            expect(tracker.has(lookup)).toBe(false);
        });
    });
});
