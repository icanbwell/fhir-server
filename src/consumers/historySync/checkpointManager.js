const { generateUUIDv5, generateUUID } = require('../../utils/uid.util');
const { FhirRequestInfo } = require('../../utils/fhirRequestInfo');
const { logInfo, logError } = require('../../operations/common/logging');

const CHECKPOINT_SOURCE = 'https://www.icanbwell.com/fhir-history-sync-consumer';
const CHECKPOINT_CODE_SYSTEM = 'https://www.icanbwell.com/task-type';
const CHECKPOINT_CODE = 'fhirHistorySync';
const SOURCE_ASSIGNING_AUTHORITY = 'bwell';

class CheckpointManager {
    /**
     * @param {Object} params
     * @param {import('../../operations/merge/merge').MergeOperation} params.mergeOperation
     * @param {import('../../operations/query/r4ArgsParser').R4ArgsParser} params.r4ArgsParser
     * @param {import('../../utils/mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     */
    constructor({ mergeOperation, r4ArgsParser, mongoDatabaseManager }) {
        this.mergeOperation = mergeOperation;
        this.r4ArgsParser = r4ArgsParser;
        this.mongoDatabaseManager = mongoDatabaseManager;
    }

    /**
     * Generates deterministic Task ID for a resource type checkpoint
     * @param {string} resourceType
     * @returns {string}
     */
    getTaskId(resourceType) {
        return generateUUIDv5(`${resourceType}|${CHECKPOINT_CODE}`);
    }

    /**
     * Gets the last checkpoint for a resource type
     * @param {string} resourceType
     * @returns {Promise<{lastMongoId: string, lastUpdated: string}|null>}
     */
    async getCheckpointAsync(resourceType) {
        const taskId = this.getTaskId(resourceType);
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection('Task_4_0_0');
        const taskDoc = await collection.findOne({ id: taskId });

        if (!taskDoc || !taskDoc.resource) {
            return null;
        }

        const input = taskDoc.resource.input || [];
        const lastMongoId = input.find(i => i.type?.text === 'lastMongoId')?.valueString;
        const lastUpdated = input.find(i => i.type?.text === 'lastUpdated')?.valueDateTime;

        if (!lastMongoId) {
            return null;
        }

        return { lastMongoId, lastUpdated };
    }

    /**
     * Updates the checkpoint for a resource type via FHIR $merge
     * @param {string} resourceType
     * @param {string} lastMongoId
     * @param {string} lastUpdated
     * @returns {Promise<void>}
     */
    async updateCheckpointAsync(resourceType, lastMongoId, lastUpdated) {
        const taskId = this.getTaskId(resourceType);

        const taskResource = {
            resourceType: 'Task',
            id: taskId,
            meta: {
                source: CHECKPOINT_SOURCE,
                security: [
                    {
                        system: 'https://www.icanbwell.com/owner',
                        code: SOURCE_ASSIGNING_AUTHORITY
                    },
                    {
                        system: 'https://www.icanbwell.com/sourceAssigningAuthority',
                        code: SOURCE_ASSIGNING_AUTHORITY
                    }
                ]
            },
            status: 'in-progress',
            intent: 'order',
            code: {
                coding: [
                    {
                        system: CHECKPOINT_CODE_SYSTEM,
                        code: CHECKPOINT_CODE
                    }
                ]
            },
            input: [
                {
                    type: { text: 'resourceType' },
                    valueString: resourceType
                },
                {
                    type: { text: 'lastMongoId' },
                    valueString: lastMongoId
                },
                {
                    type: { text: 'lastUpdated' },
                    valueDateTime: lastUpdated
                }
            ]
        };

        const requestInfo = new FhirRequestInfo({
            user: CHECKPOINT_CODE,
            scope: 'user/*.* access/*.*',
            protocol: 'http',
            originalUrl: '/4_0_0/Task/$merge',
            requestId: generateUUID(),
            userRequestId: generateUUID(),
            host: 'localhost',
            headers: {},
            method: 'POST',
            contentTypeFromHeader: null
        });
        requestInfo.body = [taskResource];

        const parsedArgs = this.r4ArgsParser.parseArgs({
            resourceType: 'Task',
            args: { base_version: '4_0_0' }
        });

        const results = await this.mergeOperation.mergeAsync({
            requestInfo,
            parsedArgs,
            resourceType: 'Task'
        });

        const result = Array.isArray(results) ? results[0] : results;
        if (result?.operationOutcome) {
            const diagnostics = result.operationOutcome.issue?.[0]?.diagnostics;
            logError('CheckpointManager: merge failed', {
                args: { resourceType, taskId, diagnostics }
            });
            throw new Error(`Checkpoint merge failed for ${resourceType}: ${diagnostics}`);
        }

        logInfo('CheckpointManager: checkpoint updated', {
            args: { resourceType, taskId, lastMongoId }
        });
    }
}

module.exports = { CheckpointManager };
