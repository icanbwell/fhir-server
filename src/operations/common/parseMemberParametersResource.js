const { BadRequestError } = require('../../utils/httpErrors');

/**
 * Parses a $member-add / $member-remove request body -- a Parameters resource with repeated
 * `member` parameters, each an optional nested `period` part -- into a flat list of member
 * events for MongoGroupMemberRepository.applyMemberEventsAsync / embedded array mutation.
 *
 * bwell's body omits the Da Vinci Member Attribution IG's attribution-specific parameters,
 * which exist for payer/provider attribution lists rather than membership in general.
 *
 * @param {Object} resource - raw Parameters resource from the request body
 * @param {'add'|'remove'} op
 * @returns {Array<{entity: {reference:string, type:string|undefined, display:string|undefined}, period:Object|undefined, op:'add'|'remove'}>}
 */
function parseMemberParametersResource(resource, op) {
    if (!resource || resource.resourceType !== 'Parameters' || !Array.isArray(resource.parameter)) {
        throw new BadRequestError(
            new Error('Request body must be a Parameters resource with at least one member parameter')
        );
    }

    const memberParams = resource.parameter.filter((p) => p.name === 'member');
    if (memberParams.length === 0) {
        throw new BadRequestError(
            new Error('Parameters resource must contain at least one member parameter')
        );
    }

    return memberParams.map((p) => {
        const reference = p.valueReference?.reference;
        if (!reference) {
            throw new BadRequestError(
                new Error('Each member parameter must have a valueReference with a reference')
            );
        }

        const periodPart = (p.part || []).find((part) => part.name === 'period');

        return {
            entity: {
                reference,
                type: p.valueReference?.type,
                display: p.valueReference?.display
            },
            period: periodPart?.valuePeriod,
            op
        };
    });
}

module.exports = { parseMemberParametersResource };
