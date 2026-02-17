# FHIR Server Cheatsheet for REST API

## 0. Accessing FHIR Server

You access FHIR server using REST API requests which are just standard HTTP calls (https://hl7.org/fhir/R4B/http.html).

Typically, this is done via:

1. A tool like Postman (https://www.postman.com/) to do the calls manually for testing
2. A command line tool like curl (https://curl.se/)
    ```shell
    curl --location --request GET 'http://localhost:3000/4_0_0/Patient' \
    --header 'Authorization: Bearer {token here}' --header 'Content-Type: application/fhir+json'
    ```
3. Code in Javascript or Python or other programming language

Javascript Example:

```javascript
var xhr = new XMLHttpRequest();
xhr.withCredentials = true;

xhr.addEventListener('readystatechange', function () {
    if (this.readyState === 4) {
        console.log(this.responseText);
    }
});

xhr.open('GET', 'http://localhost:3000/4_0_0/Patient');
xhr.setRequestHeader('Authorization', 'Bearer {token here}');
xhr.setRequestHeader('Content-Type', 'application/fhir+json');

xhr.send();
```

Python Example:

```python
import requests

url = "http://localhost:3000/4_0_0/Patient"

payload={}
headers = {
    'Authorization': 'Bearer {token here}',
    'Content-Type': 'application/fhir+json'
}

response = requests.request("GET", url, headers=headers, data=payload)

print(response.text)

```

**Note:** Make sure you set `Content-Type: application/fhir+json` header in your HTTP call to the FHIR server.

## 1. Searching for Resources

You can search for resources by going to the /4_0_0/{resource} url e.g.,
http://localhost:3000/4_0_0/Patient

**Note**: The server will return only 100 records by default unless the \_count query parameter is specified per below.

### 1.1 Specifying how many records to return

Use the `_count` query parameter e.g.,
http://localhost:3000/4_0_0/Practitioner?_count=10

The default is 100

**Note**: Passing 0 in this query parameter is equivalent to no limit.

FHIR Specification: https://www.hl7.org/fhir/R4B/search.html#count

### 1.2 Select only specific fields from the resource

Specify a comma separated list in `_elements` query parameter e.g.,
http://localhost:3000/4_0_0/QuestionnaireResponse?_elements=id,meta

FHIR Specification: https://www.hl7.org/fhir/R4B/search.html#elements

### 1.3 Sorting records

Specify a comma separated list in `_sort` query parameter e.g.,
http://localhost:3000/4_0_0/QuestionnaireResponse?_count=10&_sort=meta.lastUpdated (ascending)

To specify sorted a field descending, prepend the field name with `-`
http://localhost:3000/4_0_0/QuestionnaireResponse?_count=10&_sort=-meta.lastUpdated

Multiple sort fields can be specified:
http://localhost:3000/4_0_0/QuestionnaireResponse?_count=10&_sort=-meta.lastUpdated,id

FHIR Specification: https://www.hl7.org/fhir/R4B/search.html#_sort

### 1.4 Paging

#### 1.4.1 offset & limit based paging

To page through the data specify the `_count` and the `_getpageoffset` query parameters e.g., http://localhost:3000/4_0_0/ExplanationOfBenefit?_count=2&_getpagesoffset=2

When you get no resources back then this means you've reached the end.

**Note**: Do not use _getpagesoffset based paging if a recource have millions of records. If FHIR Server is not able read 1st record from MongoDB within 1 minute then it will return as error with 500 status code.

#### 1.4.2 cursor(next url) based pagination

Each REST Search to FHIR Server returns `next` url in bundle that can be used to fetch next set of data for search and `_count` can specify the no. of records that can be returned in each API call. 

`next` url is always added to the bundle response (even if number of resources are less than or equal to limit specified using _count) of Search operation to allow fetching result after the last resource in bundle. After using the next url, if you get no resources back then this means you've reached the end of Search operation for given filters.

We do not have any maximum number for `_count`. It can be anything but `_count=0` in this query parameter is equivalent to no limit and return all the records that can be transfered in 1 hours.

**Note**: FHIR Server can keep REST resouce fetch connection open till 1 hour and if request is not able to complete in 1 hour then last record may be in-complete json.

### 1.5 Additional Filters

The FHIR Server supports all the standard FHIR search parameters: https://www.hl7.org/fhir/R4B/searchparameter-registry.html. Below are some examples:

| Filter By                 | Query Parameter                                                                                                                    | Example                                                                                                                                                                                                          | Supported for Resources                                                           |     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --- |
| By ids or list of ids     | id=a,b                                                                                                                             | http://localhost:3000/4_0_0/Practitioner?id=1194724047,546333                                                                                                                                               | All                                                                               |     |
| By name                   | name=Jordan                                                                                                                        | http://localhost:3000/4_0_0/Practitioner?name=Jordan                                                                                                                                                        | Patient, Practitioner                                                             |     |
| By family name            | family=Jordan                                                                                                                      | http://localhost:3000/4_0_0/Practitioner?family=Jordan                                                                                                                                                      | Patient, Practitioner                                                             |     |
| By identifier             | identifier={system}&#124;{value}                                                                                                   | [http://localhost:3000/4_0_0/Practitioner/?identifier=http://hl7.org/fhir/sid/us-npi&#124;1487831681](http://localhost:3000/4_0_0/Practitioner/?identifier=http://hl7.org/fhir/sid/us-npi\|1487831681)  | All                                                                               |     |
| By extension             | extension={system}&#124;{value} | http://localhost:3000/4_0_0/Practitioner/?extension=http://hl7.org/fhir/sid/us-npi&#124;1487831681  | All                                                                               |     |
| By source                 | source=url                                                                                                                         | http://localhost:3000/4_0_0/Practitioner?source=http://somehealth.org/insurance                                                                                                                             | All                                                                               |     |
| By security tag           | \_security=[https://www.icanbwell.com/{access/owner/vendor}&#124;{value}](https://www.icanbwell.com/{access/owner/vendor}\|{value}) | [http://localhost:3000/4_0_0/Organization?\_security=https://www.icanbwell.com/access&#124;somehealth](http://localhost:3000/4_0_0/Organization?_security=https://www.icanbwell.com/access\|somehealth) | All                                                                               |     |
| Updated after a datetime  | \_lastUpdated=gt{date}                                                                                                             | http://localhost:3000/4_0_0/QuestionnaireResponse?_lastUpdated=gt2021-01-18                                                                                                                                 | All                                                                               |     |
| Updated before a datetime | \_lastUpdated=lt{date}                                                                                                             | http://localhost:3000/4_0_0/QuestionnaireResponse?_lastUpdated=lt2021-01-18                                                                                                                                 | All                                                                               |     |
| Updated between dates     | \_lastUpdated=lt{date}&\_lastUpdated=gt{date}                                                                                      | http://localhost:3000/4_0_0/QuestionnaireResponse?_lastUpdated=gt2021-01-16&_lastUpdated=lt2021-01-17                                                                                                       | All                                                                               |     |
| By field and value        | {field name}={field value}                                                                                                         | http://localhost:3000/4_0_0/PractitionerRole?organization=-824888254&practitioner=1487831681                                                                                                                | All                                                                               |     |
| Before recorded date      | date=lt{date}                                                                                                                      | http://localhost:3000/4_0_0/Appointment?date=lt2021-09-19                                                                                                                                                    | Appointment                                                                        |     |
| After recorded date       | date=gt{date}                                                                                                                      | http://localhost:3000/4_0_0/Appointment?date=gt2021-09-19                                                                                                                                                    | Appointment                                                                        |     |
| By url                    | url={url}                                                                                                                          | http://localhost:3000/4_0_0/ValueSet?url=foo                                                                                                                                                                | ValueSet                                                                          |     |
| By code                   | code={system}&#124;{value}                                                                                                         | [http://localhost:3000/4_0_0/Observation/?code=http://www.icanbwell.com/cql/library&#124;BMI001](http://localhost:3000/4_0_0/Observation/?code=http://www.icanbwell.com/cql/library\|BMI001)            | Resources in https://www.hl7.org/fhir/R4B/searchparameter-registry.html#clinical-code |     |
| By date                   | date=lt{date}&date=gt{date}                                                                                                        | http://localhost:3000/4_0_0/Observation?date=gt2021-01-16&date=lt2021-01-17                                                                                                                                 | Resources in https://www.hl7.org/fhir/R4B/searchparameter-registry.html#clinical-date |     |

FHIR Specification: https://www.hl7.org/fhir/R4B/search.html.

### 1.6 Getting total count

By default, the FHIR server just returns the page of data was requested. However, you can request to get the total count of records that meet your query by passing the `_total=accurate` query parameter e.g.,
http://localhost:3000/4_0_0/Practitioner?source=http://somehealth.org/insurance&_count=10&_total=accurate

The total count will be returned in the `total` field of the `Bundle` that is returned.

**Note:** This is an expensive operation when the count of records that match your query is high. It is recommended to only request `total` when it is actually needed.

FHIR Specification: https://www.hl7.org/fhir/R4B/search.html#total

### 1.7 Enabling strict validation

By default, the FHIR server does not validate if a search parameter passed in a request is valid or not. Pass the header `handling=strict` to enable strict parameter validation. Default value of the header is `lenient` that does not perform the unsupported or unknown parameter validation. Ref: https://www.hl7.org/fhir/R4B/search.html#errors

### 1.8 Search Modifiers

|Parameter Type|Modifier         |Example                                                     |Description                               |
|--------------|-----------------|------------------------------------------------------------|------------------------------------------|
| All |
|     | missing | [base]/ExplanationOfBenefit?patient:missing=true | will match on all elements where either the underlying element is omitted or where the element is present with no value |
|     | not | [base]/4_0_0/Patient?_security:not=https://www.icanbwell.com/owner%7Cbwell | can be used to negate any search filter |
| ID |
|    | above | [base]/Observation?id:above=07ee0c18-a6c6-5b8e-b7ba-adb395447f52 | allows to fetch result for resources after specified id. Mainly used for pagination to get next page along with default or specified sorting order |
|    | below | [base]/Observation?id:below=07ee0c18-a6c6-5b8e-b7ba-adb395447f52 | allows to fetch result for resources before specified id. Mainly used for pagination to get previous page along with default or specified sorting order |
| String |
|        | exact | [base]/Patient?family:exact=Son | allows to indicate that a supplied string input is the complete and exact value that should be matched |
|        | contains | [base]/Patient?family:contains=son | allows to indicate that a supplied string input should be matched as a case-insensitive match anywhere in the target string |
| Token |
|       | text | [base]/Condition?code:text=headache | allows to indicate that a supplied string should be used to perform a string-search against the text associated with a code or value |
|       | of-type | [base]/Patient?identifier:of-type=http://terminology.hl7.org/CodeSystem/v2-0203\|MR\|446053 | can only be used with `identifier` field and allows to filter based on the Identifier.type.coding.system, Identifier.type.coding.code and Identifier.value.  The format when using 'of-type' is [system]\|[code]\|[value] and all three values are must. |
| Reference |
|           | [type] | [base]/Observation?subject:Patient=23 | allows to restrict the resource type of a reference. Provided example is similar to using [base]/Observation?subject=Patient/23 |


FHIR specification: https://www.hl7.org/fhir/R4B/search.html#modifiers

### 1.8 Search Prefixes

For parameter types of number, date, and quantity

|Prefix|Example                                                     |Description                                      |
|------|------------------------------------------------------------|-------------------------------------------------|
| ne |[base]/RiskAssessment?probability=ne0.8 | not equals: the value for the parameter in the resource is not equal to the provided value |
| gt |[base]/RiskAssessment?probability=gt1e2 | greater than: the value for the parameter in the resource is greater than the provided value |
| ge |[base]/RiskAssessment?probability=ge8 | greater than or equal to: the value for the parameter in the resource is greater or equal to the provided value |
| lt |[base]/RiskAssessment?probability=lt100.00 | less than: the value for the parameter in the resource is less than the provided value |
| le |[base]/RiskAssessment?probability=le5.40e-3 | less than or equal to: the value for the parameter in the resource is less or equal to the provided value |

FHIR specification: https://www.hl7.org/fhir/R4B/search.html#prefix

## 2. Requesting a single resource

Add the id of the resource in the url e.g.,
http://localhost:3000/4_0_0/HealthcareService/1952669236-MGB-MGTB

FHIR Specification: https://www.hl7.org/fhir/R4B/http.html#read

### 2.1 Getting history for a resource

Add `/_history` to a resource url to get the history of changes to that resource e.g.,
http://localhost:3000/4_0_0/HealthcareService/1952669236-MGB-MGTB/_history

## 3. Creating a resource

There are two ways to do this:

1. (Recommended) Use the [$merge](merge.md) endpoint which handles both creating a new resource and updating an existing resource. This is the recommended path to avoid the timing issue where someone else may add that resource between the time you checked the resource exists and sent the call to add it.
2. Use the POST method. You can POST the resource as the body to /4_0_0/{resource} e.g., /4_0_0/Patient.

FHIR Specification: https://www.hl7.org/fhir/R4B/http.html#create

## 4. Updating a resource

There are two ways to do this:

1. (Recommended) Use the [$merge](merge.md) endpoint which handles both creating a new resource and updating an existing resource. This is the recommended path to avoid the timing issue where someone else may update that resource between the time you checked the resource exists and sent the call to add it.
2. Use the PUT method. You can PUT the resource as the body to /4_0_0/{resource}/{id} e.g., /4_0_0/Patient/123
    - **Note:** This will completely replace the existing resource
3. Use the PATCH method.  http://hl7.org/fhir/R4B/http.html#patch
    - **Note:** You must pass the Content-Type as `application/json-patch+json` and the patch must be in JSONPatch format: https://jsonpatch.com/

FHIR Specification: https://www.hl7.org/fhir/R4B/http.html#update

### 4.1 Updating a set of resources

The [$merge](merge.md) method supports sending a list of resources (which can be of different resource types).

## 5. Deleting a resource

The DELETE method allows you to logically delete a resource. You can send a DELETE call to /4_0_0/{resource}/{id} e.g., /4_0_0/Patient/123

FHIR Specification: https://www.hl7.org/fhir/R4B/http.html#delete

## 6. Requesting a graph of related resources

Requesting resources and then requesting the related resources can result in many calls which can be slow. The FHIR server provides the $graph endpoint to do this in one call.

Use the [$graph](graph.md) endpoint to get a resource and the specified related resources. The requested graph is passed in as GraphDefinition in the body and all the resources are returned in a `Bundle`.

**Note:** You can pass in a list of resource ids in the `id` parameter to get the graphs for multiple resources.

For example: https://fhir.dev.bwell.zone/4_0_0/Organization/$graph?id=733797173,1234&contained=true

## 7. Authentication

FHIR Server uses OAuth Authentication. You can authenticate either:

1. Service to Service via a `client id` and `client secret`
2. As a User via a `user id` and `password`

See [Security](security.md) for details.

## 8. Authorization

FHIR Server uses the SMART on FHIR scopes:

1. user/{resource}.{read or write} e.g., `user/Patient.read`
    - This determines what resource types you can access and whether you can read or write (or both)
2. access/{access tag}._ e.g., `access/my_client._`
    - This determines which resources you can access within a resource type.

See [Security](security.md) for details.

## 9. Additional Notes for FHIR Server

- The request body sent to FHIR Server is parsed using `express.json()` method which updates the values of decimals in accordance with IEEE 754 floating-point standard.
    - This provides approximately 15-17 significant decimal digits of precision
    - The exact number of decimal places preserved depends on the magnitude of the number
    - This will be updated in future in accordance with FHIR Standard: [https://www.hl7.org/fhir/R4B/json.html#decimal](https://www.hl7.org/fhir/R4B/json.html#decimal)

## Fhir Client SDK

This is a python package that can make it easier to talk to FHIR servers. Note this is optional; You can talk to our FHIR server using standard HTTP REST API.

https://github.com/icanbwell/helix.fhir.client.sdk

This SDK encapsulates all the aspects of calling the FHIR API so you can just call Python functions.

The SDK handles:

1. Authentication to FHIR server
2. Renewing access token when it expires
3. Retry when there are transient errors
4. Un-bundling the resources received from FHIR server
5. Paging
