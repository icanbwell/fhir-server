# Security

## High Level Sequence

![](https://www.websequencediagrams.com/cgi-bin/cdraw?lz=dGl0bGUgRkhJUiBTZXJ2ZXIvQ2xpZW50IEFwcCBBdXRob3J6YXRpb24KAA4KLT4AEwZpABQGADIHKHMpOgAtBSBUb2tlbiBSZXF1ZXN0CgAVFy0-AF8KOiBSZWNlaXZlcwA2CwBkDQCBFgs6IEdyYXBoUUwvUmVzb3VyY2UAYwggdy8ANAsKAIFKCy0tPj4rAIEcGUxvYWRzIEpXS3MAgRQZLT4-LQB4DABQDgCBEQ5WZXJpZnkAgX8MYWdhaW5zdACCWwcnAGcFUyBrZXlzADkOTW9uZ29EYjogUXVlcnkgZm9yIHIAgkAGZWQAgx4GcgCBbAcKACQHAIILD1JldHVybgAcDwCBHQ0AgmcOACkFAEwX&s=default)

### Configuring OAuth for a FHIR server


The FHIR server implements OAuth for authentication purposes. To configure OAuth, you need to set the following environment variables:

1. AUTH_JWKS_URL: This variable specifies the URL where the public keys of the OAuth provider can be obtained. These keys are used to verify the signatures of JWT tokens issued by the OAuth provider. E.g., https://cognito-idp.us-east-1.amazonaws.com/us-east-1_<cognito-id>/.well-known/jwks.json.
2. AUTH_CODE_FLOW_URL: This variable is used to specify the URL of the OAuth provider's authorization endpoint for the Authorization Code Flow. This endpoint is where users are redirected to authorize the application.
3. AUTH_CODE_FLOW_CLIENT_ID: This variable holds the client ID of the application registered with the OAuth provider. This ID is used during the OAuth process to identify the application.
4. AUTH_CONFIGURATION_URI: This variable specifies the URI where the OAuth provider's configuration can be obtained. This configuration typically includes important details such as authorization endpoint URLs, token endpoint URLs, supported OAuth flows, and other OAuth-related settings.
5. EXTERNAL_AUTH_JWKS_URLS: This variable is used to specify the additional URLs where the public keys (JWKS) of other user pools(oauth providers) can be obtained. These keys are used to verify the signatures of JWT tokens issued by the authentication providers.

These environment variables allow the FHIR server to interact with the OAuth provider for authentication purposes.

#### Configuring OAuth using AWS Cognito
1. To set up OAuth2 authentication with AWS Cognito, start by creating a user pool in the AWS Cognito console. Configure the user pool settings, including user attributes, authentication methods, and app clients.
2. FHIR server can trust multiple user pools(OAuth servers). A user pool is trusted if FHIR's server configuration includes the url to get public keys for that user pool. Basically the AUTH_JWKS_URLS and EXTERNAL_AUTH_JWKS_URLS.
3. Obtain the App client ID and App client secret provided by AWS Cognito.
4. To obtain the required variables: AUTH_JWKS_URL, AUTH_CODE_FLOW_URL, and AUTH_CODE_FLOW_CLIENT_ID, you can find them in your AWS Cognito user pool settings.

#### Configuring OAuth using Auth0
1. To set up OAuth2 authentication with Auth0, begin by creating an account and application on the Auth0 platform. Configure your application settings to specify callback URLs and other necessary details.
2. Obtain the Client ID and Client Secret provided by Auth0 for your application.
3. To obtain the required variables: AUTH_JWKS_URL, AUTH_CODE_FLOW_URL, and AUTH_CODE_FLOW_CLIENT_ID, you can find them in your Auth0 application settings.
4. AUTH_CONFIGURATION_URI typically points to the OAuth2 discovery document provided by Auth0.
5. If using multiple authentication providers, obtain the EXTERNAL_AUTH_JWKS_URLS from each provider's documentation.


The FHIR server supports the `well-known configuration` feature so you can get the token-url from the FHIR server. (The helix.fhir.client.sdk does this automatically)

http://localhost:3000/.well-known/smart-configuration

## 2. Authentication

### 2.1 Standards
OAuth 2.0 standard controls authorization to a protected resource via scopes.

OpenID Connect standard builds on OAuth 2.0 and adds authentication and user information.

SMART on FHIR builds on OpenID Connect and defines standard scopes for FHIR: user and patient

b.well FHIR server builds on SMART on FHIR and adds additional scopes: admin, access

### 2.2 Types of tokens in OAuth
In OAuth, there are two types of tokens (https://auth0.com/blog/id-token-access-token-what-is-the-difference/):
1. access token: used to provide access
2. id token: provides identification information for the user [Not supported in FHIR Server]

### 2.3 OAuth Claims and Scopes
In OAuth, claims are attributes inside the tokens that assert something about the service/user connecting e.g., name, who issued the token etc.

Scopes are a type of claim that specify permissions for the current service/user.

https://auth0.com/docs/get-started/apis/scopes/openid-connect-scopes


### 2.4 Types of Authentication
This FHIR server supports three types of authentication:

#### 2.4.1 Service to Service Auth
This is used by a service to talk to the FHIR server. 

This uses the OAuth Client Credentials workflow (https://www.oauth.com/oauth2-servers/access-tokens/client-credentials/).

Once a new service account has been created in OAuth provider, the service uses a client id and client secret to get an OAuth access token. This token is passed in every call to the FHIR server as a bearer token in the Authorization header.

The following scopes are allowed in this access token:
1. user (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `user/Patient.read`
2. access (see Access Control section below) e.g., `access/aetna.*`

An optional admin scope can be passed to enable access to admin functions e.g., `admin/*.*`.

FHIR server will automatically restrict the data returned to data that is permitted to be returned to this service account by looking at the user and access scopes.

#### 2.4.2 Admin user to Service Auth
This is used by FHIR administrators and testers to view FHIR server data for troubleshooting and testing.

Once a new user account has been created in OAuth provider, users use their username and password to login. Multi-factor authentication can be enabled when the user account is created.

If users are accessing the FHIR server Web UI then they are automatically redirected to the login page.

If users are accessing the FHIR server via REST or GraphQL then they can first get an OAuth token by logging in with username and password and then pass that token as a Bearer token in the Authorization header.

The following scopes are allowed in this access token:
1. user (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `user/Patient.read`
2. access (see Access Control section below) e.g., `access/aetna.*`

An optional admin scope can be passed to enable access to admin functions e.g., `admin/*.*`.

FHIR server will automatically restrict the data returned to data that is permitted to be returned to this user account by looking at the user and access scopes.

#### 2.4.3 Person/Patient Auth
This is used when an end user is accessing their own data (potentially via a microservice or an app).

This uses the SMART on FHIR standard on top of OAuth2 (https://www.hl7.org/fhir/smart-app-launch/app-launch.html)

Once the person/patient account has been created in OAuth provider, the client app can bring up the login screen for the end user to enter their username and password.  The OAuth server will send the authorization code to the client app.  The client app can exchange the authorization code for a token from the OAuth server. https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow

The following scopes are allowed in the access token:
1. patient (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `patient/*.read`

The client app can then pass this token to the FHIR server as a bearer token in the Authorization header.

The access token must have all of the following attributes:
1. clientFhirPersonId

This attribute defines the person accessing the FHIR server.

FHIR server will restrict the data returned to only data belonging to that Person by looking at the Person id in the provided token.

#### 2.4.3.1 Actor accessing on behalf of Person Auth
This is used when an actor (like RelatedPerson, CareTeam) acts on behalf of the actual person.

This will give actor access to the person data with some restrictions as mentioned in their consent.

- Scopes will work the same as for a patient token, with restrictions
- No active consent will lead to unauthorized error
- Access only to non-sensitive and specific sensitive category resources mentioned in Consent
- write Operation not allowed irrespective of scopes

For more info check: [Delegated Access](./delegatedActorAccess.md)


#### 2.5 How to pass tokens
Tokens can be passed in three ways in an HTTP request:
1. In Authorization header as a bearer token (access token only)
2. In secure cookie (set by FHIR Server in case of GraphQL Playground)
3. As a `token` query string parameter (discouraged because it can be intercepted more easily)

### 3.1 Steps

1. Caller calls the FHIR server without Access Token
2. FHIR server returns `Unauthorized` error code
3. (Note: Step 1 & 2 can be skipped by the caller by acquiring an access token before calling the FHIR server)
4. Caller calls OAuth server token url specified in well-known configuration and passes in their `client id` and `client secret`.
5. OAuth server returns Access Token
6. Caller calls the FHIR server passing the Access Token (e.g., http://localhost:3000/4_0_0/Patient)
7. FHIR Server decrypts and verifies the Access Token using the public keys from OAuth server. It also checks the Access Token is not expired.
8. Then we continue with the Authorization flow below

Note: The Access Token expires so if the caller gets an `Unauthorized` error code on any call to the FHIR server they should get a new Access Token from OAuth Server.

#### 3.2 Example Code

Javascript:

```javascript
var request = require('request');
var options = {
    method: 'POST',
    url: 'http://localhost:8080/realms/master/protocol/openid-connect/token',
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
    },
    form: {
        grant_type: 'client_credentials',
        scope: 'user/*.read access/*.read',
        client_id: '[put client id here]',
        client_secret: '[put client secret here]',
    },
};
request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body);
});
```

Python:
We recommend using the FHIR Client SDK: https://github.com/icanbwell/helix.fhir.client.sdk

### 4. Authorization

The b.well FHIR server implements the SMART on FHIR authorization workflow: http://www.hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html


#### 4.1 Steps

1. After the Authentication part above is done
2. FHIR Server extracts the scopes from the Access Token
3. FHIR Server checks that the scopes in the Access Token allow the operation the caller is requesting
4. If no scope allows the operation then an error is returned

#### 4.2 Example

Javascript:

```javascript
var request = require('request');
var options = {
    method: 'GET',
    url: 'http://localhost:3000/4_0_0/Patient',
    headers: {
        Authorization: 'Bearer [put access token from above here]',
    },
};
request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body);
});
```

### 5. Access Control via user, access and patient scopes

FHIR Server has three mechanisms to control access:

1. Control access by resource
2. Control access by security tags
3. Control access by patient data graph

All the above mechanisms are implemented using the scopes mechanism in SMART on FHIR.

When a user authenticates with the FHIR server they pass in a token they have received after authenticating with OAuth Server. See above for details.

This token contains a list of scopes that have been granted to this `client_id` in OAuth server. Note that the token is encrypted by OAuth server using a private key so it is not possible for clients to fake the scopes.

#### 5.1 Control access by resource

FHIR server looks for scopes that start with “user/”. These are in the form of user/<resource|_>.<read|write|_> e.g., `user/Practitioner.read`. This scope grants the client the permission to read the Practitioner resources.

In addition we support wildcard scopes e.g., `user/*.*` or `user/*.read`. The former gives the user the permission to read or write any resource and the latter gives the user the right to read any resource.

#### 5.2 Control access by security tags

**Note**: This is an enhancement that we've made to FHIR.

In addition to giving users permissions to access resources, we can also control what data in those resources the user can access. All resources in the b.well FHIR server must specify access tags.

The FHIR server looks for scopes that start with “access/”. These are in the form `access/<access code>.*` e.g., `access/somehealth.*` This scope grants the user access to resources where the security access tag is set to somehealth.

A user can have multiple access scopes and they will have permission to resources that match EITHER access code.

##### 5.2.1 Security tags in FHIR data

Every resource in the FHIR server is tagged with security tags:

1. owner: which entity owns this resource.
2. access: which entities can access this resource

Here's an example meta field of a resource:

```json
"meta": {
      "source": "https://www.myealth.com/membership",
      "security": [
        {
          "system": "https://www.icanbwell.com/owner",
          "code": "myhealth"
        },
        {
          "system": "https://www.icanbwell.com/access",
          "code": "myhealth"
        },
        {
          "system": "https://www.icanbwell.com/access",
          "code": "yourhealth"
        }
      ]
    }
```

#### 5.3 Control access by patient data graph

The FHIR server looks for the patient scopes that start with "patient/”. Patient scopes look like `patient/{resourceType}.{permissions}` and denotes that access to the patients data who are related to the `bwellFhirPersonId` in the JWT Token is permitted according to the permissions mentioned.

If someone has scopes like `patient/Observation.read` then that person has read access to Observation resources of the patients related to master person.

#### 5.4 Access

Note that the final access for a user is a combination of both present in 5.1[Control access by resource] & 5.2[Control access by security tags] or only by using 5.3[Control access by patient data graph] only

#### 5.5 Examples

##### 5.5.1 Example 1

The scopes provided are:

```
user/Practitioner.read user/Practitioner.write user/Organization.read access/somehealth.* access/goodhealth.*
```

This means:

1. User can read Practitioner and Organization resources
2. User can write to Practitioner resource only
3. When reading or writing, the user can access all the resource having security access tag: somehealth or goodhealth

##### 5.5.2 Example 2

The scopes provided are:

```
user/*.* access/*.*
```

This means the user can read/write ANY resource and there is no restriction by security tags either.

##### 5.5.3 Example 3

The scopes provided are:
```
patient/*.read
```
User can read all Patient related Resource linked via bwellPersonID EMPI Tree & the non-Patient resources.

```
patient/*.read user/*.read access/*.read
```
User can read all Patient related Resource linked via bwellPersonID EMPI Tree & the non-Patient resources. NOTE: Here `user` & `access` tags are ignored due to patient scope being present.

Note: With patient scopes, User can not write(create/update/delete) on non-patient resources.

#### 5.6 Multiple scopes

NOTE: Multiple scopes must be separate by space (NOT comma) per the OAuth spec: https://datatracker.ietf.org/doc/html/rfc6749#section-3.3

#### 5.6 Patient scope

The patient scope provides access to resources that are associated with the ID from the JWT or contain no patient data. See `src/fhir/patientFilterManager.js` to view or update this security configuration.


#### 6.1 Patient-associated resources

For resources that are associated with a Patient, see `patientFilterMapping` (in `src/fhir/patientFilterManager.js`).

The path to the patient reference is specified for each resource type. Access will be granted or denied based on whether the ID in that specified path indicates a patient that the caller has access to.

#### 6.2 Resources without patient data

For resources that are not associated with a Patient, access will be granted or denied based on the user and access scopes.

#### 6.3 Subscription related resources in case of Patient scope

The subscription-related resources — Subscription, SubscriptionStatus, and SubscriptionTopic — have custom logic with patient scope. Since these resources do not have a direct patient reference, we manually linked them to the patient using extension and identifier fields.
For Subscription & SubscriptionStatus resources we match field `url` with value `https://icanbwell.com/codes/client_person_id` along with `valueString` field containing id of person(from JWT token) in `extension`. Whereas in case of SubscriptionTopic we match `system` with value `https://icanbwell.com/codes/client_person_id` along with `value` field containing id of person(from JWT token) in `identifier`.

### 7. Local Authentication

[Keycloak](https://www.keycloak.org/) is used for providing authentication for running FHIR Server on local with all the needed scopes and jwt payload data.
Keycloak UI can be accessed at [http://localhost:8080](http://localhost:8080) with credentials `admin-user` & `password`.

- For obtaining service account token, following cURL can be used:
```
curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials
```

- For user token (patient scoped token):
Note: for using patient token, corresponding client person and patient must be added in database.
The patient token have following default payload which can be configured via (docker-compose.yml)[../docker-compose.yml]


TODO: This will change since we are deprecating other fields
```
{
  "clientFhirPatientId": "22aa18af-af51-5799-bc55-367c22c85407",
  "bwellFhirPatientId": "668d0748-1484-4bba-9cbe-0faf0de8965c",
  "clientFhirPersonId": "0b2ad38a-20bc-5cf5-9739-13f242b05892",
  "bwellFhirPersonId": "0eb80391-0f61-5ce6-b221-a5428f2f38a7",
}
```
```
curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data username=patient \
  --data password=password \
  --data grant_type=password
```

- For adding any custom scopes to token, following cURL can be used with the scope needed
```
curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/*.* access/*.* patient/Observation.read admin/*.*'
```

#### Using with FHIR UI
When using with https://github.com/icanbwell/fhir-server.ui

For authentication following credentials can be used, which can be configured from [docker-compose.yml](../docker-compose.yml)

For admin account: `admin` & `password`

For patient account: `patient` & `password`
