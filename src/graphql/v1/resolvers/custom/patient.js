const {getResources} = require('../../common');
const {RemoveOperation} = require('../../../../operations/remove/remove');
const {MergeOperation} = require('../../../../operations/merge/merge');
const {getRequestInfo} = require('../../requestInfoHelper');
const {assertTypeEquals} = require('../../../../utils/assertType');
const {SimpleContainer} = require('../../../../utils/simpleContainer');
const {R4ArgsParser} = require('../../../../operations/query/r4ArgsParser');

/**
 method to match general practitioners to an id and remove from the provided list
 @param {array} arr the list of practitioners to inspect
 @param {string} id the id to remove from the list
 @returns {array} the collection of ids after processing
 */
function removeAllGeneralPractitioner(arr, id) {
    let i = 0;
    if (arr && id) {
        while (i < arr.length) {
            // eslint-disable-next-line security/detect-object-injection
            if (arr[i].reference.indexOf(id, id.length - arr[i].reference.length) !== -1) {
                arr.splice(i, 1);
            } else {
                ++i;
            }
        }
    }
    return arr;
}

module.exports = {
    Patient: {
        // eslint-disable-next-line no-unused-vars
        explanationOfBenefit: async (parent, args, context, info) => {
            return await getResources(
                parent,
                {
                    ...args,
                    patient: parent.id,
                },
                context,
                info,
                'ExplanationOfBenefit'
            );
        },
        // eslint-disable-next-line no-unused-vars
        allergyIntolerance: async (parent, args, context, info) => {
            return await getResources(
                parent,
                {
                    ...args,
                    patient: parent.id,
                },
                context,
                info,
                'AllergyIntolerance'
            );
        },
        // eslint-disable-next-line no-unused-vars
        condition: async (parent, args, context, info) => {
            return await getResources(
                parent,
                {
                    ...args,
                    patient: parent.id,
                },
                context,
                info,
                'Condition'
            );
        },
        // eslint-disable-next-line no-unused-vars
        carePlan: async (parent, args, context, info) => {
            return await getResources(
                parent,
                {
                    ...args,
                    patient: parent.id,
                },
                context,
                info,
                'CarePlan'
            );
        },
        careTeam: async (parent, args, context, info) => {
            return await getResources(
                parent,
                {
                    ...args,
                    patient: parent.id,
                },
                context,
                info,
                'CareTeam'
            );
        },
    },
    Mutation: {
        updateGeneralPractitioner:
        // eslint-disable-next-line no-unused-vars
            async (parent, args, context, info) => {
                /**
                 * @type {SimpleContainer}
                 */
                const container = context.container;
                assertTypeEquals(container, SimpleContainer);
                const deletePractitioner = args.remove;
                const resourceType = 'Patient';
                const patients = await getResources(
                    parent,
                    {
                        ...args,
                        id: args.patientId,
                    },
                    context,
                    info,
                    resourceType
                );
                if (patients && patients.length === 0) {
                    throw new Error(`Patient not found ${args.patientId}`);
                }
                const patientToChange = patients[0];
                /**
                 * @type {import('../../../../utils/fhirRequestInfo').FhirRequestInfo}
                 */
                const requestInfo = getRequestInfo(context);
                if (deletePractitioner && patientToChange.generalPractitioner === null) {
                    return patientToChange;
                } else if (deletePractitioner) {
                    patientToChange.generalPractitioner = removeAllGeneralPractitioner(
                        patientToChange.generalPractitioner,
                        args.practitionerId
                    );
                    /**
                     * @type {RemoveOperation}
                     */
                    const removeOperation = container.removeOperation;
                    assertTypeEquals(removeOperation, RemoveOperation);
                    /**
                     * @type {R4ArgsParser}
                     */
                    const r4ArgsParser = container.r4ArgsParser;
                    assertTypeEquals(r4ArgsParser, R4ArgsParser);
                    await removeOperation.remove(
                        {
                            requestInfo,
                            parsedArgs: r4ArgsParser.parseArgs({
                                resourceType,
                                args: {
                                    ...args,
                                    base_version: '4_0_0',
                                    id: args.patientId,
                                }
                            }),
                            resourceType
                        }
                    );
                } else {
                    const practitioners = await getResources(
                        parent,
                        {
                            ...args,
                            id: args.practitionerId,
                        },
                        context,
                        info,
                        'Practitioner'
                    );
                    if (practitioners && practitioners.length === 0) {
                        throw new Error(`Practitioner not found ${args.practitionerId}`);
                    }
                    patientToChange.generalPractitioner = [
                        {reference: `Practitioner/${practitioners[0].id}`},
                    ];
                }
                requestInfo.body = [patientToChange];
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
                const result = await mergeOperation.merge(
                    {
                        requestInfo,
                        parsedArgs: r4ArgsParser.parseArgs({
                            resourceType,
                            args: {...args, base_version: '4_0_0'}
                        }),
                        resourceType: resourceType
                    }
                );
                if (result && result[0].operationOutcome) {
                    throw new Error(`Unable to update patient ${args.patientId}`);
                }
                return patientToChange;
            },
    },
};
