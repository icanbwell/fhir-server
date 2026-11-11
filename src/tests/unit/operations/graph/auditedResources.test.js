const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const {
    getAuditedResources,
    getAuditedResourcesFromBundle,
    recordStreamedResources
} = require('../../../../operations/graph/auditedResources');

describe('auditedResources', () => {
    describe('getAuditedResources', () => {
        test('lists the resource and any resources contained in it', () => {
            expect(
                getAuditedResources({
                    resourceType: 'Claim',
                    _uuid: 'c1',
                    contained: [
                        {
                            resourceType: 'Practitioner',
                            _uuid: 'pr1',
                            contained: [{ resourceType: 'Organization', _uuid: 'org1' }]
                        }
                    ]
                })
            ).toEqual([
                { resourceType: 'Claim', _uuid: 'c1' },
                { resourceType: 'Practitioner', _uuid: 'pr1' },
                { resourceType: 'Organization', _uuid: 'org1' }
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
            wrapped = recordStreamedResources({ responseStreamer, auditedResources });
        });

        test('records a written resource after the original streamer has written it', async () => {
            const bundleEntry = { resource: { resourceType: 'Patient', _uuid: 'p1' } };

            await wrapped.writeBundleEntryAsync({ bundleEntry });

            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalledWith({ bundleEntry });
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
