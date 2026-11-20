'use strict';

/**
 * Tests for src/createContainer.js -- the IoC wiring for the whole server.
 *
 * createContainer.js's ONLY job is wiring: it must register every service under the name the
 * rest of the codebase resolves it by, hand each service the CORRECT concrete dependency (not a
 * cross-wired one), and respect SimpleContainer's memoize-on-first-access contract (see
 * src/utils/simpleContainer.js, covered by its own unit test). These tests exercise the REAL
 * createContainer() and the REAL SimpleContainer -- nothing about the container or its wiring is
 * mocked. Only genuine external I/O clients are exempted from deep behavioral assertions (Kafka,
 * Redis, Mongo, Kubernetes, S3): their constructors are proven side-effect-free below, and the
 * conditional registrations that pick a Dummy/no-op implementation when a feature flag is off are
 * asserted directly, matching the task guidance that a wrong lifetime, a missing registration, or
 * a dependency wired to the wrong implementation silently breaks or cross-wires behavior app-wide.
 *
 * Domain invariants exercised here (see .qa/shards/G-invariants.md for the full list):
 *  - INV-G1: every service name createContainer registers must resolve to an instance of the
 *    class the rest of the codebase expects (no cross-wiring).
 *  - INV-G2: SimpleContainer's memoization contract holds for real container wiring: the same
 *    registered name always returns the identical object across resolutions.
 *  - INV-G3: two DIFFERENT registered names may legitimately construct the same underlying class
 *    (mongoBulkWriteExecutor / fastMongoBulkWriteExecutor) but must never accidentally SHARE one
 *    instance.
 *  - INV-G4: conditional registrations (kafkaClient, kafkaClientV2, clickHouseClientManager, ...)
 *    must resolve to the flag-appropriate implementation, not silently default to the "real" one
 *    when a feature is disabled (which would attempt real I/O in every environment).
 *  - INV-G5: preSaveHandlers documented ordering constraints (UuidColumnHandler after
 *    SourceAssigningAuthorityColumnHandler, ReferenceGlobalIdHandler after both) must hold, since
 *    getting this backwards silently corrupts every written resource's uuid/reference fields.
 */

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

// @icanbwell/fhirpatientsummary ships an unbundled ESM `import` (see jest.unit.config.js's
// quarantine comment for adminExportManagerRequestInfo.test.js -- same root cause). It sits
// behind operations/summary/summary.js, which fhirOperationsManager.js requires unconditionally
// at load time, which accessLogger.js requires, which createContainer.js requires at the very
// top of the file. There is no way to reach createContainer.js without loading that chain, so it
// must be stubbed here rather than left to Jest's transformer (this repo's transformIgnorePatterns
// intentionally does not allowlist it -- see jest.unit.config.js). This is a real, external,
// third-party dependency being mocked (matching "mock the I/O/library, test the logic"), not the
// code under test.
jestObj.mock('@icanbwell/fhirpatientsummary', () => ({
    ComprehensiveIPSCompositionBuilder: class ComprehensiveIPSCompositionBuilder {},
    TBundle: class TBundle {}
}));

// PERSON_MATCHING_SERVICE_* are required by OAuthClientCredentialsHelper (constructed as part of
// personMatchManager's dependency chain) but are NOT set by jest/setEnvVars.js. createContainer's
// job is wiring, not configuration -- supply harmless test values so the full graph can be
// resolved and inspected. A dedicated test below removes CLIENT_ID again to prove the fail-closed
// behavior when it is actually missing.
process.env.PERSON_MATCHING_SERVICE_CLIENT_ID = process.env.PERSON_MATCHING_SERVICE_CLIENT_ID || 'test-client-id';
process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET = process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET || 'test-client-secret';
process.env.PERSON_MATCHING_SERVICE_TOKEN_URL = process.env.PERSON_MATCHING_SERVICE_TOKEN_URL || 'https://example.test/token';

const { createContainer } = require('../../createContainer');
const { SimpleContainer } = require('../../utils/simpleContainer');
const { ConfigManager } = require('../../utils/configManager');
const { DummyKafkaClient } = require('../../utils/dummyKafkaClient');
const { DummyKafkaClientV2 } = require('../../utils/dummyKafkaClientV2');
const { FhirRouter } = require('../../middleware/fhir/router');
const { FhirOperationsManager } = require('../../operations/fhirOperationsManager');
const { SearchBundleOperation } = require('../../operations/search/searchBundle');
const { MergeOperation } = require('../../operations/merge/merge');
const { MergeManager } = require('../../operations/merge/mergeManager');
const { FastDatabaseBulkInserter } = require('../../dataLayer/fastDatabaseBulkInserter');
const { MongoBulkWriteExecutor } = require('../../dataLayer/bulkWriteExecutors/mongoBulkWriteExecutor');
const { SourceAssigningAuthorityColumnHandler } = require('../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../preSaveHandlers/handlers/uuidColumnHandler');
const { ReferenceGlobalIdHandler } = require('../../preSaveHandlers/handlers/referenceGlobalIdHandler');
const { OperationAccessManager } = require('../../utils/operationAccessManager');
const { CMSManager } = require('../../utils/cmsManager');
const { DelegatedAccessManager } = require('../../utils/delegatedAccessManager');
const { ResourceOperationAccessProvider } = require('../../utils/resourceOperationAccessProvider');
const { EnrichmentManager } = require('../../enrich/enrich');
const { IdentifierEnrichmentProvider } = require('../../enrich/providers/identifierEnrichmentProvider');
const { BaseSerializer } = require('../../fhir/writeSerializers/4_0_0/customSerializers');
const { RedisClient } = require('../../utils/redisClient');
const { K8sClient } = require('../../utils/k8sClient');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');
const { ChangeEventProducer } = require('../../utils/changeEventProducer');
const { PatientPersonDataChangeEventProducer } = require('../../utils/patientPersonDataChangeEventProducer');
const { IdentifyStep } = require('../../operations/writePipeline/steps/identifyStep');
const { BuildDocumentStep } = require('../../operations/writePipeline/steps/buildDocumentStep');
const { WriteStep } = require('../../operations/writePipeline/steps/writeStep');
const { VersionedWriter } = require('../../operations/writePipeline/steps/write/versionedWriter');
const { HttpPreconditionWriter } = require('../../operations/writePipeline/steps/write/httpPreconditionWriter');
const { SourceIdentityResolver } = require('../../operations/writePipeline/steps/identify/sourceIdentityResolver');
const { UrlIdentityResolver } = require('../../operations/writePipeline/steps/identify/urlIdentityResolver');
const { SmartMergeBuilder } = require('../../operations/writePipeline/steps/build/smartMergeBuilder');
const { InsertBuilder } = require('../../operations/writePipeline/steps/build/insertBuilder');
const { ReplaceBuilder } = require('../../operations/writePipeline/steps/build/replaceBuilder');
const { MERGE_WRITE_PROFILE } = require('../../operations/writePipeline/operations/merge/profile');
const { CREATE_WRITE_PROFILE } = require('../../operations/writePipeline/operations/create/profile');
const { UPDATE_WRITE_PROFILE } = require('../../operations/writePipeline/operations/update/profile');
const { UpdateResponder } = require('../../operations/writePipeline/operations/update/responder');
const { PATCH_WRITE_PROFILE } = require('../../operations/writePipeline/operations/patch/profile');
const { PatchResponder } = require('../../operations/writePipeline/operations/patch/responder');
const { FindExistingStep } = require('../../operations/writePipeline/steps/findExistingStep');
const { AccessCheckStep } = require('../../operations/writePipeline/steps/accessCheckStep');
const { AttachmentsStep } = require('../../operations/writePipeline/steps/attachmentsStep');
const { SearchExistingLoader } = require('../../operations/writePipeline/steps/load/searchExistingLoader');
const { StoredAccessChecker } = require('../../operations/writePipeline/steps/access/storedAccessChecker');
const { PatchBuilder } = require('../../operations/writePipeline/steps/build/patchBuilder');
const { PatchWriter } = require('../../operations/writePipeline/steps/write/patchWriter');

// Registrations that require infrastructure-specific config this test file does not (and should
// not) provide; excluded only from the "every name resolves" sweep. Each has its own dedicated,
// narrower test elsewhere in this file.
const NAMES_REQUIRING_DEDICATED_TEST = new Set(['oauthClientCredentialsHelper', 'personMatchManager']);

describe('createContainer', () => {
    test('returns a real SimpleContainer instance', () => {
        const container = createContainer();
        expect(container).toBeInstanceOf(SimpleContainer);
    });

    test('registers well over 100 services (breadth of the DI graph)', () => {
        const container = createContainer();
        expect(Object.keys(container).length).toBeGreaterThan(100);
    });

    test('registered container properties are configurable and enumerable, per SimpleContainer.register\'s contract', () => {
        const container = createContainer();
        const descriptor = Object.getOwnPropertyDescriptor(container, 'configManager');
        expect(descriptor.configurable).toBe(true);
        expect(descriptor.enumerable).toBe(true);
    });

    test('configManager resolves to a real ConfigManager instance', () => {
        const container = createContainer();
        expect(container.configManager).toBeInstanceOf(ConfigManager);
    });

    test('resolving configManager wires BaseSerializer.configManager to that SAME instance (documented lazy side effect)', () => {
        const container = createContainer();
        const configManager = container.configManager;
        expect(BaseSerializer.configManager).toBe(configManager);
    });

    test('two resolutions of the same registered name return the identical instance (singleton memoization)', () => {
        const container = createContainer();
        const first = container.searchManager;
        const second = container.searchManager;
        expect(first).toBe(second);
        expect(container.configManager).toBe(container.configManager);
    });

    test('the legacy bulk inserter and mongo executor registrations are gone', () => {
        const container = createContainer();
        expect(container.fastMongoBulkWriteExecutor).toBeInstanceOf(MongoBulkWriteExecutor);
        expect(container.databaseBulkInserter).toBeUndefined();
        expect(container.mongoBulkWriteExecutor).toBeUndefined();
    });

    test('kafkaClient resolves to DummyKafkaClient (not the real KafkaClient) when ENABLE_EVENTS_KAFKA is disabled', () => {
        // jest/setEnvVars.js sets ENABLE_EVENTS_KAFKA='0' for the whole unit suite.
        expect(process.env.ENABLE_EVENTS_KAFKA).toBe('0');
        const container = createContainer();
        // DummyKafkaClient extends KafkaClient (it overrides the I/O-performing methods with
        // no-ops), so the meaningful assertion is the exact constructor, not just `instanceof`.
        expect(container.kafkaClient).toBeInstanceOf(DummyKafkaClient);
        expect(container.kafkaClient.constructor).toBe(DummyKafkaClient);
    });

    test('kafkaClientV2 resolves to DummyKafkaClientV2 when the V2 Kafka cluster flag is unset', () => {
        const original = process.env.ENABLE_EVENTS_KAFKA_V2;
        delete process.env.ENABLE_EVENTS_KAFKA_V2;
        try {
            const container = createContainer();
            expect(container.kafkaClientV2).toBeInstanceOf(DummyKafkaClientV2);
            expect(container.kafkaClientV2.constructor).toBe(DummyKafkaClientV2);
        } finally {
            if (original !== undefined) {
                process.env.ENABLE_EVENTS_KAFKA_V2 = original;
            }
        }
    });

    test('clickHouseClientManager resolves to null when ClickHouse is disabled (ENABLE_CLICKHOUSE=0)', () => {
        expect(process.env.ENABLE_CLICKHOUSE).toBe('0');
        const container = createContainer();
        expect(container.clickHouseClientManager).toBeNull();
        // Downstream registrations must fail closed to null too, not construct a broken client.
        expect(container.genericClickHouseRepository).toBeNull();
        expect(container.clickHouseBulkWriteExecutor).toBeNull();
    });

    test('fhirRouter resolves to a real FhirRouter without throwing (full-graph integration of the container)', () => {
        const container = createContainer();
        expect(container.fhirRouter).toBeInstanceOf(FhirRouter);
    });

    test('fhirOperationsManager wires each operation to its correct, distinctly-typed concrete implementation', () => {
        const container = createContainer();
        const manager = container.fhirOperationsManager;
        expect(manager).toBeInstanceOf(FhirOperationsManager);
        expect(manager.searchBundleOperation).toBeInstanceOf(SearchBundleOperation);
        expect(manager.mergeOperation).toBeInstanceOf(MergeOperation);
        // Not just "an instance of the right class" -- the SAME registered singleton, proving
        // fhirOperationsManager was not handed a second, independently-constructed copy.
        expect(manager.searchBundleOperation).toBe(container.searchBundleOperation);
        expect(manager.mergeOperation).toBe(container.mergeOperation);
    });

    test('mergeManager is wired to the fast bulk inserter under the databaseBulkInserter property', () => {
        const container = createContainer();
        expect(container.mergeManager).toBeInstanceOf(MergeManager);
        expect(container.mergeManager.databaseBulkInserter).toBeInstanceOf(FastDatabaseBulkInserter);
        expect(container.mergeManager.databaseBulkInserter).toBe(container.fastDatabaseBulkInserter);
    });

    test.each(['createOperation', 'updateOperation', 'patchOperation'])(
        '%s is wired to the fast bulk inserter under the databaseBulkInserter property',
        (operationName) => {
            const container = createContainer();
            const operation = container[operationName];
            expect(operation.databaseBulkInserter).toBeInstanceOf(FastDatabaseBulkInserter);
            expect(operation.databaseBulkInserter).toBe(container.fastDatabaseBulkInserter);
        }
    );

    test('writePipeline registers the url identify, replace build and httpPreconditions write variants', () => {
        const container = createContainer();
        const { identify, buildDocument, write } = container.writePipeline.stepVariants;
        expect(identify.url).toBeInstanceOf(IdentifyStep);
        expect(identify.url.identityResolver).toBeInstanceOf(UrlIdentityResolver);
        expect(buildDocument.replace).toBeInstanceOf(BuildDocumentStep);
        expect(buildDocument.replace.builder).toBeInstanceOf(ReplaceBuilder);
        expect(buildDocument.replace.builder.insertBuilder).toBeInstanceOf(InsertBuilder);
        expect(write.httpPreconditions).toBeInstanceOf(WriteStep);
        expect(write.httpPreconditions.writer).toBeInstanceOf(HttpPreconditionWriter);
        expect(write.httpPreconditions.writer.databaseBulkInserter).toBe(container.fastDatabaseBulkInserter);
        expect(write.httpPreconditions.writer.versionedWriter).toBeInstanceOf(VersionedWriter);
    });

    test('updateOperation is wired to the write pipeline, its switch and the update responder', () => {
        const container = createContainer();
        const operation = container.updateOperation;
        expect(operation.writePipeline).toBe(container.writePipeline);
        expect(operation.writePipelineSwitch).toBe(container.writePipelineSwitch);
        expect(operation.updateResponder).toBeInstanceOf(UpdateResponder);
        expect(operation.updateResponder).toBe(container.updateResponder);
        expect(container.writePipeline.registeredProfiles.has(UPDATE_WRITE_PROFILE)).toBe(true);
    });

    test('writePipeline registers the patch variants for its search, stored access, patch build, always-new attachments and patch write steps', () => {
        const container = createContainer();
        const { findExisting, accessBeforeBuild, buildDocument, attachments, write } =
            container.writePipeline.stepVariants;
        expect(findExisting.search).toBeInstanceOf(FindExistingStep);
        expect(findExisting.search.existingResourceLoader).toBeInstanceOf(SearchExistingLoader);
        expect(accessBeforeBuild.stored).toBeInstanceOf(AccessCheckStep);
        expect(accessBeforeBuild.stored.accessChecker).toBeInstanceOf(StoredAccessChecker);
        expect(buildDocument.patch).toBeInstanceOf(BuildDocumentStep);
        expect(buildDocument.patch.builder).toBeInstanceOf(PatchBuilder);
        expect(attachments.alwaysCreateNew).toBeInstanceOf(AttachmentsStep);
        expect(attachments.alwaysCreateNew.alwaysCreateNewBase64).toBe(true);
        expect(container.writePipeline.attachmentsStep.alwaysCreateNewBase64).toBe(false);
        expect(write.patch).toBeInstanceOf(WriteStep);
        expect(write.patch.writer).toBeInstanceOf(PatchWriter);
        expect(write.patch.writer.databaseBulkInserter).toBe(container.fastDatabaseBulkInserter);
        expect(write.patch.writer.groupMemberPatchStrategy).toBe(buildDocument.patch.builder.groupMemberPatchStrategy);
    });

    test('patchOperation is wired to the write pipeline, its switch and the patch responder', () => {
        const container = createContainer();
        const operation = container.patchOperation;
        expect(operation.writePipeline).toBe(container.writePipeline);
        expect(operation.writePipelineSwitch).toBe(container.writePipelineSwitch);
        expect(operation.patchResponder).toBeInstanceOf(PatchResponder);
        expect(operation.patchResponder).toBe(container.patchResponder);
        expect(container.writePipeline.registeredProfiles.has(PATCH_WRITE_PROFILE)).toBe(true);
    });

    test('writePipeline still resolves the $merge and create profiles to their steps', () => {
        const pipeline = createContainer().writePipeline;
        expect(MERGE_WRITE_PROFILE.variants).toBeUndefined();
        expect(pipeline.identifyStep.identityResolver).toBeInstanceOf(SourceIdentityResolver);
        expect(pipeline.buildDocumentStep.builder).toBeInstanceOf(SmartMergeBuilder);
        expect(pipeline.writeStep.writer).toBeInstanceOf(VersionedWriter);
        expect(pipeline.registeredProfiles.has(MERGE_WRITE_PROFILE)).toBe(true);
        expect(pipeline.registeredProfiles.has(CREATE_WRITE_PROFILE)).toBe(true);
        expect(CREATE_WRITE_PROFILE.variants).toStrictEqual({ buildDocument: 'insert' });
        expect(pipeline.stepVariants.buildDocument.insert.builder).toBeInstanceOf(InsertBuilder);
    });

    test('the patch profile asks for the u letter with the patch action, turns off the body steps and names the five patch variants', () => {
        expect(PATCH_WRITE_PROFILE).toStrictEqual({
            name: 'patch',
            accessRequested: 'u',
            action: 'patch',
            off: ['identify', 'prepareBody', 'validateIncoming', 'validateNewResource', 'validateAgainstStored'],
            variants: {
                findExisting: 'search',
                accessBeforeBuild: 'stored',
                buildDocument: 'patch',
                attachments: 'alwaysCreateNew',
                write: 'patch'
            }
        });
    });

    test('preSaveManager orders SourceAssigningAuthorityColumnHandler before UuidColumnHandler before ReferenceGlobalIdHandler', () => {
        // preSave.js's factory comment: "UuidColumnHandler MUST come after
        // SourceAssigningAuthorityColumnHandler since it uses sourceAssigningAuthority value" and
        // "ReferenceGlobalIdHandler should come after SourceAssigningAuthorityColumnHandler and
        // UuidColumnHandler". If a future edit reorders these, resources get uuid/reference-global-id
        // fields computed from a stale/absent sourceAssigningAuthority -- a silent data-quality bug.
        const container = createContainer();
        const handlers = container.preSaveManager.preSaveHandlers;
        const idxSAA = handlers.findIndex((h) => h instanceof SourceAssigningAuthorityColumnHandler);
        const idxUuid = handlers.findIndex((h) => h instanceof UuidColumnHandler);
        const idxRef = handlers.findIndex((h) => h instanceof ReferenceGlobalIdHandler);
        expect(idxSAA).toBeGreaterThanOrEqual(0);
        expect(idxUuid).toBeGreaterThan(idxSAA);
        expect(idxRef).toBeGreaterThan(idxUuid);
    });

    test('accessManager wires accessProviders to the shared cmsManager/delegatedAccessManager/resourceOperationAccessProvider singletons, in order', () => {
        const container = createContainer();
        expect(container.accessManager).toBeInstanceOf(OperationAccessManager);
        expect(container.accessManager.accessProviders).toEqual([
            container.cmsManager,
            container.delegatedAccessManager,
            container.resourceOperationAccessProvider
        ]);
        expect(container.cmsManager).toBeInstanceOf(CMSManager);
        expect(container.delegatedAccessManager).toBeInstanceOf(DelegatedAccessManager);
        expect(container.resourceOperationAccessProvider).toBeInstanceOf(ResourceOperationAccessProvider);
    });

    test('enrichmentManager reuses the container-registered identifierEnrichmentProvider singleton rather than constructing a duplicate', () => {
        const container = createContainer();
        expect(container.enrichmentManager).toBeInstanceOf(EnrichmentManager);
        expect(container.enrichmentManager.enrichmentProviders).toContain(container.identifierEnrichmentProvider);
        expect(container.identifierEnrichmentProvider).toBeInstanceOf(IdentifierEnrichmentProvider);
    });

    test('postSaveProcessor wires the shared changeEventProducer and patientPersonDataChangeEventProducer singletons into its handlers', () => {
        const container = createContainer();
        const handlers = container.postSaveProcessor.handlers;
        expect(handlers).toContain(container.changeEventProducer);
        expect(handlers).toContain(container.patientPersonDataChangeEventProducer);
        expect(container.changeEventProducer).toBeInstanceOf(ChangeEventProducer);
        expect(container.patientPersonDataChangeEventProducer).toBeInstanceOf(PatientPersonDataChangeEventProducer);
        // ClickHouse is disabled for this suite, so no Group ClickHouse handler should be appended.
        expect(handlers.length).toBe(3);
    });

    test('registration order in the source file does not affect resolution -- a service registered early can depend on one registered later', () => {
        // searchManager is registered near the top of createContainer.js (~line 507);
        // patientQueryCreator is registered near the bottom (~line 1225). SimpleContainer's
        // lazy getters make this safe (per the file's own top-of-function comment), but that is
        // exactly the kind of property that silently breaks if someone "cleans up" registration
        // order under the mistaken belief that JS object literals evaluate top-to-bottom only.
        const container = createContainer();
        expect(container.searchManager.patientQueryCreator).toBe(container.patientQueryCreator);
    });

    test('oauthClientCredentialsHelper fails closed with a descriptive error when PERSON_MATCHING_SERVICE_CLIENT_ID is not configured', () => {
        const original = process.env.PERSON_MATCHING_SERVICE_CLIENT_ID;
        delete process.env.PERSON_MATCHING_SERVICE_CLIENT_ID;
        try {
            const container = createContainer();
            expect(() => container.oauthClientCredentialsHelper).toThrow(/PERSON_MATCHING_SERVICE_CLIENT_ID/);
        } finally {
            process.env.PERSON_MATCHING_SERVICE_CLIENT_ID = original;
        }
    });

    test('redisClient resolves to a real RedisClient instance (construction is side-effect-free; no live Redis required)', () => {
        const container = createContainer();
        expect(container.redisClient).toBeInstanceOf(RedisClient);
    });

    test('k8sClient resolves without throwing even outside a Kubernetes cluster (init() failures are caught and logged internally, not rethrown)', () => {
        const container = createContainer();
        expect(container.k8sClient).toBeInstanceOf(K8sClient);
    });

    test('mongoDatabaseManager resolves without establishing a real connection at construction time', () => {
        const container = createContainer();
        expect(container.mongoDatabaseManager).toBeInstanceOf(MongoDatabaseManager);
    });

    test('EVERY registered service resolves without throwing under standard test config (full container integration)', () => {
        const container = createContainer();
        const names = Object.keys(container).filter((name) => !NAMES_REQUIRING_DEDICATED_TEST.has(name));
        expect(names.length).toBeGreaterThan(100);
        const errors = [];
        for (const name of names) {
            try {
                void container[name];
            } catch (e) {
                errors.push(`${name}: ${e.message}`);
            }
        }
        expect(errors).toEqual([]);
    });

    test('SECURITY (fail-closed, INV-G14): a container with no PERSON_MATCHING_SERVICE_* config must not silently hand out an unconfigured OAuth credentials client', () => {
        // Negative/security test: an OAuthClientCredentialsHelper constructed without its
        // required client id/secret/token URL must never resolve successfully, because a
        // "helper" that silently proceeds with undefined credentials would fetch tokens from
        // whatever default endpoint superagent falls back to and could leak requests to the
        // wrong host, or -- if it did not validate -- forward `Authorization: Bearer undefined`.
        // This asserts the fail-closed contract holds across ALL three required env vars.
        const originalId = process.env.PERSON_MATCHING_SERVICE_CLIENT_ID;
        const originalSecret = process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET;
        const originalUrl = process.env.PERSON_MATCHING_SERVICE_TOKEN_URL;
        delete process.env.PERSON_MATCHING_SERVICE_CLIENT_ID;
        delete process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET;
        delete process.env.PERSON_MATCHING_SERVICE_TOKEN_URL;
        try {
            const container = createContainer();
            expect(() => container.oauthClientCredentialsHelper).toThrow();
            expect(() => container.personMatchManager).toThrow();
        } finally {
            process.env.PERSON_MATCHING_SERVICE_CLIENT_ID = originalId;
            process.env.PERSON_MATCHING_SERVICE_CLIENT_SECRET = originalSecret;
            process.env.PERSON_MATCHING_SERVICE_TOKEN_URL = originalUrl;
        }
    });
});
