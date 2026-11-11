const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const {
    getAuditedResources,
    getAuditedResourcesFromBundle,
    recordStreamedResources
} = require('../../../../operations/graph/auditedResources');

describe('auditedResources', () => {
    describe('getAuditedResources', () => {
        const claim = {
            resourceType: 'Claim',
            _uuid: 'c1',
            contained: [
                {
                    resourceType: 'Practitioner',
                    _uuid: 'pr1',
                    contained: [{ resourceType: 'Organization', _uuid: 'org1' }]
                }
            ]
        };

        test.each([
            ['not asked for contained resources', false, [{ resourceType: 'Claim', _uuid: 'c1' }]],
            [
                'asked for contained resources: direct children only, never deeper',
                true,
                [
                    { resourceType: 'Claim', _uuid: 'c1' },
                    { resourceType: 'Practitioner', _uuid: 'pr1' }
                ]
            ]
        ])('%s', (_, includeContained, expected) => {
            expect(getAuditedResources(claim, { includeContained })).toEqual(expected);
        });

        test('ignores ids planted in a stored contained element unless the graph attached it', () => {
            const planted = {
                resourceType: 'Patient',
                _uuid: 'p1',
                contained: [{ resourceType: 'Patient', id: 'x', _uuid: 'victim-uuid' }]
            };

            expect(getAuditedResources(planted)).toEqual([{ resourceType: 'Patient', _uuid: 'p1' }]);
        });
    });

    describe('getAuditedResources with natively contained resources', () => {
        test('skips a contained resource that has no internal id but keeps ones that do', () => {
            expect(
                getAuditedResources(
                    {
                        resourceType: 'MedicationRequest',
                        _uuid: 'm1',
                        contained: [
                            { resourceType: 'Medication', id: 'med1' },
                            { resourceType: 'Practitioner', _uuid: 'pr1' }
                        ]
                    },
                    { includeContained: true }
                )
            ).toEqual([
                { resourceType: 'MedicationRequest', _uuid: 'm1' },
                { resourceType: 'Practitioner', _uuid: 'pr1' }
            ]);
        });
    });

    describe('getAuditedResourcesFromBundle', () => {
        test.each([
            ['a bundle without entries', {}, []],
            [
                'a bundle with entries',
                {
                    entry: [
                        { resource: { resourceType: 'Patient', _uuid: 'p1' } },
                        { resource: { resourceType: 'Observation', _uuid: 'o1' } }
                    ]
                },
                [
                    { resourceType: 'Patient', _uuid: 'p1' },
                    { resourceType: 'Observation', _uuid: 'o1' }
                ]
            ]
        ])('%s', (_, bundle, expected) => {
            expect(getAuditedResourcesFromBundle(bundle)).toEqual(expected);
        });

        test('lists direct contained resources only when asked to', () => {
            const bundle = {
                entry: [
                    {
                        resource: {
                            resourceType: 'Patient',
                            _uuid: 'p1',
                            contained: [{ resourceType: 'Practitioner', _uuid: 'pr1' }]
                        }
                    }
                ]
            };

            expect(getAuditedResourcesFromBundle(bundle)).toHaveLength(1);
            expect(getAuditedResourcesFromBundle(bundle, { includeContained: true })).toHaveLength(2);
        });
    });

    describe('recordStreamedResources', () => {
        let responseStreamer;
        let auditedResources;
        let wrapped;

        beforeEach(() => {
            responseStreamer = {
                requestId: 'stream-1',
                writeBundleEntryAsync: jest.fn().mockResolvedValue(undefined),
                setBundle: jest.fn(function setBundle () { return this.requestId; })
            };
            auditedResources = [];
            wrapped = recordStreamedResources({
                responseStreamer,
                auditedResources,
                includeContained: true
            });
        });

        test('records a written resource after the original streamer has written it', async () => {
            const bundleEntry = { resource: { resourceType: 'Patient', _uuid: 'p1' } };

            await wrapped.writeBundleEntryAsync({ bundleEntry });

            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalledWith({ bundleEntry });
            expect(auditedResources).toEqual([{ resourceType: 'Patient', _uuid: 'p1' }]);
        });

        test('records the ids even when writing the entry strips them from the resource', async () => {
            responseStreamer.writeBundleEntryAsync.mockImplementation(async ({ bundleEntry }) => {
                delete bundleEntry.resource._uuid;
            });

            await wrapped.writeBundleEntryAsync({
                bundleEntry: { resource: { resourceType: 'Patient', _uuid: 'p1' } }
            });

            expect(auditedResources).toEqual([{ resourceType: 'Patient', _uuid: 'p1' }]);
        });

        test('records a resource shared by several entries after the first write stripped its id', async () => {
            const sharedPractitioner = { resourceType: 'Practitioner', _uuid: 'pr1' };
            responseStreamer.writeBundleEntryAsync.mockImplementation(async ({ bundleEntry }) => {
                delete bundleEntry.resource._uuid;
                (bundleEntry.resource.contained || []).forEach((c) => delete c._uuid);
            });
            const entryFor = (_uuid) => ({
                resource: {
                    resourceType: 'Patient',
                    _uuid,
                    contained: [sharedPractitioner]
                }
            });

            await wrapped.writeBundleEntryAsync({ bundleEntry: entryFor('p1') });
            await wrapped.writeBundleEntryAsync({ bundleEntry: entryFor('p2') });

            expect(auditedResources).toEqual([
                { resourceType: 'Patient', _uuid: 'p1' },
                { resourceType: 'Practitioner', _uuid: 'pr1' },
                { resourceType: 'Patient', _uuid: 'p2' },
                { resourceType: 'Practitioner', _uuid: 'pr1' }
            ]);
        });

        test('records an entry with a very large contained list without throwing', async () => {
            const contained = Array.from({ length: 300000 }, (_, i) => ({
                resourceType: 'Observation',
                _uuid: `o${i}`
            }));

            await wrapped.writeBundleEntryAsync({
                bundleEntry: { resource: { resourceType: 'Patient', _uuid: 'p1', contained } }
            });

            expect(auditedResources).toHaveLength(300001);
        });

        test('ignores contained resources when the request did not ask for them', async () => {
            const withoutContained = recordStreamedResources({ responseStreamer, auditedResources });

            await withoutContained.writeBundleEntryAsync({
                bundleEntry: {
                    resource: {
                        resourceType: 'Patient',
                        _uuid: 'p1',
                        contained: [{ resourceType: 'Patient', _uuid: 'planted-uuid' }]
                    }
                }
            });

            expect(auditedResources).toEqual([{ resourceType: 'Patient', _uuid: 'p1' }]);
        });

        test('does not record a resource the streamer failed to write', async () => {
            responseStreamer.writeBundleEntryAsync.mockRejectedValue(new Error('closed'));

            await expect(
                wrapped.writeBundleEntryAsync({
                    bundleEntry: { resource: { resourceType: 'Patient', _uuid: 'p1' } }
                })
            ).rejects.toThrow('closed');

            expect(auditedResources).toEqual([]);
        });

        test('forwards other methods and properties to the original streamer', () => {
            expect(wrapped.requestId).toBe('stream-1');
            expect(wrapped.setBundle({ bundle: {} })).toBe('stream-1');
            expect(responseStreamer.setBundle).toHaveBeenCalledWith({ bundle: {} });
        });
    });
});
