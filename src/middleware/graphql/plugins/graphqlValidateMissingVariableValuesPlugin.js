const { ApolloServerErrorCode } = require('@apollo/server/errors');

const { GraphQLError } = require('graphql');

class ValidateMissingVariableValuesPlugin /*extends ApolloServerPlugin*/ {
    /**
     * This plugin validates that all the GraphQL Variables have corresponding values provided
     */
    constructor() {
        // ok to not specify
    }

    // eslint-disable-next-line no-unused-vars
    async requestDidStart(requestContext1) {
        return {
            didResolveOperation({ request, document }) {
                let missingVariables = [];
                const queryVariables = request.variables;
                document.definitions.forEach(definition => {
                    definition.variableDefinitions.forEach(variableDefinition => {
                        if (!queryVariables[variableDefinition.variable.name.value]) {
                            missingVariables.push(variableDefinition.variable.name.value);
                        }
                    });
                });
                if (missingVariables.length) {
                    throw new GraphQLError(`Missing variable values: ${missingVariables.join(',')}`, {
                        extensions: { code: ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED },
                    });
                }
            },
            async willSendResponse({ response }) {
                if (response.body.kind === 'single' &&
                    response.body.singleResult.errors?.[0]?.extensions?.code === ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED) {
                    response.http.status = 200;
                }
            },
        };
    }
}

const getValidateMissingVariableValuesPlugin = () => {
    return new ValidateMissingVariableValuesPlugin();
};

module.exports = {
    getValidateMissingVariableValuesPlugin,
};


