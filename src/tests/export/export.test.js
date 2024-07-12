// test file
const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const person1Resource = require('./fixtures/person/person1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const env = require('var');
const { BulkDataExportRunner } = require('../../operations/export/script/bulkDataExportRunner');
const { MockK8sClient } = require('./mocks/k8sClient');
const { MockS3Client } = require('./mocks/s3Client');
const { MongoDatabaseManager } = require('../../utils/mongoDatabaseManager');

describe('Export Tests', () => {
    beforeEach(async () => {
        env.ENABLE_BULK_EXPORT = '1';
        const container = getTestContainer();
        if (container) {
            delete container.services.bulkDataExportRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        env.ENABLE_BULK_EXPORT = '0';
        await commonAfterEach();
    });

    describe('Export tests', () => {
        test('Export triggering for Patient works', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                patientQueryCreator: c.patientQueryCreator,
                enrichmentManager: c.enrichmentManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4ArgsParser: c.r4ArgsParser,
                searchManager: c.searchManager,
                exportStatusId,
                patientReferenceBatchSize: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(1);
            expect(resp.body.output[0].type).toEqual('Patient');

            const urlParts = resp.body.output[0].url.split('/');
            expect(urlParts.pop()).toEqual('Patient.ndjson');
            urlParts.pop();
            expect(urlParts.pop()).toEqual('bwell');

            expect(resp.body.errors).toHaveLength(0);
        });

        test('S3 path is constructed by concatenating access tags', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .set(getHeaders('user/Patient.* access/client.* access/client1.*'))
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                patientQueryCreator: c.patientQueryCreator,
                enrichmentManager: c.enrichmentManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4ArgsParser: c.r4ArgsParser,
                searchManager: c.searchManager,
                exportStatusId,
                patientReferenceBatchSize: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(1);
            expect(resp.body.output[0].type).toEqual('Patient');

            const urlParts = resp.body.output[0].url.split('/');
            expect(urlParts.pop()).toEqual('Patient.ndjson');
            urlParts.pop();
            expect(urlParts.pop()).toEqual('client_client1');

            expect(resp.body.errors).toHaveLength(0);
        });

        test('Export triggering all resources works only for resources present in db', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export')
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                patientQueryCreator: c.patientQueryCreator,
                enrichmentManager: c.enrichmentManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4ArgsParser: c.r4ArgsParser,
                searchManager: c.searchManager,
                exportStatusId,
                patientReferenceBatchSize: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(140);
            expect(resp.body.errors).toHaveLength(0);
        });

        test('Export triggering for resource without access doesn\'t work', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .set(getHeaders('access/*.* user/Person.*'))
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                patientQueryCreator: c.patientQueryCreator,
                enrichmentManager: c.enrichmentManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4ArgsParser: c.r4ArgsParser,
                searchManager: c.searchManager,
                exportStatusId,
                patientReferenceBatchSize: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(0);
            expect(resp.body.errors).toHaveLength(1);
            expect(resp.body.errors[0].type).toEqual('OperationOutcome');
            expect(resp.body.errors[0].url.split('/').pop()).toEqual('OperationOutcome.ndjson');
        });

        test('Export triggering for AuditEvent resource doesn\'t work even with access', async () => {
            const request = await createTestRequest((c) => {
                c.register('k8sClient', (c) => new MockK8sClient({
                    configManager: c.configManager
                }));
                return c;
            });

            let resp = await request
                .post('/4_0_0/$export?_type=AuditEvent')
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed
            const container = getTestContainer();

            container.register('bulkDataExportRunner', (c) => new BulkDataExportRunner({
                databaseQueryFactory: c.databaseQueryFactory,
                databaseExportManager: c.databaseExportManager,
                patientFilterManager: c.patientFilterManager,
                databaseAttachmentManager: c.databaseAttachmentManager,
                r4SearchQueryCreator: c.r4SearchQueryCreator,
                patientQueryCreator: c.patientQueryCreator,
                enrichmentManager: c.enrichmentManager,
                resourceLocatorFactory: c.resourceLocatorFactory,
                r4ArgsParser: c.r4ArgsParser,
                searchManager: c.searchManager,
                exportStatusId,
                patientReferenceBatchSize: 1000,
                uploadPartSize: 1024 * 1024,
                s3Client: new MockS3Client({
                    bucketName: 'test',
                    region: 'test'
                })
            }));

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(0);
            expect(resp.body.errors).toHaveLength(1);
            expect(resp.body.errors[0].type).toEqual('OperationOutcome');
            expect(resp.body.errors[0].url.split('/').pop()).toEqual('OperationOutcome.ndjson');
        });

        test('Export triggering for Patient works with access scopes from JWT', async () => {
            const request = await createTestRequest((c) => {
                c.register(
                    'k8sClient',
                    (c) =>
                        new MockK8sClient({
                            configManager: c.configManager
                        })
                );
                return c;
            });
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collection = fhirDb.collection('ExportStatus_4_0_0');

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .set(getHeaders('access/client.* access/client1.* user/*.*'))
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            const exportStatusResource = await collection.find({}).toArray();
            expect(exportStatusResource[0].meta.security).toEqual([
                { code: 'bwell', system: 'https://www.icanbwell.com/owner' },
                { code: 'client', system: 'https://www.icanbwell.com/access' },
                { code: 'client1', system: 'https://www.icanbwell.com/access' },
                { code: 'bwell', system: 'https://www.icanbwell.com/sourceAssigningAuthority' }
            ]);

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed

            container.register(
                'bulkDataExportRunner',
                (c) =>
                    new BulkDataExportRunner({
                        databaseQueryFactory: c.databaseQueryFactory,
                        databaseExportManager: c.databaseExportManager,
                        patientFilterManager: c.patientFilterManager,
                        databaseAttachmentManager: c.databaseAttachmentManager,
                        r4SearchQueryCreator: c.r4SearchQueryCreator,
                        patientQueryCreator: c.patientQueryCreator,
                        enrichmentManager: c.enrichmentManager,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        r4ArgsParser: c.r4ArgsParser,
                        searchManager: c.searchManager,
                        exportStatusId,
                        patientReferenceBatchSize: 1000,
                        uploadPartSize: 1024 * 1024,
                        s3Client: new MockS3Client({
                            bucketName: 'test',
                            region: 'test'
                        })
                    })
            );

            const mockProcessResourceAsync = jest.spyOn(container.bulkDataExportRunner, 'processResourceAsync');

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Verifying processResourceAsync is called correct number of times with proper query and resource
            expect(mockProcessResourceAsync).toHaveBeenCalledTimes(1);
            expect(mockProcessResourceAsync).toHaveBeenCalledWith({
                query: {
                    $and: [
                        {
                            'meta.tag': {
                                $not: {
                                    $elemMatch: {
                                        system: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior',
                                        code: 'hidden'
                                    }
                                }
                            }
                        },
                        {
                            'meta.security': {
                                $elemMatch: {
                                    system: 'https://www.icanbwell.com/access',
                                    code: { $in: ['client', 'client1'] }
                                }
                            }
                        }
                    ]
                },
                resourceType: 'Patient'
            });

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(1);
            expect(resp.body.output[0].type).toEqual('Patient');
            expect(resp.body.output[0].url.split('/').pop()).toEqual('Patient.ndjson');

            expect(resp.body.errors).toHaveLength(0);
        });

        test('Export triggering for Patient takes only read access scopes from JWT', async () => {
            const request = await createTestRequest((c) => {
                c.register(
                    'k8sClient',
                    (c) =>
                        new MockK8sClient({
                            configManager: c.configManager
                        })
                );
                return c;
            });
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collection = fhirDb.collection('ExportStatus_4_0_0');

            let resp = await request
                .post('/4_0_0/$export?_type=Patient')
                .set(getHeaders('access/client.* access/client1.write access/client2.read user/*.*'))
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            const exportStatusResource = await collection.find({}).toArray();
            expect(exportStatusResource[0].meta.security).toEqual([
                { code: 'bwell', system: 'https://www.icanbwell.com/owner' },
                { code: 'client', system: 'https://www.icanbwell.com/access' },
                { code: 'client2', system: 'https://www.icanbwell.com/access' },
                { code: 'bwell', system: 'https://www.icanbwell.com/sourceAssigningAuthority' }
            ]);

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed

            container.register(
                'bulkDataExportRunner',
                (c) =>
                    new BulkDataExportRunner({
                        databaseQueryFactory: c.databaseQueryFactory,
                        databaseExportManager: c.databaseExportManager,
                        patientFilterManager: c.patientFilterManager,
                        databaseAttachmentManager: c.databaseAttachmentManager,
                        r4SearchQueryCreator: c.r4SearchQueryCreator,
                        patientQueryCreator: c.patientQueryCreator,
                        enrichmentManager: c.enrichmentManager,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        r4ArgsParser: c.r4ArgsParser,
                        searchManager: c.searchManager,
                        exportStatusId,
                        patientReferenceBatchSize: 1000,
                        uploadPartSize: 1024 * 1024,
                        s3Client: new MockS3Client({
                            bucketName: 'test',
                            region: 'test'
                        })
                    })
            );

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(1);
            expect(resp.body.output[0].type).toEqual('Patient');
            expect(resp.body.output[0].url.split('/').pop()).toEqual('Patient.ndjson');

            expect(resp.body.errors).toHaveLength(0);
        });

        test('Export triggering work with all available query params', async () => {
            const request = await createTestRequest((c) => {
                c.register(
                    'k8sClient',
                    (c) =>
                        new MockK8sClient({
                            configManager: c.configManager
                        })
                );
                return c;
            });
            const container = getTestContainer();
            const mockK8sCreateJob = jest.spyOn(container.k8sClient, 'createJob');

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collection = fhirDb.collection('ExportStatus_4_0_0');

            let resp = await request
                .post(
                    `/4_0_0/$export?_type=Patient,Person&_since=2023-10-10&patient=patient/1,2&_includeHidden=1&` +
                    `loglevel=debug&requestsMemory=3&ttlsecondsAfterFinished=5&patientReferenceBatchSize=20&` +
                    `fetchResourceBatchSize=30&uploadPartSize=40&ram=2G`
                )
                .set(getHeaders('access/client.* access/client1.* user/*.*'))
                .expect(202);

            expect(resp.headers['content-location']).toBeDefined();
            const exportStatusId = resp.headers['content-location'].split('/').pop();

            const exportStatusResource = await collection.find({}).toArray();
            expect(exportStatusResource[0].meta.security).toEqual([
                { code: 'bwell', system: 'https://www.icanbwell.com/owner' },
                { code: 'client', system: 'https://www.icanbwell.com/access' },
                { code: 'client1', system: 'https://www.icanbwell.com/access' },
                { code: 'bwell', system: 'https://www.icanbwell.com/sourceAssigningAuthority' }
            ]);

            // Check if extension is created as expected
            expect(exportStatusResource[0].extension).toEqual([
                {
                    id: '_includeHidden',
                    url: 'https://icanbwell.com/codes/_includeHidden',
                    valueString: '1'
                },
                { id: 'loglevel', url: 'https://icanbwell.com/codes/loglevel', valueString: 'debug' },
                {
                    id: 'requestsMemory',
                    url: 'https://icanbwell.com/codes/requestsMemory',
                    valueString: '3'
                },
                {
                    id: 'ttlsecondsAfterFinished',
                    url: 'https://icanbwell.com/codes/ttlsecondsAfterFinished',
                    valueString: '5'
                },
                {
                    id: 'patientReferenceBatchSize',
                    url: 'https://icanbwell.com/codes/patientReferenceBatchSize',
                    valueString: '20'
                },
                {
                    id: 'fetchResourceBatchSize',
                    url: 'https://icanbwell.com/codes/fetchResourceBatchSize',
                    valueString: '30'
                },
                {
                    id: 'uploadPartSize',
                    url: 'https://icanbwell.com/codes/uploadPartSize',
                    valueString: '40'
                },
                { id: 'ram', url: 'https://icanbwell.com/codes/ram', valueString: '2G' }
            ])

            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(202);

            expect(resp.headers['x-progress']).toEqual('accepted');

            // create patients to export
            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            // Update the status of ExportStatus resource to completed

            container.register(
                'bulkDataExportRunner',
                (c) =>
                    new BulkDataExportRunner({
                        databaseQueryFactory: c.databaseQueryFactory,
                        databaseExportManager: c.databaseExportManager,
                        patientFilterManager: c.patientFilterManager,
                        databaseAttachmentManager: c.databaseAttachmentManager,
                        r4SearchQueryCreator: c.r4SearchQueryCreator,
                        patientQueryCreator: c.patientQueryCreator,
                        enrichmentManager: c.enrichmentManager,
                        resourceLocatorFactory: c.resourceLocatorFactory,
                        r4ArgsParser: c.r4ArgsParser,
                        searchManager: c.searchManager,
                        exportStatusId,
                        patientReferenceBatchSize: 1000,
                        uploadPartSize: 1024 * 1024,
                        s3Client: new MockS3Client({
                            bucketName: 'test',
                            region: 'test'
                        })
                    })
            );

            const mockProcessResourceAsync = jest.spyOn(
                container.bulkDataExportRunner,
                'processResourceAsync'
            );

            const bulkDataExportRunner = container.bulkDataExportRunner;

            await bulkDataExportRunner.processAsync();

            // Verifying processResourceAsync is called correct number of times with proper query and resource
            expect(mockProcessResourceAsync).toHaveBeenCalledTimes(2);
            expect(mockProcessResourceAsync.mock.calls).toEqual([
                [
                    {
                        query: {
                            $and: [
                                {
                                    'meta.security': {
                                        $elemMatch: {
                                            system: 'https://www.icanbwell.com/access',
                                            code: { $in: ['client', 'client1'] }
                                        }
                                    }
                                },
                                {
                                    'meta.lastUpdated': {
                                        $gte: new Date('2023-10-10T00:00:00.000Z')
                                    }
                                }
                            ]
                        },
                        resourceType: 'Patient'
                    }
                ],
                [
                    {
                        query: {
                            $and: [
                                {
                                    'meta.security': {
                                        $elemMatch: {
                                            system: 'https://www.icanbwell.com/access',
                                            code: { $in: ['client', 'client1'] }
                                        }
                                    }
                                },
                                {
                                    'meta.lastUpdated': {
                                        $gte: new Date('2023-10-10T00:00:00.000Z')
                                    }
                                }
                            ]
                        },
                        resourceType: 'Person'
                    }
                ]
            ]);

            // Query again to check the status
            resp = await request
                .get(`/4_0_0/$export/${exportStatusId}`)
                .set(getHeaders())
                .expect(200);

            expect(resp.body.output).toHaveLength(2);
            expect(resp.body.output[0].type).toEqual('Patient');
            expect(resp.body.output[0].url.split('/').pop()).toEqual('Patient.ndjson');
            expect(resp.body.output[1].type).toEqual('Person');
            expect(resp.body.output[1].url.split('/').pop()).toEqual('Person.ndjson');

            expect(resp.body.errors).toHaveLength(0);

            // extension present in exportStatus resource is not fetched in body when fetched with non-admin endpoint
            expect(resp.body.extension).toEqual(undefined);

            // Check if 'createJob' function is called and with correct params
            expect(mockK8sCreateJob).toHaveBeenCalledTimes(1);
            expect(mockK8sCreateJob).toHaveBeenCalledWith(
                expect.objectContaining({
                    scriptCommand: expect.stringContaining(
                        '--patientReferenceBatchSize 20 --fetchResourceBatchSize 30 --uploadPartSize 40'
                    )
                })
            );
        });
    });
});
