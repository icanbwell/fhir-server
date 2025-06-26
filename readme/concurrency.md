# Concurrency Support
This FHIR server is designed to run in massively parallel manner where there are lots of containers running the code.

In this scenario we have to support the case where updates to the SAME resource are being processed simulateneously in multiple containers.

## Process
The FHIR server does all inserts and updates in bulk.
1. When the FHIR server gets a single or list of resources to create/update/merge, first it loads the resources by resourceType and id into a cache
2. Then it checks if the passed in resources are different from the current resources or not.  If no, it skips updating the ones that are the same as their versions in the database.
3. When sending the bulk update, the FHIR server adds a check for each resource to only update if the version in the database is one less than the current version. 
4. The idea is that if the version is higher in the database, this means someone else got in between the time we loaded the cache and the time the database was trying to update
5. The FHIR server then compares the count of matched updates with the count of total updates.  If the count is the same then there was no concurrency issue and we're done.
6. If the count is different, then we switch into a one-by-one update mode.
7. The code iterates over each resource to update
8. It loads that resource from the database and compares with the version it is trying to update.  If there is no change then it skips the update
9. If there is a change, it merges the data from the database into the resource it is trying to update, increments the version number and tries to save with the filter of versionId being one less than the current one.
10. If this update passes, we're good for this resource
11. If this update fails, it goes back to step 8 and tries again.
12. It tries for five times then it gives up and throws an error.


The code for this process exists in:
https://github.com/icanbwell/fhir-server/blob/master/src/dataLayer/databaseBulkInserter.js

The unit tests for this behavior are in:
https://github.com/icanbwell/fhir-server/blob/master/src/tests/dataLayer/databaseBulkInserter/databaseBulkInserter.test.js

