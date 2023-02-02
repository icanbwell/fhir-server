const {getHash} = require('../../../../utils/uid.util');
const {MergeOperation} = require('../../../../operations/merge/merge');
const {assertTypeEquals} = require('../../../../utils/assertType');
const {SimpleContainer} = require('../../../../utils/simpleContainer');
const {R4ArgsParser} = require('../../../../operations/query/r4ArgsParser');

function mapParticipants(members) {
    const result = [];
    members.forEach((m) => {
        result.push({
            id: m.id,
            role: m.role,
            member: {reference: m.member},
            onBehalfOf: {reference: m.onBehalfOf},
            period: m.period,
        });
    });
    return result;
}

function mapManagingOrganization(organizations) {
    const result = [];
    organizations.forEach((org) => {
        result.push({
            reference: org,
        });
    });

    return result;
}

function mapCareTeam(team) {
    const careTeamMap = {
        resourceType: 'CareTeam',
        id: team.id,
        meta: team.meta,
        implicitRules: team.implicitRules,
        language: team.language,
        text: team.text,
        identifier: team.identifier,
        status: team.code,
        category: team.category,
        name: team.name,
        subject: {reference: team.subject},
        encounter: {reference: team.encounter},
        period: team.period,
        participant: mapParticipants(team.participant),
        reasonCode: team.reasonCode,
        reasonReference: team.reasonReference,
        telecom: team.telecom,
        note: team.note,
    };

    if (team.contained) {
        careTeamMap.contained = [team.contained];
    }

    if (team.managingOrganization) {
        careTeamMap.managingOrganization = mapManagingOrganization(team.managingOrganization);
    }

    return careTeamMap;
}

module.exports = {
    Mutation: {
        updatePreferredProviders:
            /**
             * @param {Resource|null} parent
             * @param {Object} args
             * @param {GraphQLContext} context
             * @param {Object} info
             * @return {Promise<Resource>}
             */
            async (parent, args, context, info) => {
                /**
                 * @type {SimpleContainer}
                 */
                const container = context.container;
                assertTypeEquals(container, SimpleContainer);
                const patients = await context.dataApi.getResources(
                    parent,
                    {
                        ...args,
                        id: args.patientId,
                    },
                    context,
                    info,
                    'Patient'
                );
                if (patients.length === 0) {
                    throw new Error(`Patient not found ${args.patientId}`);
                }
                const patientToChange = patients[0];
                // create care team
                const careTeam = mapCareTeam(args.team);
                if (!careTeam.id) {
                    careTeam.id = getHash(careTeam);
                }
                /**
                 * @type {FhirRequestInfo}
                 */
                const requestInfo = context.fhirRequestInfo;
                requestInfo.body = [careTeam];
                /**
                 * @type {MergeOperation}
                 */
                const mergeOperation = container.mergeOperation;
                assertTypeEquals(mergeOperation, MergeOperation);
                /**
                 * @type {R4ArgsParser}
                 */
                const r4ArgsParser = container.r4ArgsParser;
                assertTypeEquals(r4ArgsParser, R4ArgsParser);
                const resourceType = 'CareTeam';
                const result = await mergeOperation.merge(
                    {
                        requestInfo,
                        parsedArgs: r4ArgsParser.parseArgs({
                            resourceType: resourceType,
                            args: {...args, base_version: '4_0_0'}
                        }),
                        resourceType: resourceType
                    }
                );
                if (result && result[0].operationOutcome) {
                    throw new Error(`Unable to update care team data for ${args.patientId}`);
                }
                return patientToChange;
            },
    },
};
