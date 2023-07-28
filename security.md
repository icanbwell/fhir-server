# Security

## High Level Sequence

![](https://www.websequencediagrams.com/cgi-bin/cdraw?lz=dGl0bGUgRkhJUiBTZXJ2ZXIvQ2xpZW50IEFwcCBBdXRob3JpemF0aW9uCgoAEAotPgAODQA0ByhzKToALwUgVG9rZW4gUmVxdWVzdAoAFRctPgBhCjogUmVjZWl2ZXMANgsAZA0AgRgLOiBHcmFwaFFML1Jlc291cmNlAGMIIHcvADQLAIFLCwCBFhtWZXJpZnkAgSwMYWdhaW5zdACBcQ4AghgHIEpXS1Mga2V5cwCBPRoAgR4NAIIFCwBlBWllZACBCw5Nb25nb0RiOiBRdWVyeSBmb3IgcgCCMwZlZACDEwZyAIFfBwoAJAcAgX4PUmV0dXJuABwPAIFvDQCCWg4AKQUASxgKCg&s=default)

### Get OAuth Url for a FHIR server

Helix FHIR server supports the `well-known configuration` feature so you can get the token-url from the FHIR server. (The helix fhir client sdk does this automatically)

https://fhir.icanbwell.com/.well-known/smart-configuration

## 2. Authentication

### 2.1 Standards
OAuth 2.0 standard controls authorization to a protected resource via scopes.

OpenID Connect standard builds on OAuth 2.0 and adds authentication and user information.

SMART on FHIR builds on OpenID Connect and defines standard scopes for FHIR: user, patient and launch

b.well FHIR server builds on SMART on FHIR and adds additional scopes: admin, access

### 2.2 Types of tokens in OAuth
In OAuth, there are two types of tokens (https://auth0.com/blog/id-token-access-token-what-is-the-difference/):
1. access token: used to provide access
2. id token: provides identification information for the user

Id token is used only for Person/Patient Authentication scenario below.

### 2.3 OAuth Claims and Scopes
In OAuth, claims are attributes inside the tokens that assert something about the service/user connecting e.g., name, who issued the token etc.

Scopes are a type of claim that specify permissions for the current service/user.

https://auth0.com/docs/get-started/apis/scopes/openid-connect-scopes


### 2.4 Types of Authentication
This FHIR server supports three types of authentication:

#### 2.4.1 Service to Service Auth
This is used by a service to talk to the FHIR server. 

This uses the OAuth Client Credentials workflow (https://www.oauth.com/oauth2-servers/access-tokens/client-credentials/).

Once a new service account has been created in OAuth provider, the service uses a client id and client secret to get an OAuth access token.  This token is passed in every call to the FHIR server as a bearer token in the Authorization header.

The following scopes are required in this access token:
1. user (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `user/Patient.read`
2. access (see Access Control section below) e.g., `access/aetna.*`

An optional admin scope can be passed to enable access to admin functions e.g., `admin/*.*`.

FHIR server will automatically restrict the data returned to data that is permitted to be returned to this service account by looking at the user and access scopes.

#### 2.4.2 Admin user to Service Auth
This is used by FHIR administrators and testers to view FHIR server data for troubleshooting and testing.

This uses the OpenID Connect standard on top of OAuth2 (https://openid.net/connect/).

Once a new user account has been created in OAuth provider, users use their username and password to login.  Multi-factor authentication can be enabled when the user account is created.

If users are accessing the FHIR server Web UI then they are automatically redirected to the login page.

If users are accessing the FHIR server via REST or GraphQL then they can first get an OAuth token by logging in with username and password and then pass that token as a Bearer token in the Authorization header.

The following scopes are required in this access token:
1. user (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `user/Patient.read`
2. access (see Access Control section below) e.g., `access/aetna.*`

An optional admin scope can be passed to enable access to admin functions e.g., `admin/*.*`.

FHIR server will automatically restrict the data returned to data that is permitted to be returned to this user account by looking at the user and access scopes.

#### 2.4.3 Person/Patient Auth
This is used when an end user is accessing their own data (potentially via a microservice or an app).

This uses the SMART on FHIR standard on top of OAuth2 (https://www.hl7.org/fhir/smart-app-launch/app-launch.html)

Once the person/patient account has been created in OAuth provider, the client app can bring up the login screen for the end user to enter their username and password.  The OAuth server will send the authorization code to the client app.  The client app can exchange the authorization code for a token from the OAuth server. https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow

The following scopes are required in the access token:
1. launch (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `launch/patient`
2. patient (http://hl7.org/fhir/smart-app-launch/1.0.0/scopes-and-launch-context/index.html) e.g., `patient/*.read`

The client app can then pass this token to the FHIR server as a bearer token in the Authorization header.

Passing the id token is optional.  If the id token is not passed then the FHIR server will automatically ask the OAuth server to get it via the /userInfo functionality of OpenID Connect (https://openid.net/specs/openid-connect-userinfo-vc-1_0.html).

If the id token is passed, it must be passed in the `x-bwell-identity` header.

The id token must have ONE of the following custom attributes:
1. custom:bwellFhirPersonId
2. custom:bwell_fhir_id
3. custom:bwell_fhir_ids

These attributes define the person or patient accessing the FHIR server.

FHIR server will restrict the data returned to only data belonging to that person or patient by looking at the Person or Patient id in the id token.

#### 2.5 How to pass tokens
Tokens can be passed in four ways in an HTTP request:
1. `x-bwell-identity` header (id token only)
2. In Authorization header as a bearer token (access token only)
3. In secure cookie (set by FHIR Server Web UI)
4. As a `token` query string parameter (discouraged because it can be intercepted more easily)

### 3.1 Steps

1. Caller calls the FHIR server without Access Token
2. FHIR server returns `Unauthorized` error code
3. (Note: Step 1 & 2 can be skipped by the caller by acquiring an access token before calling the FHIR server)
4. Caller calls OAuth server token url specified in well-known configuration and passes in their `client id` and `client secret`.
5. OAuth server returns Access Token
6. Caller calls the FHIR server passing the Access Token (e.g., https://fhir.icanbwell.com/4_0_0/Patient)
7. FHIR Server decrypts and verifies the Access Token using the public keys from OAuth server. It also checks the Access Token is not expired.
8. Then we continue with the Authorization flow below

Note: The Access Token expires so if the caller gets an `Unauthorized` error code on any call to the FHIR server they should get a new Access Token from OAuth Server.

#### 3.2 Example Code

Javascript:

```javascript
var request = require('request');
var options = {
    method: 'POST',
    url: 'https://fhir-bwell.auth.us-east-1.amazoncognito.com/oauth2/token',
    headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
    },
    form: {
        grant_type: 'client_credentials',
        scope: 'user/*.read',
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
    url: 'https://fhir.icanbwell.com/4_0_0/Patient',
    headers: {
        Authorization: 'Bearer [put access token from above here]',
    },
};
request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body);
});
```

Python:

We recommend using the FHIR Client SDK: https://github.com/icanbwell/helix.fhir.client.sdk

### 5. Access Control via user and access scopes

FHIR Server has two mechanisms to control access:

1. Control access by resource
2. Control access by security tags

Both mechanisms are implemented using the scopes mechanism in SMART on FHIR.

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
3. vendor: which entity sent this resource

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
        },
        {
          "system": "https://www.icanbwell.com/vendor",
          "code": "datasender"
        }
      ]
    }
```

#### 5.3 Access

Note that the final access for a user is a combination of both of the above methods.

#### 5.4 Examples

##### 5.4.1 Example 1

A user has scopes:

```
user/Practitioner.read user/Practitioner.write user/Organization.read access/somehealth.* access/goodhealth.*
```

This means:

1. User can read Practitioner and Organization resources
2. User can write to Practitioner resource only
3. When reading or writing, the user can access any resource where the security access tag is somehealth or goodhealth only

##### 5.4.2 Example 2

A user has scopes:

```
user/*.* access/*.*
```

This means the user can read/write ANY resource and there is no restriction by security tags either.

### 5.5 Multiple scopes

NOTE: Multiple scopes must be separate by space (NOT comma) per the OAuth spec: https://datatracker.ietf.org/doc/html/rfc6749#section-3.3

### 5.6 Patient scope

The patient scope provides access to resources that are associated with the ID from the JWT or contain no patient data. See `src/fhir/patientFilterManager.js` to view or update this security configuration.

#### 6.1 Patient-associated resources

For resources that are associated with a Patient, see `patientFilterMapping` (in `src/fhir/patientFilterManager.js`).

The path to the patient reference is specified for each resource type. Access will be granted or denied based on whether the ID in that specified path indicates a patient that the caller has access to.

#### 6.2 Resources without patient data

For resources that are not associated with a Patient, see `resourcesWithoutPatientData` (in `src/fhir/patientFilterManager.js`).

Each resource listed in this collection has no patient data, but it may be useful information that patient data might reference. So it can be accessed by callers with the patient scope, without regard to specific patient IDs.
