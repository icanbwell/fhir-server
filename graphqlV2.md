# GraphQL V2 Support in FHIR Server

This FHIR server implements support for querying FHIR data using GraphQL(https://graphql.org/).

### Playground

You can access the GraphQLv2 playground by going to the /$graphqlv2 url in your browser e.g., <base_url>/$graphqlv2. This will redirect you to the OAuth provider to login and then will store your JWT token in a cookie so you can use the Playground. Here all the GraphQL entities and properties have inline documentation based on the FHIR specifications.

### Making GraphQL calls to the server

You can use the standard GraphQL client libraries or Postman and access the <base_url>/4_0_0/$graphqlv2 url. You will need to pass the OAuth token as a Bearer token to authenticate. See https://github.com/icanbwell/fhir-server/blob/master/security.md for details.

### Sample GraphQLv2 query

Query to fetch practitionerRole whose owner is set to bwell.

```graphql
query getPractitionerRole {
    practitionerRole(
        _security: { value: { system: "https://www.icanbwell.com/owner", code: "bwell" } }
    ) {
        entry {
            resource {
                id
                practitioner {
                    reference {
                        name {
                            family
                            given
                        }
                    }
                }
                organization {
                    reference {
                        name
                    }
                }
                healthcareService {
                    reference {
                        name
                    }
                }
                location {
                    reference {
                        name
                    }
                }
            }
        }
    }
}
```

### Addition of reference fields in GraphQL V2

Earlier in Graphqlv1, we were directly returning resource instead of reference type object in reference fields. Due to this we were adding some fields of reference like display and type in extension key of resource. But this won't work in case we don't have any resource but just display or type in reference field.
To overcome this we updated the schema to return resource inside reference type object. Allowing us to access following fields of reference: type, identifier, id, display, extension,

Eg- Query to fetch Observations along with data of subject of observation

```graphql
query OnObservation {
    observation {
        entry {
            resource {
                id
                subject {
                    type
                    identifier {
                        id
                    }
                    display
                    reference {
                        ... on Patient {
                            id
                        }
                    }
                }
            }
        }
    }
}
```

### Querying union types

Querying union types require the following syntax (https://www.apollographql.com/docs/apollo-server/schema/unions-interfaces/#querying-a-union):

Eg- Query to fetch claims that are created after 4 April 2024 along with info of Organizations and Practitioners it refers to.

```graphql
query claim {
    claim(created: { value: { greaterThan: "2024-04-04" } }) {
        entry {
            resource {
                provider {
                    reference {
                        __typename
                        ... on Organization {
                            id
                            identifier {
                                system
                                value
                            }
                        }
                        ... on Practitioner {
                            id
                            name {
                                family
                                given
                            }
                        }
                    }
                }
            }
        }
    }
}
```

### GraphQL Server Implementation

We use the apollo-server-express framework to implement the GraphQL middleware. This is implemented in
https://github.com/icanbwell/fhir-server/blob/master/src/middleware/graphql/graphqlServerV2.js

We use the graphql-tools framework, so we can store the schema and resolver for each FHIR entity in a separate file and then merge them together to create the full schema.

### Security

For security, we use the same mechanism for both REST and GraphQL. There are two pieces to this:

1. The middleware to read auth tokens, decrypt them and add `request.user` and `request.scope`: https://github.com/icanbwell/fhir-server/blob/master/src/strategies/jwt.bearer.strategy.js
2. code to check these permissions when needed. This code is stored in the https://github.com/icanbwell/fhir-server/tree/master/src/operations

### Code Generation

We use a code generator to read the FHIR schema and generate the GraphQLv2 schema and resolvers. This code generator is in https://github.com/icanbwell/fhir-server/blob/master/src/fhir/generator/generate_graphqlv2_classes.py and can be run by typing the command `make graphqlv2`.

In the https://github.com/icanbwell/fhir-server/tree/master/src/graphqlv2/schemas folder each FHIR entity has its own GraphQL schema file. The schema.graphql file is the top level schema element.
In the https://github.com/icanbwell/fhir-server/tree/master/src/graphqlv2/resolvers folder each FHIR resource has its own GraphQL resolver file. The resolvers.js merges all the resolvers together.

### FHIR References

This FHIR server automatically turns each reference into a nested access to the referenced resource.

### Adding reverse links

To add a reverse link:

1. Add a custom schema file (e.g., https://github.com/icanbwell/fhir-server/blob/master/src/graphqlv2/schemas/custom/patient.graphql)
2. Add a custom resolver file (e.g., https://github.com/icanbwell/fhir-server/blob/master/src/graphqlv2/resolvers/custom/patient.js)

The FHIR server will automatically load these the next time it runs.

### Adding Enrichment Providers

Sometimes you want to add enrichment to the underlying FHIR data (e.g., calculating totals, adding additional properties etc). To enable this we have a concept of pluggable enrichment providers.

To add a new enrichment provider:

1. Add a new provider class here: https://github.com/icanbwell/fhir-server/tree/master/src/enrich/providers. You can see examples in here. Implement the interface.
2. Register your new provider in https://github.com/icanbwell/fhir-server/tree/master/src/createContainer.js
   Now this enrichment provider will be run for every resource and can add additional properties. These properties are available both when accessing the server via REST or GraphQL.

## Fragments in Graphql

In GraphQL, fragments are reusable components that combine identical fields queried across multiple requests to avoid repetition. This results in shorter and easier to understand queries.

Eg- Query to fetch Patient data along with their Observations where patient's uuid is 'd0554652-cd35-55b7-aa90-ef4bca7479ae'

```graphql
fragment PatientInfo on Patient {
    id
    name {
        given
        family
    }
    address {
        state
        country
    }
}

query getObservationsAndPatients {
    observation(patient: { value: "d0554652-cd35-55b7-aa90-ef4bca7479ae" }) {
        entry {
            resource {
                id
                subject {
                    reference {
                        ...PatientInfo
                    }
                }
            }
        }
    }
    patient(id: { value: "d0554652-cd35-55b7-aa90-ef4bca7479ae" }) {
        entry {
            resource {
                ...PatientInfo
            }
        }
    }
}
```

In this example PatientInfo is reused in two queries without needing to repeat the fields and making the query more easier to understand.

## Variables in Graphql

Variables can be used in graphql to make dynamic queries. Multiple variables can be defined for a single query and default values for variables can also be given.

Eg- Query to get 10 conditions

```graphql
query getCondition($FHIR_DEFAULT_COUNT: Int, $withMeta: Boolean! = false) {
    condition(_count: $FHIR_DEFAULT_COUNT) {
        entry {
            resource {
                id
                meta @include(if: $withMeta) {
                    id
                }
            }
        }
    }
}
```

Variables json

```json
{
    "FHIR_DEFAULT_COUNT": 10,
    "withMeta": true
}
```

## Additional Query parameters

-   \_total: return total number of records that satisfies this query

```graphql
query OnObservation {
    observation(
        _total: accurate
        _security: { value: { system: "https://www.icanbwell.com/owner", code: "bwell" } }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   \_sort: sort records by these fields. The fields can be nested fields. Prepend with "-" to indicate descending sort.

```graphql
query OnObservation {
    observation(_sort: ["id", "-meta.lastUpdated"]) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   \_count: limit number of records to this count in result. Default is 10

```graphql
query OnObservation {
    observation(_count: 5) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   \_getpagesoffset: page number to retrieve

```graphql
query OnObservation {
    observation(_getpagesoffset: 2) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   \_debug: include debugging information with the result

```graphql
query OnObservation {
    observation(_debug: true) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   \_explain: explain query but not run it

```graphql
query OnObservation {
    observation(_explain: true) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   \_setIndexHint: allows to set index to be used if query is running slow

```graphql
query OnObservation {
    observation(_setIndexHint: "uuid") {
        entry {
            resource {
                id
            }
        }
    }
}
```

## Upgrading from graphqlv1 to graphqlv2

### API endpoint update

-   In GraphQL V1 the endpoint to access was `<base_url>/$graphql`
-   In GraphQL V2 it is updated to `<base_url>/4_0_0/$graphqlv2`

### In GraphQLv2, the reference resources are now returned inside a reference object.

GraphQLv1:

Eg- Query to fetch Observations along with data of subject of observation

```graphql
query OnObservation {
    observation {
        entry {
            resource {
                id
                subject {
                    ... on Patient {
                        id
                    }
                }
            }
        }
    }
}
```

Graphqlv2:

Eg- Query to fetch Observations along with data of subject of observation

```graphql
query OnObservation {
    observation {
        entry {
            resource {
                id
                subject {
                    type
                    identifier {
                        id
                    }
                    display
                    reference {
                        ... on Patient {
                            id
                        }
                    }
                }
            }
        }
    }
}
```

### In GraphQLv2, '\_id' is removed from querying and 'id' now follows SearchString input schema.

GraphQLv1:

Eg- Query to fetch observation with id '001'

```graphql
query OnObservation {
    observation(id: "001", _id: { value: "001" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

Graphqlv2:

Eg- Query to fetch observation with id '001'

```graphql
query OnObservation {
    observation(id: { value: "001" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

## Upcoming support for missing search parameter types, modifiers and prefixes

-   Support for querying on fields of Number type, like probability in riskAssessment.

Eg- Query to get riskAssessment whose probability is greater than 100

```graphql
query getriskAssessment {
    riskAssessment(probability: { value: { greaterThan: 100 } }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   Support for querying on fields of Quantity type, like value_quantity in observation.

Eg- Query to get Observations where value of observation is less than 5.4

```graphql
query getObservation {
    observation(value_quantity: { value: 5.4, prefix: "lt" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   Support for modifiers in String search parameters: exact and contains

Eg- Query to get Accounts where name contains 'abc'

```graphql
query getAccount {
    account(name: { contains: "abc" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   Support for modifiers in Token search parameters: text, in, not-in, of-type, above & below

Eg- Query to get conditions where text portion of a CodeableConcept or the display portion contains text 'headache'

```graphql
query getCondition {
    condition(code: { text: "headache" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   Fix 'missing' modifier which is not working in graphqlv1

Eg- Query to get observations where specimen field is missing

```graphql
query getObservation {
    observation(specimen: { missing: true }) {
        entry {
            resource {
                id
            }
        }
    }
}
```