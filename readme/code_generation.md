# Code Generator From FHIR Schema

This folder (`generatorScripts/`) contains the code generator for the FHIR schema. It can be used to generate code.

Currently we generate the following code:

1. Services in `src/services`
2. Javascript classes in `src/fhir/classes`
3. Javascript file `src/fhir/classes/4_0_0/resources/index.js` that contains a list of resources
4. GraphQL schemas and resolvers in `src/graphql/v2`
5. Search parameters in `src/searchParameters`
6. Resources Non-clinical fields in `src/graphs/patient`
7. Validation schema: `src/fhir/fhir-generated.schema.json`
8. Resource field types: `src/fhir/fhir-generated.field-types.json`
9. Resource DB Schema in `generatorScripts/db-schema/fhir-generated.db-schema/`

## Schema files

Schema files are downloaded from the FHIR web site.

1. Go to https://hl7.org/fhir/R4B/downloads.html (For other versions, change the R4B to the version you want)
2. Download from FHIR Definitions->XML (we use XML because the JSON version has bugs)
3. The download link should be https://hl7.org/fhir/R4B/definitions.xml.zip for R4B
4. Unzip the folder and then unzip the fhir-all-xsd.zip inside it
5. Delete all the files in generatorScripts/xsd/definitions.xml
6. Paste in the files from the unzipped folder

## JSON schema for validation

1. Go to https://hl7.org/fhir/R4B/downloads.html (For other versions, change the R4B to the version you want)
2. Download JSON -> JSON Schema
3. Save in `generatorScripts/json/fhir.schema.json`

## Output of the generator

The generator creates a list of FhirEntity classes for each:

1. Resource
2. BackboneElement
3. ComplexType

The FhirEntity classes are easier to use in templates since they collect all the information in one class.

Each FhirEntity class contains a field called `properties` that is a list of FhirProperty classes.

Then a set of Jinja2 templates are used to generate the four types of code using the FhirEntity classes:

### 1. Services in `src/services`

You can run this via `make generate`.
This runs `generatorScripts/generate_services.py`.
This does not use Jinja2 templates.

### 2. Javascript classes in `src/fhir/classes`

You can run this via `make classes`.

This runs `generatorScripts/classes/generate_classes.py`.

This uses the following Jinja2 template `template.javascript.class.jinja2` to generate the classes.

This generates Javascript classes for each:

- resource
- backboneElement
- extension
- complex type
- valueset

### 3. Javascript file `src/fhir/classes/4_0_0/resources/index.js` that contains a list of resources

This is run by the same command as in #2.

This runs `generatorScripts/classes/generate_classes_index.py`.

This uses the following Jinja2 template `template.javascript.index.jinja2` to generate the index.js file.

### 4. GraphQL schemas and resolvers in `src/graphql/v2`

This is run by the command `make graphql`.

This runs `generatorScripts/graphql/generate_graphql_classes.py`.

This uses the following Jinja2 templates:

1. `template.query.jinja2` to generate the query schema
2. `template.resource.jinja2` to generate the resource schema
3. `template.resource_queries.jinja2` to generate the resource queries
4. `resolvers/template.resource.jinja2` to generate the resource resolvers
5. `template.backbone_element.jinja2` to generate the backbone element schema
6. `resolvers/template.backbone_element.jinja2` to generate the backbone element resolvers
7. `template.complex_type.jinja2` to generate the complex type schema
8. `resolvers/template.complex_type.jinja2` to generate the complex type resolvers

### 5. Search parameters in `src/searchParameters`

This is run by the command `make searchParameters`.

This runs `generatorScripts/searchParameters/generate_search_parameters.py`.

This reads the `src/searchParameters/search-parameters.json` file and generates the following files:

1. `src/searchParameters/searchParameters.js`
2. `generatorScripts/search_parameters.py`

### 6. Data for everything operation

This is run by the command `make everythingOperationData`.

This runs `generatorScripts/generate_everything_operation_data.py` and makes a list of fields for each resources which contains reference to non-clinical resources, which is used by everything operation for finding linked non-clinical resources. List of clinical and non-clinical resources and all resources which are needed to find any particular non-clinical resource.

This reads the `src/graphs/patient/everything.json` file and generates the following files:
- `src/graphs/patient/generated.non_clinical_resources_fields.json`
- `src/graphs/patient/generated.clinical_resources.json`
- `src/operations/everything/generated.non_clinical_resources_fields.json`
- `src/operations/everything/generated.non_clinical_resources_reachablity.json`
- `src/operations/everything/generated.resource_types.json`

### 7. Validation schema in `generatorScripts/json`

This is run by the command `make schema`.

This runs `generatorScripts/generate_schema.py`.

It generates `generatorScripts/json/fhir-generated.schema.json` file used for resources validation.

### 8. Resource field types in `generatorScripts/json`

This is run by the command `make resourceFieldTypes`.

This runs `generatorScripts/generate_resource_fields_type.py`.

It reads `generatorScripts/xsd/definitions.xml/profiles-resources.xml` file and generates `src/fhir/fhir-generated.field-types.json` file used for getting field types while making queries.

### 9. Resource DB Schema in `generatorScripts/json/fhir-generated.db-schema/`

This is run by the command `make dbSchema`.

This runs `generatorScripts/db-schema/generate_db_schema.py`.

It reads generates `generatorScripts/json/fhir-generated.db-schema/*.json` containing the DB schema for all fields of all resources.

## FHIR Schema files used

The generator uses the following files:

1. `generatorScripts/xsd/definitions.xml/fhir-all-xsd/fhir-all.xsd` contains the list of resources and what .xsd file
   contains the schema for each resource.
2. `generatorScripts/xsd/definitions.xml/fhir-all-xsd/fhir-base.xsd` contains the base types for FHIR.
3. From `fhir-all.xsd` we can get the list of the schema files for each resource
   in `generatorScripts/xsd/definitions.xml/*.xsd`.
4. `generatorScripts/xsd/definitions.xml/dataelements.xml` contains the types for the properties of each resource, the
   types for the references and the types for the CodeableConcepts.

## Debugging

The Fhir Schema Parser code is in `generatorScripts/fhir_xml_schema_parser.py`. This class reads the FHIR schema xml
files and generates a list of FhirEntity classes.

You can debug the fhir schema parser by running `generatorScripts/test_generator.py` and putting breakpoints in the
fhir schema parser code.
