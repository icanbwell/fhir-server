# GraphQL V2 Support in FHIR Server

This FHIR server implements support for querying FHIR data using GraphQL(https://graphql.org/).

### High Level Sequence

[![](https://mermaid.ink/img/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgQnJvd3Nlci0-PitBV1NDb2duaXRvOiBBdXRoZW50aWNhdGVcbiAgICBBV1NDb2duaXRvLT4-K0Jyb3dzZXI6IFNlbmQgYmVhcmVyIHRva2VuXG4gICAgQnJvd3Nlci0-PitGSElSU2VydmVyOiBHcmFwaFFMIFJlcXVlc3RcbiAgICBGSElSU2VydmVyLT4-K0NvbW1vbkNvZGU6IEF1dGhvcml6ZSAmIFJlcXVlc3QgZGF0YVxuICAgIENvbW1vbkNvZGUtPj4rTW9uZ29EYjogU2VuZCBxdWVyeVxuICAgIE1vbmdvREItPj4rQ29tbW9uQ29kZTogUmV0dXJuIGRhdGFcbiAgICBDb21tb25Db2RlLT4-K0ZISVJTZXJ2ZXI6IFJldHVybiBkYXRhXG4gICAgRkhJUlNlcnZlci0-PitCcm93c2VyOiBSZXR1cm4gZGF0YVxuXG4gICAgICAgICAgICAiLCJtZXJtYWlkIjp7InRoZW1lIjoiZGFyayJ9LCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9)](https://mermaid.live/edit#eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgQnJvd3Nlci0-PitBV1NDb2duaXRvOiBBdXRoZW50aWNhdGVcbiAgICBBV1NDb2duaXRvLT4-K0Jyb3dzZXI6IFNlbmQgYmVhcmVyIHRva2VuXG4gICAgQnJvd3Nlci0-PitGSElSU2VydmVyOiBHcmFwaFFMIFJlcXVlc3RcbiAgICBGSElSU2VydmVyLT4-K0NvbW1vbkNvZGU6IEF1dGhvcml6ZSAmIFJlcXVlc3QgZGF0YVxuICAgIENvbW1vbkNvZGUtPj4rTW9uZ29EYjogU2VuZCBxdWVyeVxuICAgIE1vbmdvREItPj4rQ29tbW9uQ29kZTogUmV0dXJuIGRhdGFcbiAgICBDb21tb25Db2RlLT4-K0ZISVJTZXJ2ZXI6IFJldHVybiBkYXRhXG4gICAgRkhJUlNlcnZlci0-PitCcm93c2VyOiBSZXR1cm4gZGF0YVxuXG4gICAgICAgICAgICAiLCJtZXJtYWlkIjoie1xuICBcInRoZW1lXCI6IFwiZGFya1wiXG59IiwidXBkYXRlRWRpdG9yIjpmYWxzZSwiYXV0b1N5bmMiOnRydWUsInVwZGF0ZURpYWdyYW0iOmZhbHNlfQ)

### Playground

You can access the GraphQLv2 playground by going to the /$graphqlv2 url in your browser e.g., http://fhir.dev.bwell.zone/$graphqlv2. This will redirect you to the OAuth provider to login and then will store your JWT token in a cookie so you can use the Playground.

### Making GraphQL calls to the server

You can use the standard GraphQL client libraries or Postman and access the /$graphqlv2 url. You will need to pass the OAuth token as a Bearer token to authenticate. See https://github.com/icanbwell/fhir-server/blob/master/security.md for details.

### Documentation

All the GraphQL entities and properties have inline documentation from FHIR specifications

### Sample GraphQLv2 query

```graphql
query {
    practitionerRole {
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

### Sample Python Code

```python
import requests

url = "https://fhir.dev.bwell.zone/4_0_0/$graphqlv2"

payload="{\"query\":\"query {\\n practitionerRole {\\n entry {\\n resource  {\\n    id\\n    practitioner {\\n   reference {   name {\\n        family\\n        given\\n      }\\n  }  }\\n    organization {\\n   reference {   name\\n  }  }\\n    healthcareService {\\n   reference {   name\\n  }  }\\n    location {\\n   reference {   name\\n  }  }\\n  }\\n}\\n}\\n}\",\"variables\":{}}"

headers = {
  'Authorization': 'Bearer {put token here}',
  'Content-Type': 'application/json'
}

response = requests.request("POST", url, headers=headers, data=payload)

print(response.text)
```

### Sample Node.js code

```javascript
var https = require('follow-redirects').https;
var fs = require('fs');

var options = {
    method: 'POST',
    hostname: 'fhir.dev.bwell.zone',
    path: '/4_0_0/$graphqlv2',
    headers: {
        Authorization: 'Bearer {put token here}',
        'Content-Type': 'application/json'
    },
    maxRedirects: 20
};

var req = https.request(options, function (res) {
    var chunks = [];

    res.on('data', function (chunk) {
        chunks.push(chunk);
    });

    res.on('end', function (chunk) {
        var body = Buffer.concat(chunks);
        console.log(body.toString());
    });

    res.on('error', function (error) {
        console.error(error);
    });
});

var postData = JSON.stringify({
    query: `query {
    practitionerRole {
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
}`,
    variables: {}
});

req.write(postData);

req.end();
```

### Sample cUrl Code

```shell
curl 'https://fhir.dev.bwell.zone/4_0_0/$graphqlv2' \
  -H 'Authorization: Bearer {put token here}' \
  -H 'content-type: application/json' \
  --data-raw '{"query":"{\n  practitionerRole {\n    entry {\n      resource {\n        id\n        practitioner {\n          reference {\n            name {\n              family\n              given\n            }\n          }\n        }\n        organization {\n          reference {\n            name\n          }\n        }\n        healthcareService {\n          reference {\n            name\n          }\n        }\n        location {\n          reference {\n            name\n          }\n        }\n      }\n    }\n  }\n}"}'
```

### Querying union types

Querying union types require the following syntax (https://www.apollographql.com/docs/apollo-server/schema/unions-interfaces/#querying-a-union):

```
provider {
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

In GraphQL, fragments are just a reusable part of the query. Within the area of GraphQL, it’s common to meet scenarios where identical fields are queried across multiple requests. Recognizing this repetition can lead to the combining of these fields into reusable components known as fragments.

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

query getObservtaionsAndPatients {
    observation {
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
    patient {
        entry {
            resource {
                ...PatientInfo
            }
        }
    }
}
```
In this example PatientInfo is reused in two queries without needing to repeat the fields and making the query more easier to understand.

## Upgrading from graphqlv1 to graphqlv2

### In GraphQLv2, the reference resources are now returned inside a reference object.
Earlier in Graphqlv1, we were directly returning resource intead of reference type object in reference fields. Due to this we were adding some fields of reference like display and type in extension key of resource. But this won't work in case we don't have any resource but just display or type in reference field.
To overcome this we updated the schema to return resource inside reference type object.

GraphQLv1:

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

-   Number search parameter along with prefixes (greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo, approximately)

```graphql
query getriskAssessment {
    riskAssessment(_count: 10, _debug: true, probability: { value: { greaterThan: 100 } }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   Quantity search parameter along with prefixes (gt, ge, lt, le, ap)

```graphql
query getObservation {
    observation(_count: 10, _debug: true, value_quantity: { value: 5.4, prefix: "lt" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```

-   Modifiers in String search paramters: exact and contains

```graphql
query getobservationDefinition {
    observationDefinition(_count: 10, _debug: true, name: { contains: "abc" }) {
        entry {
            resource {
                id
            }
        }
    }
}
```
