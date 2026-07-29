'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');

const { MetaUuidEnrichmentProvider } = require('../../../enrich/providers/metaUuidEnrichmentProvider');

describe('MetaUuidEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new MetaUuidEnrichmentProvider();
    });

    describe('enrichAsync - client-controlled _metaUuid parameter', () => {
        test('SECURITY: _metaUuid=true leaks internal _uuid in meta.tag', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    _uuid: 'urn:uuid:internal-secret-uuid',
                    meta: {
                        tag: []
                    }
                }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            const uuidTag = result[0].meta.tag.find(t => t.code === 'urn:uuid:internal-secret-uuid');
            expect(uuidTag).toBeDefined();
            expect(uuidTag.system).toBe('https://www.icanbwell.com/uuid');
        });

        test('_metaUuid not set leaves resources unchanged', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    _uuid: 'urn:uuid:should-not-leak',
                    meta: {
                        tag: [{ system: 'existing', code: 'tag' }]
                    }
                }
            ];
            const parsedArgs = {};

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toHaveLength(1);
            expect(result[0].meta.tag[0].system).toBe('existing');
        });

        test('SECURITY: any authenticated client can request _metaUuid=true to leak UUIDs', async () => {
            const resources = [
                {
                    resourceType: 'Observation',
                    id: 'obs-1',
                    _uuid: 'urn:uuid:cross-tenant-uuid-target',
                    meta: { tag: [] }
                }
            ];
            const parsedArgs = { _metaUuid: true };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            const leaked = result[0].meta.tag.find(
                t => t.code === 'urn:uuid:cross-tenant-uuid-target'
            );
            expect(leaked).toBeDefined();
        });
    });

    describe('enrichAsync - resource without meta.tag creates new array', () => {
        test('creates meta.tag array when meta exists but tag is null', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'p1',
                    _uuid: 'urn:uuid:new-tag-uuid',
                    meta: {}
                }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toHaveLength(1);
            expect(result[0].meta.tag[0].code).toBe('urn:uuid:new-tag-uuid');
        });
    });

    describe('enrichAsync - contained resources', () => {
        test('SECURITY: recursively leaks _uuid of contained resources too', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'parent',
                    _uuid: 'urn:uuid:parent-uuid',
                    meta: { tag: [] },
                    contained: [
                        {
                            resourceType: 'Organization',
                            id: 'org-1',
                            _uuid: 'urn:uuid:contained-secret-uuid',
                            meta: { tag: [] }
                        }
                    ]
                }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            const containedTag = result[0].contained[0].meta.tag.find(
                t => t.code === 'urn:uuid:contained-secret-uuid'
            );
            expect(containedTag).toBeDefined();
        });
    });

    describe('enrichAsync - resource without _uuid', () => {
        test('resource without _uuid is not modified', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'p1',
                    meta: { tag: [] }
                }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].meta.tag).toHaveLength(0);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('applies _metaUuid enrichment to bundle entries', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'p1',
                        _uuid: 'urn:uuid:bundle-entry-uuid',
                        meta: { tag: [] }
                    }
                }
            ];
            const parsedArgs = { _metaUuid: 'true' };

            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            const tag = result[0].resource.meta.tag.find(
                t => t.code === 'urn:uuid:bundle-entry-uuid'
            );
            expect(tag).toBeDefined();
        });
    });
});
