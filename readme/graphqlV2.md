# GraphQL V2 Support in FHIR Server

This FHIR server implements support for querying FHIR data using GraphQL(https://graphql.org/).

### Playground

You can access the GraphQLv2 playground by going to the /$graphqlv2 url in your browser e.g., <base_url>/4_0_0/$graphqlv2. This will redirect you to the OAuth provider to login and then will store your JWT token in a cookie so you can use the Playground. Here all the GraphQL entities and properties have inline documentation based on the FHIR specifications.

### Making GraphQL calls to the server

You can use the standard GraphQL client libraries or Postman and access the <base_url>/4_0_0/$graphqlv2 url. You will need to pass the OAuth token as a Bearer token to authenticate. See https://github.com/icanbwell/fhir-server/blob/master/security.md for details.

### Sample GraphQLv2 query

Query to fetch practitionerRole whose owner is set to bwell.

```graphql
query getPractitionerRole {
    practitionerRoles(
        _security: { value: { system: "https://www.icanbwell.com/owner", code: "bwell" } }
    ) {
        entry {
            resource {
                id
                practitioner {
                    reference 
                    resource {
                        name {
                            family
                            given
                        }
                    }
                }
                organization {
                    reference
                    resource {
                        name
                    }
                }
                healthcareService {
                    reference
                    resource {
                        name
                    }
                }
                location {
                    reference
                    resource {
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
To overcome this we updated the schema to return resource inside reference type object. Allowing us to access following fields of reference: type, identifier, id, display, extension

Additionally we can now also fetch just the reference of resource without resolving the nested resource.

Eg- Query to fetch Observations along with data of subject of observations

```graphql
query OnObservation {
    observations {
        entry {
            resource {
                id
                subject {
                    type
                    identifier {
                        id
                    }
                    display
                    reference
                    resource {
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
    claims(created: { value: { greaterThan: "2024-04-04" } }) {
        entry {
            resource {
                provider {
                    reference
                    resource {
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

We use a code generator to read the FHIR schema and generate the GraphQLv2 schema and resolvers. This code generator is in https://github.com/icanbwell/fhir-server/blob/master/generatorScripts/graphqlv2/generate_graphqlv2_classes.py and can be run by typing the command `make graphqlv2`.

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
    observations(patient: { value: "d0554652-cd35-55b7-aa90-ef4bca7479ae" }) {
        entry {
            resource {
                id
                subject {
                    reference
                    resource {
                        ...PatientInfo
                    }
                }
            }
        }
    }
    patients(id: { value: "d0554652-cd35-55b7-aa90-ef4bca7479ae" }) {
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
    conditions(_count: $FHIR_DEFAULT_COUNT) {
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
    observations(
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
    observations(_sort: ["id", "-meta.lastUpdated"]) {
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
    observations(_count: 5) {
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
    observations(_getpagesoffset: 2) {
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
    observations(_debug: true) {
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
    observations(_explain: true) {
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
    observations(_setIndexHint: "uuid") {
        entry {
            resource {
                id
            }
        }
    }
}
```

## Examples for querying different types of search modifiers

### SearchToken
- `value` [Below example uses nested `value` field. Other nested options are: `system`, `code` & `notEquals`]
```
query {
  observations(
    status: {
        value: {
            value: "completed"
        }
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `values` [List format of `value`]
```graphql
query {
  observations(
    status: {
        values: [
            {
                value: "completed"
            }
        ]
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `notEquals` [Below example uses nested `value` field. Other nested options are: `system`, `code` & `value`]
```graphql
query {
  observations(
    status: {
        notEquals: {
            value: "completed"
        }
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `missing`
```graphql
query {
  observations(
    status: {
        missing: true
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `text`
Eg- Query to get conditions where text portion of a CodeableConcept or the display portion contains text 'headache'
```graphql
query getCondition {
    conditions(code: { text: "headache" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `ofType`
Can only be used with identifier and require system, code and value to be defined.
```graphql
query {
    conditions(
        identifier: {
            ofType: {
                system: "http://terminology.hl7.org/CodeSystem/v2-0203"
                code: "PRN"
                value: "4657"
            }
        }
    ) {
        entry {
            resource {
                id
                identifier {
                    type {
                        coding {
                            system
                            code
                        }
                    }
                    value
                }
            }
        }
    }
}
```


### SearchString
- `value`
```graphql
query {
  persons(
    name: {
        value: "test"
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `values`
```graphql
query {
  persons(
    name: {
        values: ["test1", "test2"]
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `notEquals` [Below example uses nested `value` field. Other nested option is: `values` which is just list of `value`]
```graphql
query {
  persons(
    name: {
        notEquals: {
            value: "testing"
        }
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `missing`
```graphql
query {
  persons(
    name: {
        missing: true
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `contains`
```graphql
query {
  persons(
    name: {
        contains: "test"
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `exact`
```graphql
query {
  persons(
    name: {
        exact: "test"
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```

### SearchReference
- `value`
```graphql
query {
  procedures(
    encounter: {
        value: "5abd4446-938e-40ab-b5f2-50c3f74cfa73"
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `target` [To be used with `value`]
```graphql
query {
  procedures(
    encounter: {
        target: "Encounter",
        value: "5abd4446-938e-40ab-b5f2-50c3f74cfa73"
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `notEquals` [Also supports `target` inside `notEquals`]
```graphql
query {
  procedures(
    encounter: {
        notEquals: {
            value: "5abd4446-938e-40ab-b5f2-50c3f74cfa73"
        }
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```
- `missing`
```graphql
query {
  procedures(
    encounter: {
        missing: true
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```

### SearchDate/SearchDateTime
- `value` [Supported operations on Date/DateTime are: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo`]
```graphql
query {
    immunizations(
        date: {
            # Below filter does an AND operation of all items in "value"
            value: {
                greaterThan: "2021-01-01",
                lessThan: "2022-01-01"
            }
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `values` [List format of `value`]
```graphql
query {
    immunizations(
        date: {
            # Below filters does an OR operation of all items in "values"
            values: [
                { lessThan: "2021-01-01" }
                { greaterThan: "2022-01-01" }
            ]
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `missing`
```graphql
query {
  immunizations(
    date: {
        missing: true
    }
  ) {
    entry {
      resource {
        id
      }
    }
  }
}
```

### SearchExtension
- `value` [Also supports `notEquals` along with `url` and `valueString`]
```graphql
query {
    conditions(
        extension: {
            value: {
                url: "https://www.icanbwell.com",
                valueString: "test"
            }
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `values` [List format of `value`]
```graphql
query {
    conditions(
        extension: {
            values: [
                {
                    url: "https://www.icanbwell.com",
                    valueString: "test"
                }
            ]
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `notEquals` [Also supports `values` along with `url` and `valueString`]
```graphql
query {
    conditions(
        extension: {
            notEquals: {
                url: "https://www.icanbwell.com",
                valueString: "test"
            }
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `missing`
```graphql
query {
    conditions(
        extension: {
            missing: true
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```

### SearchNumber
- `value` [Also supports `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo` and `approximately`]
```graphql
query getriskAssessment {
    riskAssessments(
        probability: { 
            # Below filter does an AND operation of all items in "value"
            value: { 
                lessThan: 100,
                greaterThan: 80
            }
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `values` [List format of `value`]
```graphql
query getriskAssessment {
    riskAssessments(
        probability: { 
            # Below filters does an OR operation of all items in "values"
            values: [
                { lessThan: 100 }
                { greaterThan: 50 }
            ]
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
- `missing`
```graphql
query {
    riskAssessments(
        probability: { 
            missing: true
        }
    ) {
        entry {
            resource {
                id
            }
        }
    }
}
```
### SearchQuantity
- `prefix`, `value`, `system` and `code`
<br>
Values of prefix can be following:
  * ne: notEquals
  * gt: greaterThan
  * ge: greaterThanOrEqualTo
  * lt: lessThan
  * le: lessThanOrEqualTo
  * ap: approximately

```graphql
query getObservation {
    observations(
      value_quantity: { 
        value: "5.4", 
        prefix: "lt",
        system: "http://unitsofmeasure.org",
        code: "g"
      }
    ) {
        entry {
            resource {
                id
              	valueQuantity{
                  value
                  system
                  code
                }
            }
        }
    }
}
```
- `missing`
```graphql
query {
    observations(
        value_quantity: {
            missing: true
        }
    ) {
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

### Support for mutations are removed from GraphQLv2

### In GraphQLv2, the resource names are now updated with their plurals for top level.
Complete mapping for plural names of resources can be found [here](https://github.com/icanbwell/fhir-server/blob/main/generatorScripts/fhir_xml_schema_parser.py#L117).
Additionally field names of [patient custom queries](https://github.com/icanbwell/fhir-server/blob/main/src/graphqlv2/schemas/custom/patient.graphql) for fetching linked clinical resources are also updated to their plural names.

GraphQLv1:

Eg- Query to fetch observation

```graphql
query OnObservation {
    observation{
        entry {
            resource {
                id
            }
        }
    }
}
```

Graphqlv2:

Eg- Query to fetch observation

```graphql
query OnObservation {
    observations{
        entry {
            resource {
                id
            }
        }
    }
}
```

### In GraphQLv2, in `id` field, `uuid` is returned by default for all resources.
To revert to previous behaviour and fetch sourceId in `id` field, following header can be sent.
```
{
    prefer: 'global_id=false'
}
```

GraphQLv1:

Eg- Query to fetch patient by sourceId

```graphql
query patient {
    patient (
        id: {
            value: "example"
        }
    ){
        entry {
            resource {
                id
            }
        }
    }
}
```

Expected Response in GraphQLv1
```
{
  "data": {
    "patient": {
      "entry": [
        {
          "resource": {
            "id": "example"
          }
        }
      ],
      "meta": null
    }
  }
}
```

Graphqlv2:

Eg- Query to fetch patient by sourceId

```graphql
query patient {
    patients (
        id: {
            value: "example"
        }
    ){
        entry {
            resource {
                id
            }
        }
    }
}
```

Expected Response in GraphQLv2
```
{
  "data": {
    "patients": {
      "entry": [
        {
          "resource": {
            "id": "0edf0234-7de6-5c86-ac23-3136e9f131e2"
          }
        }
      ],
      "meta": null
    }
  }
}
```

### In GraphQLv2, the reference resources are now returned inside a reference object. And we can also just fetch the reference as string instead of resolving the nested resource

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
    observations {
        entry {
            resource {
                id
                subject {
                    type
                    identifier {
                        id
                    }
                    display
                    reference
                    resource {
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
    observations(id: { value: "001" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

## Custom queries in Patient resource

We can fetch the clinical resources of a patient directly in patient resource. Custom fields for patient resources are defines [here](../src/graphqlv2/schemas/custom/patient.graphql)

Example query for fetching clinical resources for a patient
```graphql
query patient_data {
  patients(id: { value: "01bc85aa-63d3-54ed-8907-c6a7c513db66" }) {
    entry {
      resource {
        id
        resourceType
        observations {
          id
          resourceType
        }
        conditions {
          id
          resourceType
        }
      }
    }
  }
}
```

### Patient Resource Not Supported in custom query
Currently [BiologicallyDerivedProduct](https://www.hl7.org/fhir/r4b/BiologicallyDerivedProduct.html) is not supported in custom queries of patient as there are no search parameters for this resource.

