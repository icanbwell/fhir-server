const { describe, test, expect, jest, beforeAll, afterAll } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { PreSaveManager } = require('../../../../../../preSaveHandlers/preSave');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { ResourceMerger } = require('../../../../../../operations/common/resourceMerger');
const { GroupMemberMerger } = require('../../../../../../operations/common/groupMemberMerger');
const { DatabaseAttachmentManager } = require('../../../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../../../dataLayer/base64DataManager');
const { PostSaveHandlerFactory } = require('../../../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory');
const { MongoDatabaseManager } = require('../../../../../../utils/mongoDatabaseManager');
const { RequestSpecificCache } = require('../../../../../../utils/requestSpecificCache');
const { FhirRequestInfo } = require('../../../../../../utils/fhirRequestInfo');
const BaseSerializer = require('../../../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');
const { PatientFilterManager } = require('../../../../../../fhir/patientFilterManager');
const { ResourceValidator } = require('../../../../../../operations/common/resourceValidator');
const { ScopesManager } = require('../../../../../../operations/security/scopesManager');
const { AdminBuilder } = require('../../../../../../operations/writePipeline/steps/build/adminBuilder');
const { InsertBuilder } = require('../../../../../../operations/writePipeline/steps/build/insertBuilder');
const { SmartMergeBuilder } = require('../../../../../../operations/writePipeline/steps/build/smartMergeBuilder');
const { ReplaceBuilder } = require('../../../../../../operations/writePipeline/steps/build/replaceBuilder');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { generateUUIDv5, isUuid } = require('../../../../../../utils/uid.util');

const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';
const SAA_SYSTEM = 'https://www.icanbwell.com/sourceAssigningAuthority';
const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';
const SOURCE = 'https://example.test/source';
const STORED_LAST_UPDATED = '2024-01-01T00:00:00.000Z';
const SECURITY = Object.freeze([
    { system: OWNER_SYSTEM, code: 'owner' },
    { system: ACCESS_SYSTEM, code: 'owner' },
    { system: SAA_SYSTEM, code: 'owner' }
]);

const PERSON_UUID = generateUUIDv5('person-1|owner');
const PATIENT_UUID = generateUUIDv5('patient-1|owner');
const OTHER_PATIENT_UUID = generateUUIDv5('patient-2|owner');
const OLD_PATIENT_UUID = generateUUIDv5('patient-old|owner');

/**
 * Builds a synthetic stored document of the given type and id: the identity fields preSave adds,
 * an owner, access and source assigning authority tag, version 2 and a stored `lastUpdated`.
 * @param {string} resourceType
 * @param {string} id
 * @param {Object} fields
 * @returns {Object}
 */
const stored = ({ resourceType, id, ...fields }) => ({
    resourceType,
    id,
    _uuid: generateUUIDv5(`${id}|owner`),
    _sourceId: id,
    _sourceAssigningAuthority: 'owner',
    meta: {
        versionId: '2',
        lastUpdated: STORED_LAST_UPDATED,
        source: SOURCE,
        security: deepcopy(SECURITY)
    },
    ...fields
});

/**
 * Builds a stored reference to the Patient with the uuid, with the global id fields preSave adds.
 * @param {string} uuid
 * @returns {Object}
 */
const storedPatientReference = (uuid) => ({
    reference: `Patient/${uuid}`,
    _uuid: `Patient/${uuid}`,
    _sourceId: `Patient/${uuid}`,
    _sourceAssigningAuthority: 'owner'
});

/**
 * Builds a stored Person with the given links.
 * @param {Object[]} link
 * @returns {Object}
 */
const storedPerson = (link) => stored({ resourceType: 'Person', id: 'person-1', link });

/**
 * Builds a stored Observation whose subject is the given reference.
 * @param {Object|undefined} subject
 * @returns {Object}
 */
const storedObservation = (subject) => stored({
    resourceType: 'Observation',
    id: 'observation-1',
    status: 'final',
    code: { text: 'synthetic' },
    ...(subject ? { subject } : {})
});

/**
 * The loaded Patient a link points to.
 */
const linkedPatient = stored({ resourceType: 'Patient', id: 'patient-1' });

/**
 * Builds a configManager whose source-tag rule is off.
 * @returns {ConfigManager}
 */
const buildConfigManager = () => {
    const configManager = new ConfigManager();
    Object.defineProperty(configManager, 'requireMetaSourceTags', { get: () => false });
    return configManager;
};

/**
 * Builds a resource validator with only what its meta check reads: the config manager and a real
 * scopes manager.
 * @param {ConfigManager} configManager
 * @returns {ResourceValidator}
 */
const buildMetaValidator = (configManager) => {
    const resourceValidator = Object.create(ResourceValidator.prototype);
    resourceValidator.configManager = configManager;
    resourceValidator.scopesManager = new ScopesManager({
        configManager,
        patientFilterManager: new PatientFilterManager()
    });
    return resourceValidator;
};

/**
 * Builds the admin builder with the real insert, smart merge and replace builders, which use the
 * real merger and pre-save handlers with GridFS and base64 storage off, and spies on each of the
 * three so a test can see which one built the item. The admin builder reads the stored document
 * back in through the given GridFS and base64 managers, by default the same ones, with storage off,
 * and checks a new Person's meta with the real meta check.
 * @param {PatientFilterManager} patientFilterManager
 * @param {{databaseAttachmentManager?: DatabaseAttachmentManager, base64DataManager?: Base64DataManager}} [hydration]
 * @returns {{adminBuilder: AdminBuilder, spies: Object}}
 */
const buildAdminBuilder = (patientFilterManager = new PatientFilterManager(), hydration = {}) => {
    const configManager = buildConfigManager();
    const preSaveManager = new PreSaveManager({
        preSaveHandlers: [
            new SourceAssigningAuthorityColumnHandler({ configManager }),
            new UuidColumnHandler()
        ]
    });
    const groupMemberMerger = new GroupMemberMerger({ configManager });
    const resourceMerger = new ResourceMerger({ preSaveManager, configManager, groupMemberMerger });
    const databaseAttachmentManager = new DatabaseAttachmentManager({
        mongoDatabaseManager: Object.create(MongoDatabaseManager.prototype),
        configManager
    });
    const base64DataManager = new Base64DataManager({
        configManager,
        requestSpecificCache: Object.create(RequestSpecificCache.prototype),
        preSaveManager
    });
    const postSaveHandlerFactory = Object.create(PostSaveHandlerFactory.prototype);
    postSaveHandlerFactory.getHandlers = () => [];
    const insertBuilder = new InsertBuilder({ groupMemberMerger });
    const smartMergeBuilder = new SmartMergeBuilder({
        preSaveManager,
        resourceMerger,
        configManager,
        databaseAttachmentManager,
        base64DataManager,
        groupMemberMerger
    });
    const replaceBuilder = new ReplaceBuilder({
        resourceMerger,
        databaseAttachmentManager,
        base64DataManager,
        postSaveHandlerFactory,
        insertBuilder: new InsertBuilder({ groupMemberMerger }),
        groupMemberMerger
    });
    const spies = {
        insertBuilder: jest.spyOn(insertBuilder, 'buildAsync'),
        smartMergeBuilder: jest.spyOn(smartMergeBuilder, 'buildAsync'),
        replaceBuilder: jest.spyOn(replaceBuilder, 'buildAsync')
    };
    const adminBuilder = new AdminBuilder({
        insertBuilder,
        smartMergeBuilder,
        replaceBuilder,
        patientFilterManager,
        databaseAttachmentManager: hydration.databaseAttachmentManager ?? databaseAttachmentManager,
        base64DataManager: hydration.base64DataManager ?? base64DataManager,
        resourceValidator: buildMetaValidator(configManager)
    });
    return { adminBuilder, spies };
};

/**
 * Builds a write context for an admin write with no request headers, whose request has the method.
 * @param {string} method
 * @returns {WriteContext}
 */
const buildContext = (method) => new WriteContext({
    requestInfo: new FhirRequestInfo({
        user: 'test-user',
        scope: 'user/*.* access/*.* admin/*.*',
        requestId: 'request-1',
        protocol: 'https',
        originalUrl: '/admin/test',
        host: 'localhost',
        headers: {},
        method
    }),
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: true
});

/**
 * Builds an admin item the loader has filled: the change, the stored target (null when it is to be
 * created) and the linked resources.
 * @param {string} kind
 * @param {{resourceType: string, id: string}} target
 * @param {{resourceType: string, id: string}} linkTarget
 * @param {Object|null} storedDoc
 * @param {Array<{resourceType: string, resource: Object}>} linked
 * @returns {WriteItem}
 */
const buildItem = ({ kind, target, linkTarget, storedDoc, linked = [] }) => {
    const item = new WriteItem({
        index: 0,
        incoming: { resourceType: target.resourceType, id: target.id, _uuid: target.id }
    });
    item.adminChange = {
        kind,
        target,
        linkTarget,
        linkTargetLookup: linked.length > 0 ? 'always' : 'never',
        createsMissingTarget: storedDoc === null
    };
    item.stored = storedDoc;
    item.linked = linked;
    return item;
};

/**
 * Runs the admin builder on the item and returns the failure, the item, the spies, a copy of the
 * stored document taken before the build and the write context, whose request starts with the
 * method (`POST`, the admin route's method, by default). Comparing that copy with `item.stored`
 * after the build shows only that the stored content is unchanged: the admin builder never writes
 * `item.stored`, but the smart merge builder replaces it with its pre-saved copy, which here has
 * the same content.
 * @param {WriteItem} item
 * @param {PatientFilterManager} [patientFilterManager]
 * @param {string} [method]
 * @returns {Promise<Object>}
 */
const build = async (item, patientFilterManager, method = 'POST') => {
    const { adminBuilder, spies } = buildAdminBuilder(patientFilterManager);
    const storedBefore = deepcopy(item.stored);
    const context = buildContext(method);
    const failure = await adminBuilder.buildAsync({ item, context });
    return { failure, item, spies, storedBefore, context };
};

/**
 * A request method no admin build sets, so a test sees whether the build changed the method.
 */
const UNSET_METHOD = 'GET';

/**
 * Returns the names of the composed builders that were called.
 * @param {Object} spies
 * @returns {string[]}
 */
const calledBuilders = (spies) => Object.entries(spies)
    .filter(([, spy]) => spy.mock.calls.length > 0)
    .map(([name]) => name);

/**
 * Builds a patient field mapping that, unlike the real one, names a single reference field for
 * Person, so a test can show that a Person is refused whatever the mapping says.
 * @returns {PatientFilterManager}
 */
const personMappedPatientFilterManager = () => {
    const patientFilterManager = new PatientFilterManager();
    patientFilterManager.patientFilterMapping.Person = 'managingOrganization.reference';
    return patientFilterManager;
};

/**
 * The data the fake GridFS manager reads back for a stored attachment, in base64.
 */
const GRIDFS_DATA = 'Z3JpZGZzLWRhdGE=';

/**
 * The data the fake base64 manager reads back from cloud storage, in base64.
 */
const CLOUD_DATA = 'Y2xvdWQtZGF0YQ==';

/**
 * Puts the GridFS data on every object in the value that has a `_file_id`, in place.
 * @param {*} value
 * @returns {void}
 */
const readBackGridFsData = (value) => {
    if (!value || typeof value !== 'object') {
        return;
    }
    if (value._file_id) {
        value.data = GRIDFS_DATA;
    }
    Object.values(value).forEach(readBackGridFsData);
};

/**
 * Builds fake GridFS and base64 managers that read the stored data back in the way the real ones
 * do: the GridFS one puts data on each attachment with a `_file_id`, the base64 one puts data on a
 * resource with `_blobMeta`. Each records the operation it was asked for and the document it got.
 * @returns {{databaseAttachmentManager: DatabaseAttachmentManager, base64DataManager: Base64DataManager}}
 */
const fakeHydration = () => {
    const databaseAttachmentManager = Object.create(DatabaseAttachmentManager.prototype);
    databaseAttachmentManager.transformAttachments = jest.fn(async (resource) => {
        readBackGridFsData(resource);
        return resource;
    });
    const base64DataManager = Object.create(Base64DataManager.prototype);
    base64DataManager.transformAsync = jest.fn(async (resource) => {
        if (resource._blobMeta) {
            resource.data = CLOUD_DATA;
        }
        return resource;
    });
    return { databaseAttachmentManager, base64DataManager };
};

const PERSON = Object.freeze({ resourceType: 'Person', id: PERSON_UUID });
const PATIENT = Object.freeze({ resourceType: 'Patient', id: PATIENT_UUID });
const OBSERVATION = Object.freeze({
    resourceType: 'Observation',
    id: generateUUIDv5('observation-1|owner')
});

describe('AdminBuilder', () => {
    beforeAll(() => {
        BaseSerializer.setConfigManager(new ConfigManager());
    });

    afterAll(() => {
        BaseSerializer.setConfigManager(null);
    });

    test.each([
        {
            name: 'addLink to a stored Person appends the link and is built by the smart merge as the next version',
            item: () => buildItem({
                kind: 'addLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([{ target: storedPatientReference(OTHER_PATIENT_UUID) }]),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            }),
            builder: 'smartMergeBuilder',
            expected: {
                writeMode: 'update',
                versionId: '3',
                links: [`Patient/${OTHER_PATIENT_UUID}`, `Patient/${PATIENT_UUID}`],
                method: 'PATCH'
            }
        },
        {
            name: 'addLink with no stored Person creates one linked to the Patient, built by the insert as version 1',
            item: () => buildItem({
                kind: 'addLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: null,
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            }),
            builder: 'insertBuilder',
            expected: {
                writeMode: 'insert',
                versionId: '1',
                links: [`Patient/${PATIENT_UUID}`],
                method: 'POST'
            }
        },
        {
            name: 'removeLink drops the link matched on its _uuid and is built by the replace as the next version',
            item: () => buildItem({
                kind: 'removeLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([
                    { target: storedPatientReference(OTHER_PATIENT_UUID) },
                    { target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } }
                ])
            }),
            builder: 'replaceBuilder',
            expected: {
                writeMode: 'update',
                versionId: '3',
                links: [`Patient/${OTHER_PATIENT_UUID}`],
                method: 'PATCH'
            }
        },
        {
            name: 'removeLink drops a link with no _uuid matched on its reference',
            item: () => buildItem({
                kind: 'removeLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([
                    { target: storedPatientReference(OTHER_PATIENT_UUID) },
                    { target: { reference: `Patient/${PATIENT_UUID}` } }
                ])
            }),
            builder: 'replaceBuilder',
            expected: {
                writeMode: 'update',
                versionId: '3',
                links: [`Patient/${OTHER_PATIENT_UUID}`],
                method: 'PATCH'
            }
        },
        {
            name: 'rewritePatientReference points the patient field at the new Patient and is built by the replace as the next version',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: OBSERVATION,
                linkTarget: PATIENT,
                storedDoc: storedObservation({
                    reference: 'Patient/patient-old',
                    _uuid: `Patient/${OLD_PATIENT_UUID}`,
                    _sourceId: 'Patient/patient-old',
                    _sourceAssigningAuthority: 'owner'
                }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            }),
            builder: 'replaceBuilder',
            expected: {
                writeMode: 'update',
                versionId: '3',
                subject: { reference: `Patient/${PATIENT_UUID}` },
                method: 'PATCH'
            }
        }
    ])('$name, with the stored content unchanged', async ({ item, builder, expected }) => {
        const result = await build(item(), undefined, UNSET_METHOD);

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual([builder]);
        const candidate = result.item.candidate;
        expect({
            writeMode: result.item.writeMode,
            versionId: candidate.meta.versionId,
            ...(expected.links ? { links: candidate.link.map((link) => link.target.reference) } : {}),
            ...(expected.subject ? { subject: candidate.subject } : {}),
            method: result.context.requestInfo.method
        }).toStrictEqual(expected);
        expect(result.item.stored).toStrictEqual(result.storedBefore);
    });

    test('a created Person gets a new uuid as its id and _uuid, a meta id, and the Patient\'s source and security', async () => {
        const { failure, item } = await build(buildItem({
            kind: 'addLink',
            target: PERSON,
            linkTarget: PATIENT,
            storedDoc: null,
            linked: [{ resourceType: 'Patient', resource: linkedPatient }]
        }));

        expect(failure).toBeNull();
        const person = item.candidate;
        expect(person).toBe(item.incoming);
        expect(person.resourceType).toBe('Person');
        expect(isUuid(person.id)).toBe(true);
        expect(person._uuid).toBe(person.id);
        expect(person.id).not.toBe(PERSON_UUID);
        expect(isUuid(person.meta.id)).toBe(true);
        expect(person.meta.id).not.toBe(person.id);
        expect(person.meta.source).toBe(SOURCE);
        expect(person.meta.security.map(({ system, code }) => ({ system, code }))).toStrictEqual(SECURITY);
        expect(person.meta.security).not.toBe(linkedPatient.meta.security);
        expect(person.link).toStrictEqual([{ target: { reference: `Patient/${PATIENT_UUID}` } }]);
    });

    test.each([
        {
            name: 'addLink to a Person already linked on the _uuid',
            item: () => buildItem({
                kind: 'addLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([
                    { target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } }
                ]),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'addLink to a Person already linked on a reference with no _uuid',
            item: () => buildItem({
                kind: 'addLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([{ target: { reference: `Patient/${PATIENT_UUID}` } }]),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'removeLink with no link to the Patient',
            item: () => buildItem({
                kind: 'removeLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([{ target: storedPatientReference(OTHER_PATIENT_UUID) }])
            })
        },
        {
            name: 'removeLink from a Person with no links',
            item: () => buildItem({
                kind: 'removeLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson(undefined)
            })
        },
        {
            name: 'rewritePatientReference already pointing at the Patient on the reference',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: OBSERVATION,
                linkTarget: PATIENT,
                storedDoc: storedObservation({ reference: `Patient/${PATIENT_UUID}` }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'rewritePatientReference already pointing at the Patient on the _uuid',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: OBSERVATION,
                linkTarget: PATIENT,
                storedDoc: storedObservation({
                    reference: 'Patient/patient-1',
                    _uuid: `Patient/${PATIENT_UUID}`
                }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'rewritePatientReference on a Person',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: storedPerson([{ target: storedPatientReference(OTHER_PATIENT_UUID) }]),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'rewritePatientReference on a Person whose patient field mapping names a single reference',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: stored({
                    resourceType: 'Person',
                    id: 'person-1',
                    managingOrganization: { reference: 'Organization/organization-1' }
                }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            }),
            patientFilterManager: personMappedPatientFilterManager()
        },
        {
            name: 'rewritePatientReference on a Patient, whose patient field is its own id',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: { resourceType: 'Patient', id: OTHER_PATIENT_UUID },
                linkTarget: PATIENT,
                storedDoc: stored({ resourceType: 'Patient', id: 'patient-2' }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'rewritePatientReference on a resource type with no patient field',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: { resourceType: 'Practitioner', id: generateUUIDv5('practitioner-1|owner') },
                linkTarget: PATIENT,
                storedDoc: stored({ resourceType: 'Practitioner', id: 'practitioner-1' }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'rewritePatientReference on a resource whose patient field is a list',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: { resourceType: 'Account', id: generateUUIDv5('account-1|owner') },
                linkTarget: PATIENT,
                storedDoc: stored({
                    resourceType: 'Account',
                    id: 'account-1',
                    status: 'active',
                    subject: [storedPatientReference(OTHER_PATIENT_UUID)]
                }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        },
        {
            name: 'rewritePatientReference on a resource with its patient field missing',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: OBSERVATION,
                linkTarget: PATIENT,
                storedDoc: storedObservation(undefined),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            })
        }
    ])('$name is a no-op', async ({ item, patientFilterManager }) => {
        const result = await build(item(), patientFilterManager, UNSET_METHOD);

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual([]);
        expect(result.item.candidate).toBeNull();
        expect(result.item.writeMode).toBe('update');
        expect(result.item.stored).toStrictEqual(result.storedBefore);
        expect(result.context.requestInfo.method).toBe(UNSET_METHOD);
    });

    test.each([
        {
            name: 'rewritePatientReference on a DocumentReference with a GridFS attachment',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: {
                    resourceType: 'DocumentReference',
                    id: generateUUIDv5('document-1|owner')
                },
                linkTarget: PATIENT,
                storedDoc: stored({
                    resourceType: 'DocumentReference',
                    id: 'document-1',
                    status: 'current',
                    subject: storedPatientReference(OLD_PATIENT_UUID),
                    content: [{ attachment: { contentType: 'text/plain', _file_id: 'file-1' } }]
                }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            }),
            hydratedData: (body) => body.content[0].attachment.data,
            expectedData: GRIDFS_DATA
        },
        {
            name: 'rewritePatientReference on a Binary with its data in cloud storage',
            item: () => buildItem({
                kind: 'rewritePatientReference',
                target: { resourceType: 'Binary', id: generateUUIDv5('binary-1|owner') },
                linkTarget: PATIENT,
                storedDoc: stored({
                    resourceType: 'Binary',
                    id: 'binary-1',
                    contentType: 'application/pdf',
                    securityContext: storedPatientReference(OLD_PATIENT_UUID),
                    _blobMeta: { hash: 'synthetic-hash', lastUpdated: STORED_LAST_UPDATED }
                }),
                linked: [{ resourceType: 'Patient', resource: linkedPatient }]
            }),
            hydratedData: (body) => body.data,
            expectedData: CLOUD_DATA
        },
        {
            name: 'removeLink on a Person with a GridFS photo',
            item: () => buildItem({
                kind: 'removeLink',
                target: PERSON,
                linkTarget: PATIENT,
                storedDoc: {
                    ...storedPerson([{ target: storedPatientReference(PATIENT_UUID) }]),
                    photo: { contentType: 'image/png', _file_id: 'file-2' }
                }
            }),
            hydratedData: (body) => body.photo.data,
            expectedData: GRIDFS_DATA
        }
    ])('$name hands the replace builder a body read back from storage and leaves item.stored untouched', async ({ item: makeItem, hydratedData, expectedData }) => {
        const hydration = fakeHydration();
        const { adminBuilder, spies } = buildAdminBuilder(new PatientFilterManager(), hydration);
        let body;
        spies.replaceBuilder.mockImplementation(async ({ item: built }) => {
            body = deepcopy(built.incoming);
            return null;
        });
        const item = makeItem();
        const storedBefore = deepcopy(item.stored);

        const failure = await adminBuilder.buildAsync({ item, context: buildContext('POST') });

        expect(failure).toBeNull();
        expect(spies.replaceBuilder).toHaveBeenCalledTimes(1);
        expect(hydratedData(body)).toBe(expectedData);
        expect(hydration.databaseAttachmentManager.transformAttachments).toHaveBeenCalledTimes(1);
        expect(hydration.base64DataManager.transformAsync).toHaveBeenCalledTimes(1);
        expect(hydration.databaseAttachmentManager.transformAttachments.mock.calls[0][0]).not.toBe(item.stored);
        expect(item.stored).toStrictEqual(storedBefore);
    });

    test.each([
        {
            name: 'no owner tag',
            security: [{ system: ACCESS_SYSTEM, code: 'owner' }],
            expectedText: /is missing a security access tag/
        },
        {
            name: 'two owner tags',
            security: [
                { system: OWNER_SYSTEM, code: 'owner' },
                { system: OWNER_SYSTEM, code: 'other-owner' },
                { system: ACCESS_SYSTEM, code: 'owner' }
            ],
            expectedText: /multiple security access tag/
        }
    ])('a Person created from a Patient with $name fails its meta check at BUILD and builds nothing', async ({ security, expectedText }) => {
        const patient = { ...deepcopy(linkedPatient), meta: { ...deepcopy(linkedPatient.meta), security } };

        const result = await build(buildItem({
            kind: 'addLink',
            target: PERSON,
            linkTarget: PATIENT,
            storedDoc: null,
            linked: [{ resourceType: 'Patient', resource: patient }]
        }), undefined, UNSET_METHOD);

        expect(result.failure.stage).toBe(WRITE_FAILURE_STAGE.BUILD);
        expect(result.failure.error).toBeNull();
        expect(result.failure.operationOutcome.issue[0].code).toBe('invalid');
        expect(result.failure.operationOutcome.issue[0].details.text).toMatch(expectedText);
        expect(calledBuilders(result.spies)).toStrictEqual([]);
        expect(result.item.candidate).toBeNull();
        expect(result.context.requestInfo.method).toBe(UNSET_METHOD);
    });

    test('an unknown change kind fails the item with a 400 at BUILD and builds nothing', async () => {
        const result = await build(buildItem({
            kind: 'createPerson',
            target: PERSON,
            linkTarget: PATIENT,
            storedDoc: null,
            linked: [{ resourceType: 'Patient', resource: linkedPatient }]
        }));

        expect({
            stage: result.failure.stage,
            statusCode: result.failure.error.statusCode,
            issueCode: result.failure.error.issue[0].code,
            message: result.failure.error.message
        }).toStrictEqual({
            stage: WRITE_FAILURE_STAGE.BUILD,
            statusCode: 400,
            issueCode: 'invalid',
            message: 'Unsupported admin change: createPerson'
        });
        expect(calledBuilders(result.spies)).toStrictEqual([]);
        expect(result.item.candidate).toBeNull();
        expect(result.item.writeMode).toBeNull();
    });

    test.each([
        {
            name: 'removeLink by a plain id drops the link whose reference names it',
            linkTargetId: 'patient-1',
            links: [
                { target: storedPatientReference(OTHER_PATIENT_UUID) },
                { target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } }
            ],
            expectedLinks: [`Patient/${OTHER_PATIENT_UUID}`]
        },
        {
            name: 'removeLink by id|authority drops the link whose reference is that text',
            linkTargetId: 'patient-1|owner',
            links: [
                { target: { reference: 'Patient/patient-1|owner', _uuid: `Patient/${PATIENT_UUID}` } },
                { target: storedPatientReference(OTHER_PATIENT_UUID) }
            ],
            expectedLinks: [`Patient/${OTHER_PATIENT_UUID}`]
        },
        {
            name: 'removeLink by a _uuid drops the link whose _uuid names it, whatever its reference',
            linkTargetId: PATIENT_UUID,
            links: [
                { target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } },
                { target: storedPatientReference(OTHER_PATIENT_UUID) }
            ],
            expectedLinks: [`Patient/${OTHER_PATIENT_UUID}`]
        },
        {
            name: 'removeLink by a plain id drops every link whose reference names it',
            linkTargetId: 'patient-1',
            links: [
                { target: { reference: 'Patient/patient-1' } },
                { target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } },
                { target: storedPatientReference(OTHER_PATIENT_UUID) }
            ],
            expectedLinks: [`Patient/${OTHER_PATIENT_UUID}`]
        }
    ])('$name', async ({ linkTargetId, links, expectedLinks }) => {
        const result = await build(buildItem({
            kind: 'removeLink',
            target: PERSON,
            linkTarget: { resourceType: 'Patient', id: linkTargetId },
            storedDoc: storedPerson(links)
        }));

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual(['replaceBuilder']);
        expect(result.item.candidate.link.map((link) => link.target.reference)).toStrictEqual(expectedLinks);
        expect(result.item.stored).toStrictEqual(result.storedBefore);
    });

    test.each([
        {
            name: 'by a plain id, when the only link names the Patient by its _uuid in the reference',
            linkTargetId: 'patient-1',
            links: [{ target: storedPatientReference(PATIENT_UUID) }]
        },
        {
            name: 'by a plain id of another Patient',
            linkTargetId: 'patient-2',
            links: [{ target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } }]
        }
    ])('removeLink $name is a no-op that builds nothing', async ({ linkTargetId, links }) => {
        const result = await build(buildItem({
            kind: 'removeLink',
            target: PERSON,
            linkTarget: { resourceType: 'Patient', id: linkTargetId },
            storedDoc: storedPerson(links)
        }), undefined, UNSET_METHOD);

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual([]);
        expect(result.item.candidate).toBeNull();
        expect(result.context.requestInfo.method).toBe(UNSET_METHOD);
    });

    test.each([
        { name: 'a plain id', linkTargetId: 'patient-1' },
        { name: 'id|authority', linkTargetId: 'patient-1|owner' },
        { name: 'a _uuid', linkTargetId: PATIENT_UUID }
    ])('addLink by $name to a stored Person appends a link by the id as sent, with nothing loaded', async ({ linkTargetId }) => {
        const result = await build(buildItem({
            kind: 'addLink',
            target: PERSON,
            linkTarget: { resourceType: 'Patient', id: linkTargetId },
            storedDoc: storedPerson([{ target: storedPatientReference(OTHER_PATIENT_UUID) }])
        }));

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual(['smartMergeBuilder']);
        expect(result.item.candidate.link.map((link) => link.target.reference)).toStrictEqual([
            `Patient/${OTHER_PATIENT_UUID}`,
            `Patient/${linkTargetId}`
        ]);
    });

    test.each([
        {
            name: 'a plain id whose reference is stored as sent',
            linkTargetId: 'patient-1',
            links: [{ target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } }]
        },
        {
            name: 'a _uuid stored as the link _uuid under another reference',
            linkTargetId: PATIENT_UUID,
            links: [{ target: { reference: 'Patient/patient-1', _uuid: `Patient/${PATIENT_UUID}` } }]
        },
        {
            name: 'id|authority whose reference is stored as sent',
            linkTargetId: 'patient-1|owner',
            links: [{ target: { reference: 'Patient/patient-1|owner', _uuid: `Patient/${PATIENT_UUID}` } }]
        }
    ])('addLink by $name is a no-op that builds nothing', async ({ linkTargetId, links }) => {
        const result = await build(buildItem({
            kind: 'addLink',
            target: PERSON,
            linkTarget: { resourceType: 'Patient', id: linkTargetId },
            storedDoc: storedPerson(links)
        }), undefined, UNSET_METHOD);

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual([]);
        expect(result.item.candidate).toBeNull();
        expect(result.context.requestInfo.method).toBe(UNSET_METHOD);
    });

    test('addLink by a plain id appends a link when the stored link names the Patient only by its _uuid, as the old path does', async () => {
        const result = await build(buildItem({
            kind: 'addLink',
            target: PERSON,
            linkTarget: { resourceType: 'Patient', id: 'patient-1' },
            storedDoc: storedPerson([{ target: storedPatientReference(PATIENT_UUID) }])
        }));

        expect(result.failure).toBeNull();
        expect(result.item.candidate.link.map((link) => link.target.reference)).toStrictEqual([
            `Patient/${PATIENT_UUID}`,
            'Patient/patient-1'
        ]);
    });

    test('a Person created for a Patient sent by a plain id links the Patient by the id as sent and copies the loaded Patient\'s meta', async () => {
        const result = await build(buildItem({
            kind: 'addLink',
            target: { resourceType: 'Person', id: 'person-1' },
            linkTarget: { resourceType: 'Patient', id: 'patient-1' },
            storedDoc: null,
            linked: [{ resourceType: 'Patient', resource: linkedPatient }]
        }));

        expect(result.failure).toBeNull();
        expect(result.item.candidate.link).toStrictEqual([{ target: { reference: 'Patient/patient-1' } }]);
        expect(result.item.candidate.meta.source).toBe(SOURCE);
    });

    test('rewritePatientReference to a Patient sent by a plain id points the field at the loaded Patient\'s _uuid', async () => {
        const result = await build(buildItem({
            kind: 'rewritePatientReference',
            target: OBSERVATION,
            linkTarget: { resourceType: 'Patient', id: 'patient-1' },
            storedDoc: storedObservation(storedPatientReference(OLD_PATIENT_UUID)),
            linked: [{ resourceType: 'Patient', resource: linkedPatient }]
        }));

        expect(result.failure).toBeNull();
        expect(result.item.candidate.subject).toStrictEqual({ reference: `Patient/${PATIENT_UUID}` });
    });

    test('rewritePatientReference by a plain id is a no-op when the field already has the loaded Patient\'s _uuid', async () => {
        const result = await build(buildItem({
            kind: 'rewritePatientReference',
            target: OBSERVATION,
            linkTarget: { resourceType: 'Patient', id: 'patient-1' },
            storedDoc: storedObservation(storedPatientReference(PATIENT_UUID)),
            linked: [{ resourceType: 'Patient', resource: linkedPatient }]
        }), undefined, UNSET_METHOD);

        expect(result.failure).toBeNull();
        expect(calledBuilders(result.spies)).toStrictEqual([]);
        expect(result.item.candidate).toBeNull();
    });
});
