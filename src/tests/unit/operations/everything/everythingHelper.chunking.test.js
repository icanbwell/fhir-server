'use strict';

const { describe, test, expect } = require('@jest/globals');
const { getEverythingIdChunks } = require('../../../../operations/everything/everythingHelper');
const { PERSON_PROXY_PREFIX } = require('../../../../constants');

const BATCH_SIZE = 10;

/**
 * Builds the id list $everything resolves for one Person: the linked Patient ids first, then the
 * Person's proxy-patient id last (same order as personToPatientIdsExpander).
 * @param {number} linkedPatientCount
 * @returns {string[]}
 */
function buildIdsForPerson(linkedPatientCount) {
    const linked = Array.from({ length: linkedPatientCount }, (_, i) => `patient-${i}`);
    return [...linked, `${PERSON_PROXY_PREFIX}person-1`];
}

describe('getEverythingIdChunks', () => {
    // N linked Patients plus the proxy id gives N+1 ids. The proxy id used to end up alone in the
    // last chunk when N+1 is one more than a multiple of the batch size (N = 10, 20, 30).
    test.each([[1], [8], [9], [10], [11], [12], [19], [20], [21], [29], [30], [31]])(
        'with %i linked Patients, no chunk holds only the proxy id and every id is kept once, in order',
        (linkedPatientCount) => {
            const ids = buildIdsForPerson(linkedPatientCount);

            const chunks = getEverythingIdChunks(ids, BATCH_SIZE);

            const isProxyOnlyChunk = (chunk) =>
                chunk.every((id) => id.startsWith(PERSON_PROXY_PREFIX));
            expect(chunks.some(isProxyOnlyChunk)).toBe(false);
            expect(chunks.flat()).toEqual(ids);
        }
    );

    test.each([
        [9, 1],
        [10, 1],
        [11, 2],
        [20, 2],
        [30, 3]
    ])(
        'with %i linked Patients, the id list is split into %i chunks',
        (linkedPatientCount, expectedChunkCount) => {
            const chunks = getEverythingIdChunks(buildIdsForPerson(linkedPatientCount), BATCH_SIZE);

            expect(chunks).toHaveLength(expectedChunkCount);
        }
    );

    test('appends a lone trailing proxy id to the previous batch', () => {
        const chunks = getEverythingIdChunks(buildIdsForPerson(10), BATCH_SIZE);

        expect(chunks).toHaveLength(1);
        expect(chunks[0][chunks[0].length - 1]).toBe(`${PERSON_PROXY_PREFIX}person-1`);
        expect(chunks[0]).toContain('patient-9');
    });

    test('does not merge proxy ids into a batch of real Patients when they are not alone in the last chunk', () => {
        const ids = [
            ...Array.from({ length: 12 }, (_, i) => `patient-${i}`),
            `${PERSON_PROXY_PREFIX}person-1`
        ];

        const chunks = getEverythingIdChunks(ids, BATCH_SIZE);

        expect(chunks.map((c) => c.length)).toEqual([10, 3]);
    });

    test('returns a single chunk when the ids fit in one batch', () => {
        const ids = buildIdsForPerson(3);

        expect(getEverythingIdChunks(ids, BATCH_SIZE)).toEqual([ids]);
    });

    test('returns no chunks for an empty id list', () => {
        expect(getEverythingIdChunks([], BATCH_SIZE)).toEqual([]);
    });
});

/**
 * Builds the id list $everything resolves for several Persons: for each Person its linked Patient
 * ids followed by its proxy-patient id, one Person after the other (same order as
 * patientProxyQueryRewriter).
 * @param {number[]} linkedPatientCounts
 * @returns {string[]}
 */
function buildIdsForPersons(linkedPatientCounts) {
    return linkedPatientCounts.flatMap((count, personIndex) => [
        ...Array.from({ length: count }, (_, i) => `person-${personIndex}-patient-${i}`),
        `${PERSON_PROXY_PREFIX}person-${personIndex}`
    ]);
}

describe('getEverythingIdChunks with several Persons', () => {
    test.each([
        [[10, 5]],
        [[20, 5]],
        [[30, 5]],
        [[10, 10]],
        [[10, 10, 10]],
        [[9, 10, 10]],
        [[5, 5, 5]],
        [[1, 10, 1]],
        [[3, 20, 7]]
    ])(
        'with linked Patient counts %j every proxy id shares a batch with a Patient of its own Person',
        (linkedPatientCounts) => {
            const ids = buildIdsForPersons(linkedPatientCounts);

            const chunks = getEverythingIdChunks(ids, BATCH_SIZE);

            expect(chunks.flat()).toEqual(ids);
            linkedPatientCounts.forEach((_, personIndex) => {
                const proxyId = `${PERSON_PROXY_PREFIX}person-${personIndex}`;
                const batch = chunks.find((chunk) => chunk.includes(proxyId));
                expect(batch.some((id) => id.startsWith(`person-${personIndex}-patient-`))).toBe(
                    true
                );
            });
        }
    );

    test('moves a proxy id that starts a batch to the previous batch', () => {
        const ids = buildIdsForPersons([10, 5]);

        const chunks = getEverythingIdChunks(ids, BATCH_SIZE);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toHaveLength(11);
        expect(chunks[0][10]).toBe(`${PERSON_PROXY_PREFIX}person-0`);
        expect(chunks[1]).toHaveLength(6);
        expect(chunks[1][0]).toBe('person-1-patient-0');
        expect(chunks[1][5]).toBe(`${PERSON_PROXY_PREFIX}person-1`);
    });
});
