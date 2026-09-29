const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../config', () => ({}));
jest.mock('../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const {
    PatientProxyQueryRewriter
} = require('../../../queryRewriters/rewriters/patientProxyQueryRewriter');
const { RequestSpecificCache } = require('../../../utils/requestSpecificCache');
const { DATA_SHARING_PATIENT_TO_PERSON_DATA } = require('../../../constants');

describe('PatientProxyQueryRewriter PROA-safe cache', () => {
    let rewriter;
    let requestSpecificCache;
    let configManager;

    function buildRewriter() {
        requestSpecificCache = new RequestSpecificCache();
        configManager = { enableConsentedProaDataAccess: true, rewritePatientReference: false };
        return new PatientProxyQueryRewriter({
            personToPatientIdsExpander: { getPatientProxyIdsAsync: jest.fn() },
            configManager,
            requestSpecificCache
        });
    }

    function eligibleRequestInfo(overrides = {}) {
        return {
            requestId: 'req-1',
            originalUrl: '/4_0_0/Person/person.abc/$everything',
            method: 'GET',
            isUser: false,
            ...overrides
        };
    }

    function readCache(requestId = 'req-1') {
        return requestSpecificCache.getMap({
            requestId,
            name: DATA_SHARING_PATIENT_TO_PERSON_DATA
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        rewriter = buildRewriter();
    });

    describe('isProaCacheEligibleRequest parameter sensitivity', () => {
        test('returns true for a non-user GET $everything request with PROA enabled', () => {
            expect(rewriter.isProaCacheEligibleRequest(eligibleRequestInfo())).toBe(true);
        });

        test('returns false when the PROA feature flag is disabled', () => {
            configManager.enableConsentedProaDataAccess = false;

            expect(rewriter.isProaCacheEligibleRequest(eligibleRequestInfo())).toBe(false);
        });

        test('returns false when the url is not an $everything request', () => {
            const info = eligibleRequestInfo({ originalUrl: '/4_0_0/Person/person.abc/$graph' });

            expect(rewriter.isProaCacheEligibleRequest(info)).toBe(false);
        });

        test('returns false for a POST $everything request', () => {
            expect(rewriter.isProaCacheEligibleRequest(eligibleRequestInfo({ method: 'POST' }))).toBe(false);
        });

        test('returns false for a patient-scoped user token', () => {
            expect(rewriter.isProaCacheEligibleRequest(eligibleRequestInfo({ isUser: true }))).toBe(false);
        });

        test('returns false rather than throwing when requestInfo is absent', () => {
            expect(rewriter.isProaCacheEligibleRequest(undefined)).toBe(false);
        });
    });

    describe('writeProaSafeCache single group', () => {
        test('writes both the person-to-patients map and the reverse patient-to-person index', () => {
            rewriter.writeProaSafeCache({
                requestInfo: eligibleRequestInfo(),
                ownerVerifiedPersonToLinkedPatients: new Map([
                    ['person-uuid-1', new Set(['Patient/pat-1', 'Patient/pat-2'])]
                ])
            });

            const cache = readCache();
            expect(cache.get('personToLinkedPatientsMap').get('person-uuid-1')).toEqual([
                'Patient/pat-1',
                'Patient/pat-2'
            ]);
            expect(cache.get('patientReferenceToPersonUuid')).toEqual({
                'pat-1': ['person-uuid-1'],
                'pat-2': ['person-uuid-1']
            });
        });

        test('keeps entries for two persons written in a single call', () => {
            rewriter.writeProaSafeCache({
                requestInfo: eligibleRequestInfo(),
                ownerVerifiedPersonToLinkedPatients: new Map([
                    ['person-uuid-1', new Set(['Patient/pat-1'])],
                    ['person-uuid-2', new Set(['Patient/pat-2'])]
                ])
            });

            const map = readCache().get('personToLinkedPatientsMap');
            expect(Array.from(map.keys())).toEqual(['person-uuid-1', 'person-uuid-2']);
        });

        test('isolates cache entries written under different request ids', () => {
            rewriter.writeProaSafeCache({
                requestInfo: eligibleRequestInfo({ requestId: 'req-a' }),
                ownerVerifiedPersonToLinkedPatients: new Map([['person-a', new Set(['Patient/pat-a'])]])
            });
            rewriter.writeProaSafeCache({
                requestInfo: eligibleRequestInfo({ requestId: 'req-b' }),
                ownerVerifiedPersonToLinkedPatients: new Map([['person-b', new Set(['Patient/pat-b'])]])
            });

            expect(Array.from(readCache('req-a').get('personToLinkedPatientsMap').keys())).toEqual(['person-a']);
            expect(Array.from(readCache('req-b').get('personToLinkedPatientsMap').keys())).toEqual(['person-b']);
        });
    });
});
