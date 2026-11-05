const { describe, test, expect, jest } = require('@jest/globals');

const careTeamResolvers = require('../../../../../graphql/resolvers/custom/careTeam');
const { MergeOperation } = require('../../../../../operations/merge/merge');
const { R4ArgsParser } = require('../../../../../operations/query/r4ArgsParser');
const { SimpleContainer } = require('../../../../../utils/simpleContainer');
const { BadRequestError } = require('../../../../../utils/httpErrors');

describe('graphql/resolvers/custom/careTeam', () => {
    describe('Mutation.updatePreferredProviders merge result', () => {
        test.each([
            [
                'an issue',
                { issue: { severity: 'error', code: 'conflict', diagnostics: 'modified concurrently' } },
                'modified concurrently'
            ],
            [
                'an operationOutcome',
                { operationOutcome: { resourceType: 'OperationOutcome', issue: [{ code: 'forbidden', diagnostics: 'no access' }] } },
                'no access'
            ]
        ])('throws BadRequestError when the merge result carries %s', async (_label, mergeResult, diagnostics) => {
            const container = Object.create(SimpleContainer.prototype);
            container.mergeOperation = Object.create(MergeOperation.prototype);
            container.mergeOperation.mergeAsync = jest.fn().mockResolvedValue([mergeResult]);
            container.r4ArgsParser = Object.create(R4ArgsParser.prototype);
            container.r4ArgsParser.parseArgs = jest.fn().mockReturnValue({});
            const context = {
                container,
                fhirRequestInfo: { body: null },
                dataApi: {
                    getResourcesForMutation: jest.fn().mockResolvedValue([{ resourceType: 'Patient', id: 'p1' }])
                }
            };
            const args = {
                patientId: 'p1',
                team: { id: 'ct-1', subject: 'Patient/p1', participant: [] }
            };

            const promise = careTeamResolvers.Mutation.updatePreferredProviders(null, args, context, { fieldName: 'test' });

            await expect(promise).rejects.toThrow(BadRequestError);
            await expect(promise).rejects.toThrow(`Unable to update care team data for p1: ${diagnostics}`);
        });
    });
});
