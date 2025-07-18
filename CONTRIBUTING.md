# Contributing

You will need:

1. Docker Desktop: https://docs.docker.com/desktop/mac/install/
2. Node.js 24.1: https://nodejs.org/en/download/releases/ or use brew: https://nodejs.org/tr/download/package-manager/#macos

On Macs:
1. Install brew (https://brew.sh/) if not already installed: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
2. `brew install nvm`
3. Add the content into ~/.zshrc as suggested by above
4. Close shell window and open again
5. `nvm install`
6. `nvm use`
7. `npm install -g yarn`
8. `yarn install`


## Common developer processes

### Run lint

Run `make lint` to do lint checking

### Run unit tests

Run `make tests` to run all the tests locally. Or click a test in PyCharm and choose "Run test".

##### Running Specific test cases
1. To run a specific test file, update `filePath` in the below command with path to the file
`nvm use && node node_modules/.bin/jest filePath`
2. To run a specific test from a test file, update `filePath` and `testName` in the below command with path to the file and the test description for the testcase to run
`nvm use && node node_modules/.bin/jest filePath -t "testName"`

Note: Logs are set to `SILENT` for unit tests in `jest/setEnvVars.js` file. If you want to enable logging for testcases you can change the `LOGLEVEL` env variable to `DEBUG` and for getting all the logs that might help tracing db calls you can change the `LOGLEVEL` env variable to `SILLY`.

### Using custom matchers in jest
- Jest Custom matchers are defined in: https://github.com/icanbwell/fhir-server/blob/main/src/tests/customMatchers.js
- Any Custom matcher defined needs to be registered in https://github.com/icanbwell/fhir-server/blob/main/src/tests/testSetup.js before it can be used.

1. toHaveMongoQuery

   Matches the Mongo query received in the response from the FHIR server with the provided expected response by extracting the query object and sorting any array values. This ensures that test failures caused by the varying order of IDs between test runs are eliminated.
   Must be used before the `toHaveResponse` as it matches the query and removes them from received and expected results allowing test of toHaveResponse to pass.

### Update packages

To add a new package or update version of a package, edit package.json and then run `make update` to regenerate `yarn.lock` file.

### Bring up FHIR server locally for manual testing

Run `make up` to bring up the fhir server in docker on your local machine. Click the links shown to access the FHIR server. You can also use PostMan to make queries to the local FHIR server.

### Auto created mongo collections

Running `make up` also creates all the resource collections in mongo along with their indexes.
This id done only once and in case this needs to be run again `make create_all_collections` command can be used after running `make up`

## Project Layout

[.github/](.github/): workflows for Github Actions

[jest/](jest/): configs for jest test runner

[src/dist](src/dist): distribution of assets (css, icons & js) for bootstrap.js

[src/enrich](src/enrich): enrichment handlers that can enrich fhir resources before they are returned to callers

[src/graphql](src/graphql): implements GraphQL schemas and resolvers. Code-generated by [src/graphql/generator/generate_classes.py](src/graphql/generator/generate_classes.py). See [graphql.md](graphql.md) for more details.

[src/graphs](src/graphs): GraphDefinition resources for getting a graph (a resources and its related resources) in one call

[src/indexes](src/indexes): Implements adding indexes in mongodb. When a new collection is created or you use the `/index` endpoint this is called.

[src/lib](src/lib): Helper classes

[src/middleware/](src/middleware/): Node.js Express middleware classes that intercept requests and perforrm some action on it.

[src/oauth](src/oauth): HTML page that is shown when the user is redirected by a OAuth provider

[src/operations](src/operations): Each folder implements a particular operation in FHIR (e.g., get all resources, update a resource etc). [FHIR Spec](https://www.hl7.org/fhir/operations.html)

[src/routeHandlers](src/routeHandlers): Non-FHIR routes (e.g., logout, show stats)

[src/searchParameters](src/searchParameters): Code-generated information about all the FHIR search parameters (https://www.hl7.org/fhir/searchparameter-registry.html). Called by r4.js to implement searching. Code-generation script: [generatorScripts/searchParameters/generate_search_parameters.py](generatorScripts/searchParameters/generate_search_parameters.py)

[src/services](src/services): Code-generated route handlers for each FHIR resource. Code generation script: [generatorScripts/generate_services.py](generatorScripts/generate_services.py)

[src/strategies](src/strategies): Authentication strategies for OAuth. We use Passport (http://www.passportjs.org/) to implement OAuth.

[src/tasks](src/tasks): Asynchronous long running tasks that can be kicked off. These run in a separate process so they are not subject to HTTP request timeouts

[src/tests](src/tests): Unit tests using the jest test runner. You can generate a new unit test by using the template called FHIR Test.

[src/utils](src/utils): Utility functions called from other code

[src/app.js](src/app.js): Main entrypoint that sets up the app

[src/app.test.js](src/app.test.js): simple test for the app

[src/config.js](src/config.js): Configuration for the app

[src/constants.js](src/constants.js): Defines constants used in the app

[src/index.js](src/index.js): Implements the main function

[src/profiles.js](src/profiles.js): Specifies the FHIR profiles. Code-generated by [generatorScripts/generate_services.py](generatorScripts/generate_services.py)

[.dockerignore](.dockerignore): files to exclude from docker image

[docker-compose.yml](docker-compose.yml): Docker compose file that brings up this app and related services (e.g., mongo db). This is only used for local development and NOT in production since we use AWS Managed MongoDB (DocumentDB) in production.

[Dockerfile](Dockerfile): Defines the docker image we run locally AND deploy into production.

[jest/setEnvVars.js](jest/setEnvVars.js): Environment variables used when running tests

[package.json](package.json): Specifies the npm packages to use and commands for running tests

[yarn.lock](yarn.lock): Generated from package.json

## Indexing
The process for adding/updating an index:
1. Edit [src/indexes/customIndexes.js](src/indexes/customIndexes.js) to add your indexes
2. Commit to main
3. There are two ways to apply these indexes to Mongo:
   1. For small collections, you can run indexing by going to `/index/run` url endpoint. To drop and create indexes use the `/index/rebuild` endpoint.
   2. For larger collections, run the admin script [src/admin/scripts/indexCollections.js](src/admin/scripts/indexCollections.js) using the instructions in Admin Scripts section above.
4. These will check for any missing indexes and add them to mongo.

Note: Indexes are automatically created when a new resource type is added to the server (if the `CREATE_INDEX_ON_COLLECTION_CREATION` environment variable is set).


## Index hinting

Some mongo implementations (such as AWS DocumentDB) are not very good at selecting an index to serve a query. Hence we've added an index hinting feature that compares the columns in the query with the existing indexes and adds a hint to mongo to use that index. This feature can be turned on by setting the `SET_INDEX_HINTS` environment variable.

## IoC (Inversion of Control)

This project uses IoC (inversion of control). The container is defined in [SimpleContainer](src/utils/simpleContainer.js).

The container is set up in [src/createContainer.js](src/createContainer.js).  
This is where all the classes are instantiated with the parameters to other classes.

If you add a new class, you can instantiate it here.

If you add a new parameter to an existing class, you can pass it here.

For testing, you can override the classes in the container in [src/tests/createTestContainer.js](src/tests/createTestContainer.js).
This allows you to test the code by swapping out classes with your mock classes.

See MockKafka client for an example.

## Admin Scripts
This project has admin scripts in [src/admin/scripts](src/admin/scripts).

To run the admin scripts, you can start on any linux machine.

### First time setup

#### 1. Install Git
```shell
sudo apt-get update
sudo apt-get install git
```

#### 2. install NVM (Node Version Manager)
```shell
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
```

#### 3. restart your computer

#### 4. install node
```shell
nvm install
nvm use
npm install -g npm@latest
```

#### 5. Get code
```shell
git clone https://github.com/icanbwell/fhir-server.git
cd fhir-server
```

#### 6. install npm packages
```shell
npm install
```

#### 7. set up credentials to connect to mongo
```shell
cp src/admin/scripts/.env.template src/admin/scripts/.env
nano src/admin/scripts/.env
```

#### 8. Run the admin script e.g.,
```shell
NODE_OPTIONS=--max_old_space_size=1609600 node --max-old-space-size=1609600 src/admin/scripts/partitionAuditEvent.js --from=2022-08-01 --to=2022-09-01 --batchSize=10000
```

### Getting latest from Github
```shell
git pull
```

#### if you have local changes  you can roll them back using
```shell
git reset --hard
```

#### if you want to use a branch different than main
```shell
git clone --branch separate_partitioners_into_classes --single-branch https://github.com/icanbwell/fhir-server.git
```

## Access indexes
A number of queries include searching on security tags:

https://fhir.staging.icanbwell.com/4_0_0/AuditEvent?_elements=id&_security=https://www.icanbwell.com/access%7Cmyhealth

Since security tags is an array, Mongo is not able to figure out that this can be "covered" by the index (Each item in the array is stored as a separate entry in the index.)

To optimize this, the FHIR server stores an extra field called `_access` with each resource.  In the case, above there would be a value of `_access.myhealth: 1` stored in Mongo for this resource.

Note that for smaller tables the improvement is negligible so this technique is most beneficial for huge tables.

First set this environment variable to enable using access indexes in an environment:
```USE_ACCESS_INDEX: 1```

To specify that the access index should be used for a collection, you add the resource type to the environment variable:
```COLLECTIONS_ACCESS_INDEX: "AuditEvent"```

You can specify "all" if you want to apply this to all.  See [src/admin/scripts/createAccessIndexField.js](src/admin/scripts/createAccessIndexField.js) admin script to create the _access fields in old data.


Now the FHIR server will automatically rewrite the query for https://fhir.staging.icanbwell.com/4_0_0/AuditEvent?_elements=id&_security=https://www.icanbwell.com/access%7Cmyhealth from:
```javascript
db.AuditEvent_4_0_0.find({'$and':[{'meta.lastUpdated':{'$lt':ISODate('2022-09-14T00:00:00.000Z')}},{'meta.lastUpdated':{'$gte':ISODate('2022-09-13T00:00:00.000Z')}},{'meta.security':{'$elemMatch':{'system':'https://www.icanbwell.com/access','code':'client'}}}]}, {'id':1,'_id':0}).sort({'id':1}).limit(200)
```
to:
```javascript
db.AuditEvent_4_0_0.find({'$and':[{'meta.lastUpdated':{'$lt':ISODate('2022-09-14T00:00:00.000Z')}},{'meta.lastUpdated':{'$gte':ISODate('2022-09-13T00:00:00.000Z')}},{'_access.client':1}]}, {'id':1,'_id':0}).sort({'id':1}).limit(200)
```

Since this will now use the _access field, it will be "covered" by our index so Mongo can return the ids completely from the index without needing to go to the actual data.

If you have old data that did not have this _access field, then you can run an admin script to add this to existing data.
    
## Admin UI
This FHIR server provides an admin UI at `/admin`.  There are various tools here for administration.

To access the admin tools you need the `admin/*.read` scopes in your OAuth login.

### Log Lookup Admin UI
Here you can enter the X-Request_Id the FHIR server returns and be able to see the logs relating to that request.

### Index Management UI
Here you can see:
1. What the current indexes are
2. Which indexes are mismatched between the config [src/indexes/customIndexes.js](src/indexes/customIndexes.js) and the underlying databases.
3. Synchronize the indexes between the config and the databases by creating any missing indexes and removing any extraneous indexes.

## Logging
Logging in FHIR server is implemented using Winston[https://www.npmjs.com/package/winston] to log in JSON format. Reason to use this is to enhance & unify the fhir server logging.

The default configuration for winston logger is in: https://github.com/icanbwell/fhir-server/blob/master/src/winstonInit.js. Child loggers are used to implement logging for admin logs & fhir server logs.

### How to use
1. Import functions from: https://github.com/icanbwell/fhir-server/blob/master/src/operations/common/logging.js as per requirement. 
2. Functions logInfo, logDebug, logError & logWarn take 2 arguments 'message' & 'args', where 'message' is a string & args take object arguments. Any number of args can be send according to the requirement.
For example: 
```
logInfo('Logger Message', {user});
```
Output: 
```
{"dd":{"service":"bwell-fhir-server","version":"0.0.1"},"level":"info","logger":"default","message":"Logger Message","timestamp":"Feb-10-2023 10:10:10+00:00","user":{"name":"Demo name"}}
```

## Admin Logger
Admin logger can be used by making instance of class `AdminLogger` class. Then you can use `logInfo` & `logError` methods accordingly.
For example:
```
const adminLogger = new AdminLogger();
adminLogger.logInfo('Logger Message');
```
Output:
```
{"dd":{"service":"bwell-fhir-server","version":"0.0.1"},"level":"info","logger":"admin","message":"Logger Message","timestamp":"Feb-10-2023 10:10:10+00:00"}
```

## Locked packages in Package.json

Some packages like sentry node and opentelemetry are locked in package.json file due to compatability issues in newer versions and should be tested properly before updating.
