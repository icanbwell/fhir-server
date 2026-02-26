# This file has the code generator to reach search-parameters.json and generate searchParameters.js

import json
import os
import shutil
import re
from dataclasses import dataclass
from pathlib import Path
from re import Match
import sys
from typing import Any
from typing import Dict
from typing import List
from typing import Optional

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.generate_resource_fields_type import get_resources_fields_data


@dataclass
class QueryEntry:
    resource: str
    search_parameter: str
    type_: str
    field: str
    target: Optional[List[str]]
    description: Optional[str]
    definition: Optional[str]
    field_type: Optional[str]


def add_values_in_dict(sample_dict: Dict[str, Dict[str, List[QueryEntry]]], query_entry: QueryEntry):
    """ Append multiple values to a key in
        the given dictionary """
    if query_entry.resource not in sample_dict:
        sample_dict[query_entry.resource] = dict()
    if query_entry.search_parameter not in sample_dict[query_entry.resource]:
        sample_dict[query_entry.resource][query_entry.search_parameter] = list()
    sample_dict[query_entry.resource][query_entry.search_parameter].append(query_entry)
    return sample_dict


def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")

    with open(data_dir.joinpath("search-parameters.json"), "r+") as file:
        contents = file.read()

    fhir_schema = json.loads(contents)

    entries: List[Dict[str, str]] = fhir_schema["entry"]

    resource_field_types = get_resources_fields_data()

    query_entries: List[QueryEntry] = []
    print("search_parameter,base,code,status,type_,xpath,xpath_transformed,target,expression")
    entry: Dict[str, Any]
    for entry in entries:
        resource: Dict[str, Any] = entry["resource"]
        search_parameter: str = resource["name"]
        code: str = resource["code"]
        status: str = resource["status"]
        description: str = resource["description"]
        type_: str = resource["type"]
        base: str = "|".join(resource["base"])
        expression: str = resource.get("expression", None)
        xpath: str = resource.get("xpath", None)
        definition: str = resource.get("url", None)
        if resource["id"] in ["individual-given", "individual-family"]:
            parameter_name = resource["id"].split("-")[-1]
            base += "|Person"
            expression += f" | Person.name.{parameter_name}"
            xpath += f" | f:Person/f:name/f:{parameter_name}"
            description += f"* [Person](person.html): A portion of the {parameter_name} name of the person\r\n"

        xpath_transformed: str = xpath.replace("/f:", ".").replace("f:", "") if xpath else None
        target: str = "|".join(resource["target"]) if "target" in resource else None
        print(f"{search_parameter},{base},{code},{status},{type_},{xpath},{xpath_transformed},{target},{expression}")
        if xpath_transformed:
            exp: str
            for exp in xpath_transformed.split("|"):
                exp = exp.strip(" ")
                resource1, exp1 = exp.split(".", 1)
                field_type = resource_field_types.get(exp, {}).get("code", None)
                if field_type is None:
                    if resource1 == "Resource" and exp1 == "meta.lastUpdated":
                        field_type = "instant"
                    if resource1 == "MedicationRequest" and exp1 == "dosageInstruction.timing.event":
                        field_type = "datetime"
                query_entry: QueryEntry = QueryEntry(
                    resource=resource1,
                    search_parameter=search_parameter,
                    type_=type_,
                    field=exp1,
                    field_type=field_type,
                    target=target.split("|") if target else None,
                    description=description,
                    definition=definition
                )

                ############
                # For custom param on period field in certain resources
                ############

                if (
                    resource1
                    in [
                        "Encounter",
                        "Condition",
                        "DiagnosticReport",
                        "Observation",
                        "Procedure",
                    ]
                    and query_entry.type_ == "date"
                    and query_entry.field_type
                    and query_entry.field_type.lower() == "period"
                ):
                    # remove . from field name and convert to camel case for param name except first part
                    param_name_parts = query_entry.field.split(".")
                    param_name = param_name_parts[0] + "".join(part.capitalize() for part in param_name_parts[1:])

                    # create start and end date entries
                    start_entry: QueryEntry = QueryEntry(
                        resource=query_entry.resource,
                        search_parameter=f"_{param_name}Start",
                        type_=query_entry.type_,
                        field=query_entry.field + ".start",
                        field_type="datetime",
                        target=query_entry.target,
                        description="Custom search parameter for start date of " + query_entry.field,
                        definition=query_entry.definition
                    )
                    end_entry: QueryEntry = QueryEntry(
                        resource=query_entry.resource,
                        search_parameter=f"_{param_name}End",
                        type_=query_entry.type_,
                        field=query_entry.field + ".end",
                        field_type="datetime",
                        target=query_entry.target,
                        description="Custom search parameter for end date of " + query_entry.field,
                        definition=query_entry.definition
                    )
                    query_entries.append(start_entry)
                    query_entries.append(end_entry)
                query_entries.append(query_entry)

    # group by Resource
    sample_dict: Dict[str, Dict[str, List[QueryEntry]]] = {}
    for query_entry in query_entries:
        add_values_in_dict(sample_dict=sample_dict, query_entry=query_entry)

    # for some reason Binary is missing
    sample_dict['Binary'] = {}

    # generate the file
    field_filter_regex = r"\[([^\]])+\]"

    output_dir: Path = Path("src/searchParameters/")

    # write out the js file
    file_path: Path = output_dir.joinpath("searchParameters.js")
    with open(file_path, "w") as file2:
        file2.write("// noinspection SpellCheckingInspection\n")
        file2.write("// Autogenerated by script: generate_search_parameters.py.  Do not edit.\n")
        file2.write("const {SearchParameterDefinition} = require('./searchParameterTypes');\n")
        file2.write("/**\n")
        file2.write(" * Search Parameters from FHIR spec\n")
        file2.write(" * @type {Object.<string, Object.<string, SearchParameterDefinition>>}\n")
        file2.write(" */\n")
        file2.write("const searchParameterQueries = {\n")
        write_search_parameter_dict(field_filter_regex, file2, sample_dict, is_python=False)
        file2.write(";\n")
        file2.write("\nmodule.exports = {\n")
        file2.write("\tsearchParameterQueries: searchParameterQueries\n")
        file2.write("};\n")

    # write out the python file
    file_path: Path = data_dir.parent.joinpath("search_parameters.py")
    with open(file_path, "w") as file2:
        file2.write("# Autogenerated by script: generate_search_parameters.py.  Do not edit.\n")
        file2.write("search_parameter_queries = {\n")
        write_search_parameter_dict(field_filter_regex, file2, sample_dict, is_python=True)
        file2.write("\n")

    parameters_folder: Path = Path("src/middleware/fhir/resources/4_0_0/parameters/")
    if os.path.exists(parameters_folder):
        shutil.rmtree(parameters_folder)
    os.mkdir(parameters_folder)
    # generate parameter files
    write_parameter_files(parameters_folder, sample_dict)

    return 0


def write_parameter_files(parameters_folder: Path, sample_dict):
    resources = ['Account', 'ActivityDefinition', 'AdministrableProductDefinition', 'AdverseEvent',
        'AllergyIntolerance', 'Appointment', 'AppointmentResponse', 'AuditEvent', 'Basic', 'Binary',
        'BiologicallyDerivedProduct', 'BodyStructure', 'Bundle', 'CapabilityStatement', 'CarePlan',
        'CareTeam', 'CatalogEntry', 'ChargeItem', 'ChargeItemDefinition', 'Citation', 'Claim',
        'ClaimResponse', 'ClinicalImpression', 'ClinicalUseDefinition', 'CodeSystem', 'Communication',
        'CommunicationRequest', 'CompartmentDefinition', 'Composition', 'ConceptMap', 'Condition',
        'Consent', 'Contract', 'Coverage', 'CoverageEligibilityRequest', 'CoverageEligibilityResponse',
        'DetectedIssue', 'Device', 'DeviceDefinition', 'DeviceMetric', 'DeviceRequest', 'DeviceUseStatement',
        'DiagnosticReport', 'DocumentManifest', 'DocumentReference', 'Encounter',
        'Endpoint', 'EnrollmentRequest', 'EnrollmentResponse', 'EpisodeOfCare', 'EventDefinition',
        'Evidence', 'EvidenceReport', 'EvidenceVariable', 'ExampleScenario', 'ExplanationOfBenefit',
        'FamilyMemberHistory', 'Flag', 'Goal', 'GraphDefinition', 'Group', 'GuidanceResponse',
        'HealthcareService', 'ImagingStudy', 'Immunization', 'ImmunizationEvaluation',
        'ImmunizationRecommendation', 'ImplementationGuide', 'Ingredient', 'InsurancePlan', 'Invoice',
        'Library', 'Linkage', 'List', 'Location', 'ManufacturedItemDefinition', 'Measure', 'MeasureReport',
        'Media', 'Medication', 'MedicationAdministration', 'MedicationDispense', 'MedicationKnowledge',
        'MedicationRequest', 'MedicationStatement', 'MedicinalProductDefinition', 'MessageDefinition',
        'MessageHeader', 'MolecularSequence', 'NamingSystem', 'NutritionOrder', 'NutritionProduct',
        'Observation', 'ObservationDefinition', 'OperationDefinition', 'OperationOutcome', 'Organization',
        'OrganizationAffiliation', 'PackagedProductDefinition', 'Parameters', 'Patient', 'PaymentNotice',
        'PaymentReconciliation', 'Person', 'PlanDefinition', 'Practitioner', 'PractitionerRole', 'Procedure',
        'Provenance', 'Questionnaire', 'QuestionnaireResponse', 'RegulatedAuthorization', 'RelatedPerson',
        'RequestGroup', 'ResearchDefinition', 'ResearchElementDefinition', 'ResearchStudy', 'ResearchSubject',
        'RiskAssessment', 'Schedule', 'SearchParameter', 'ServiceRequest', 'Slot', 'Specimen',
        'SpecimenDefinition', 'StructureDefinition', 'StructureMap', 'Subscription', 'SubscriptionStatus',
        'SubscriptionTopic', 'Substance', 'SubstanceDefinition', 'SupplyDelivery', 'SupplyRequest', 'Task',
        'TerminologyCapabilities', 'TestReport', 'TestScript', 'ValueSet', 'VerificationResult', 'VisionPrescription']

    # generate parameter files
    for resource_name in resources:
        file_name = resource_name.lower() + '.parameters.js'
        file_path = parameters_folder.joinpath(file_name)
        resource_entries_dict = sample_dict[resource_name] if resource_name in sample_dict else None

        with open(file_path, "w") as file:
            file.write("// Autogenerated by script: generate_search_parameters.py.  Do not edit.\n")
            file.write("/**\n")
            file.write(" * @name exports\n")
            file.write(" * @static\n")
            file.write(f" * @summary Arguments for the {resource_name} query\n")
            file.write(" */\n")
            file.write("module.exports = {\n")
            if resource_entries_dict is not None:
                for search_parameter, search_parameter_entries in resource_entries_dict.items():
                    cleaned_description: Optional[str] = search_parameter_entries[0].description.replace('\n', '').replace('\r', '').replace("'", "")
                    file.write("  '" + search_parameter + '\': {\n')
                    file.write(f"    type: '{search_parameter_entries[0].type_}',\n")
                    file.write(f"    fhirtype: '{search_parameter_entries[0].type_}',\n")
                    file.write("    xpath: '" + resource_name + "." + search_parameter_entries[0].field.replace("'", "\\'") + "',\n")
                    file.write(f"    definition: '{search_parameter_entries[0].definition}',\n")
                    file.write(f"    description: '{cleaned_description}',\n")
                    file.write('  },\n')

            file.write("};\n")

    # generate index file
    index_file_path = parameters_folder.joinpath('index.js')
    with open(index_file_path, "w") as index_file:
        for resource_name in resources:
            index_file.write(f"const {resource_name.lower()} = require('./{resource_name.lower()}.parameters.js');\n\n")

        index_file.write("module.exports = {\n")
        for resource_name in resources:
            index_file.write(f"  {resource_name.lower()},\n")
        index_file.write("};\n")


def write_search_parameter_dict(field_filter_regex, file2, sample_dict, is_python=False):
    resource: str
    resource_entries_dict: Dict[str, List[QueryEntry]]
    for resource, resource_entries_dict in sorted(sample_dict.items()):
        file2.write(f"\t'{resource}': {{\n")
        search_parameter: str
        search_parameter_entries: List[QueryEntry]
        for search_parameter, search_parameter_entries in sorted(resource_entries_dict.items()):
            if is_python:
                file2.write(f"\t\t'{search_parameter}': {{\n")
            else:
                file2.write(f"\t\t'{search_parameter}': new SearchParameterDefinition({{\n")

            if search_parameter_entries[0].description:
                cleaned_description: Optional[str] = search_parameter_entries[0].description.replace('\n', '').replace(
                    '\r', '').replace("'", "")
                file2.write(f"\t\t\t'description': '{cleaned_description}',\n")
                file2.write(f"\t\t\t'type': '{search_parameter_entries[0].type_}',\n")  # we assume all are of same type
            # now figure out the fields
            if len(search_parameter_entries) == 1:  # simple case
                field_filter_match: Match = re.search(field_filter_regex, search_parameter_entries[0].field)
                field_filter: Optional[str] = field_filter_match.group() if field_filter_match else None
                cleaned_field: str = re.sub(field_filter_regex, "", search_parameter_entries[0].field)
                file2.write(f"\t\t\t'field': '{cleaned_field}',\n")
                if field_filter:
                    cleaned_field_filter: str = field_filter.replace("'", "\\'")
                    file2.write(f"\t\t\t'fieldFilter': '{cleaned_field_filter}',\n")
                if search_parameter_entries[0].type_ == 'date' and search_parameter_entries[0].field_type:
                    file2.write(f"\t\t\t'fieldTypesObj': {{ '{cleaned_field}': '{search_parameter_entries[0].field_type.lower()}' }},\n")
            else:
                fields: List[str] = []
                field_filters: List[str] = []
                field_types: dict = {}
                for search_parameter_entry in search_parameter_entries:
                    field_filter_match: Match = re.search(field_filter_regex, search_parameter_entry.field)
                    field_filter: Optional[str] = field_filter_match.group() if field_filter_match else None
                    cleaned_field: str = re.sub(field_filter_regex, "", search_parameter_entry.field)
                    fields.append(cleaned_field)
                    if field_filter:
                        cleaned_field_filter: str = field_filter.replace("'", "\\'")
                        field_filters.append(cleaned_field_filter)
                    if search_parameter_entry.type_ == 'date' and search_parameter_entry.field_type:
                        field_types[cleaned_field] = search_parameter_entry.field_type.lower()
                fields = [f"'{f}'" for f in fields]
                field_filters = [f"'{f}'" for f in field_filters]
                file2.write(f"\t\t\t'fields': [{', '.join(fields)}],\n")
                if len(field_filters) > 0:
                    file2.write(f"\t\t\t'fieldFilters': [{', '.join(field_filters)}],\n")
                if len(field_types) > 0:
                    field_types_str = ", ".join([f"'{k}': '{v}'" for k, v in field_types.items()])
                    file2.write(f"\t\t\t'fieldTypesObj': {{ {field_types_str} }},\n")

            # now write the target.  assume target is same for all search parameters with same name
            if search_parameter_entries[0].target:
                file2.write("\t\t\t'target': [")
                target_list = [f"'{t}'" for t in search_parameter_entries[0].target]
                file2.write(f"{', '.join(target_list)}")
                file2.write("],\n")
            if is_python:
                file2.write("\t\t},\n")
            else:
                file2.write("\t\t}),\n")
        file2.write("\t},\n")
    file2.write("}")


if __name__ == "__main__":
    exit(main())
