const { LENIENT_SEARCH_HANDLING, STRICT_SEARCH_HANDLING } = require('../../../constants');
const { ApolloServerErrorCode } = require('@apollo/server/errors');

const { GraphQLError } = require('graphql');

class ValidateMissingVariableValuesPlugin /* extends ApolloServerPlugin */ {
    /**
     * This plugin validates that all the GraphQL Variables have corresponding values provided
     */

    async requestDidStart (requestContext1) {
        return {
            didResolveOperation ({ request, document }) {
                let handlingType = request.http.headers.get('handling');
                handlingType = handlingType || LENIENT_SEARCH_HANDLING;
                if (handlingType === STRICT_SEARCH_HANDLING) {
                    const missingVariables = [];
                    const queryVariables = request.variables;
                    (document.definitions || []).forEach(definition => {
                        (definition.variableDefinitions || []).forEach(variableDefinition => {
                            if (!queryVariables[variableDefinition.variable.name.value] && !variableDefinition.defaultValue) {
                                missingVariables.push(variableDefinition.variable.name.value);
                            }
                        });
                    });
                    if (missingVariables.length) {
                        throw new GraphQLError(`Missing variable values: ${missingVariables.join(',')}`, {
                            extensions: { code: ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED }
                        });
                    }
                }
            },
            async willSendResponse ({ response }) {
                if (response.body.kind === 'single' &&
                    response.body.singleResult.errors?.[0]?.extensions?.code === ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED) {
                    response.http.status = 200;
                }
            }
        };
    }
}

const getValidateMissingVariableValuesPlugin = () => {
    return new ValidateMissingVariableValuesPlugin();
};

module.exports = {
    getValidateMissingVariableValuesPlugin
};
