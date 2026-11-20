const { describe, test, expect, jest } = require('@jest/globals');
const { GRIDFS, BLOB_OP } = require('../../../../../../constants');
const {
    unchangedEntry,
    buildResponseDocumentAsync
} = require('../../../../../../operations/writePipeline/operations/singleResource/singleResourceDocument');
const { Base64DataManager } = require('../../../../../../dataLayer/base64DataManager');
const { DatabaseAttachmentManager } = require('../../../../../../dataLayer/databaseAttachmentManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../../../../enrich/providers/identifierEnrichmentProvider');
const {
    GroupExtendedTagEnrichmentProvider
} = require('../../../../../../enrich/providers/groupExtendedTagEnrichmentProvider');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');

/**
 * The synthetic id and uuid of the resource every test in this file builds a response for.
 */
const RESOURCE_ID = 'single-resource-unit-patient';
const RESOURCE_UUID = '00000000-0000-4000-8000-000000000003';

/**
 * Returns a synthetic Patient document at the given version.
 */
const patientAt = (versionId) => ({
    resourceType: 'Patient',
    id: RESOURCE_ID,
    _uuid: RESOURCE_UUID,
    _sourceAssigningAuthority: 'client',
    meta: {
        versionId,
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/access', code: 'client' }
        ]
    },
    name: [{ family: 'Unit', given: ['Alpha'] }]
});

/**
 * Builds the single item of a write whose stored document is version 1. A written item also has a
 * candidate at version 2 and is queued; an unchanged item has none and is marked unchanged.
 */
const buildItem = ({ unchanged }) => {
    const item = new WriteItem({
        index: 0,
        incoming: { resourceType: 'Patient', id: RESOURCE_ID }
    });
    item.stored = patientAt('1');
    if (unchanged) {
        item.markUnchanged();
    } else {
        item.candidate = patientAt('2');
        item.markQueued();
    }
    return item;
};

/**
 * Builds the four collaborators with fakes that record their calls in `calls` and return what they
 * were given.
 */
const buildCollaborators = (calls = []) => {
    const base64DataManager = Object.create(Base64DataManager.prototype);
    base64DataManager.transformAsync = jest.fn(async (doc) => {
        calls.push('base64DataManager.transformAsync');
        return doc;
    });
    const databaseAttachmentManager = Object.create(DatabaseAttachmentManager.prototype);
    databaseAttachmentManager.transformAttachments = jest.fn(async (doc) => {
        calls.push('databaseAttachmentManager.transformAttachments');
        return doc;
    });
    const identifierEnrichmentProvider = Object.create(IdentifierEnrichmentProvider.prototype);
    identifierEnrichmentProvider.enrichIdentifierList = jest.fn(() => {
        calls.push('identifierEnrichmentProvider.enrichIdentifierList');
    });
    const groupExtendedTagEnrichmentProvider = Object.create(
        GroupExtendedTagEnrichmentProvider.prototype
    );
    groupExtendedTagEnrichmentProvider.enrichAsync = jest.fn(async ({ resources }) => {
        calls.push('groupExtendedTagEnrichmentProvider.enrichAsync');
        return resources;
    });
    return {
        base64DataManager,
        databaseAttachmentManager,
        identifierEnrichmentProvider,
        groupExtendedTagEnrichmentProvider
    };
};

describe('singleResourceDocument', () => {
    describe('unchangedEntry', () => {
        test('returns the id, uuid, source assigning authority and resource type, neither created nor updated', () => {
            expect(unchangedEntry(patientAt('1'))).toStrictEqual({
                created: false,
                updated: false,
                id: RESOURCE_ID,
                uuid: RESOURCE_UUID,
                sourceAssigningAuthority: 'client',
                resourceType: 'Patient'
            });
        });

        test('leaves out of the entry what the document does not have', () => {
            expect(unchangedEntry({ resourceType: 'Patient', id: RESOURCE_ID })).toStrictEqual({
                created: false,
                updated: false,
                id: RESOURCE_ID,
                uuid: undefined,
                sourceAssigningAuthority: undefined,
                resourceType: 'Patient'
            });
        });
    });

    describe('buildResponseDocumentAsync', () => {
        test.each([
            { name: 'the candidate of a written item', unchanged: false, expectedVersion: '2' },
            { name: 'the stored document of an unchanged item', unchanged: true, expectedVersion: '1' }
        ])('builds the response from $name and leaves the item as it was', async ({ unchanged, expectedVersion }) => {
            const item = buildItem({ unchanged });
            const itemBefore = JSON.parse(JSON.stringify({ stored: item.stored, candidate: item.candidate }));
            const source = unchanged ? item.stored : item.candidate;

            const { document, resource } = await buildResponseDocumentAsync({
                item,
                requestInfo: { headers: {} },
                ...buildCollaborators()
            });

            expect(document).not.toBe(source);
            expect(document.meta.versionId).toBe(expectedVersion);
            expect(resource.resourceType).toBe('Patient');
            expect(resource.id).toBe(RESOURCE_ID);
            expect(resource.meta.versionId).toBe(expectedVersion);
            expect(resource.name).toStrictEqual([{ family: 'Unit', given: ['Alpha'] }]);
            expect(resource._uuid).toBeUndefined();
            expect(JSON.parse(JSON.stringify({ stored: item.stored, candidate: item.candidate })))
                .toStrictEqual(itemBefore);
        });

        test('puts the attachments and base64 data back, then enriches the identifiers and the extended-Group tag, in that order', async () => {
            const calls = [];
            const requestInfo = { headers: {} };
            const collaborators = buildCollaborators(calls);

            await buildResponseDocumentAsync({
                item: buildItem({ unchanged: false }),
                requestInfo,
                ...collaborators
            });

            expect(calls).toStrictEqual([
                'databaseAttachmentManager.transformAttachments',
                'base64DataManager.transformAsync',
                'identifierEnrichmentProvider.enrichIdentifierList',
                'groupExtendedTagEnrichmentProvider.enrichAsync'
            ]);
            const { transformAttachments } = collaborators.databaseAttachmentManager;
            expect(transformAttachments.mock.calls[0][1]).toBe(GRIDFS.RETRIEVE);
            const { transformAsync } = collaborators.base64DataManager;
            expect(transformAsync.mock.calls[0].slice(1)).toStrictEqual([BLOB_OP.RETRIEVE, requestInfo]);
            expect(collaborators.groupExtendedTagEnrichmentProvider.enrichAsync.mock.calls[0][0].resources)
                .toHaveLength(1);
        });

        test('serializes the document each collaborator returned, not the one it was given', async () => {
            const collaborators = buildCollaborators();
            collaborators.databaseAttachmentManager.transformAttachments.mockImplementation(async (doc) => ({
                ...doc,
                name: [{ family: 'Attachments' }]
            }));
            collaborators.base64DataManager.transformAsync.mockImplementation(async (doc) => ({
                ...doc,
                gender: 'female'
            }));
            collaborators.identifierEnrichmentProvider.enrichIdentifierList.mockImplementation((doc) => {
                doc.identifier = [{ system: 'urn:test', value: 'enriched' }];
            });
            collaborators.groupExtendedTagEnrichmentProvider.enrichAsync.mockImplementation(
                async ({ resources }) => resources.map((doc) => ({ ...doc, active: true }))
            );

            const { document, resource } = await buildResponseDocumentAsync({
                item: buildItem({ unchanged: false }),
                requestInfo: { headers: {} },
                ...collaborators
            });

            expect(document.active).toBe(true);
            expect(resource.name).toStrictEqual([{ family: 'Attachments' }]);
            expect(resource.gender).toBe('female');
            expect(resource.identifier).toStrictEqual([{ system: 'urn:test', value: 'enriched' }]);
            expect(resource.active).toBe(true);
        });

        test('rejects with the error of a collaborator', async () => {
            const collaborators = buildCollaborators();
            const error = new Error('synthetic base64 failure');
            collaborators.base64DataManager.transformAsync.mockRejectedValue(error);

            await expect(buildResponseDocumentAsync({
                item: buildItem({ unchanged: false }),
                requestInfo: { headers: {} },
                ...collaborators
            })).rejects.toBe(error);
            expect(collaborators.groupExtendedTagEnrichmentProvider.enrichAsync).not.toHaveBeenCalled();
        });
    });
});
