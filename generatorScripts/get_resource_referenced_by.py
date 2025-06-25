# Script to find all fields in FHIR resources that reference a specific resource type.
# update the config below to change the resource type to find references for
# can be run using `make getResourceReferencedBy` and generates the following files

# generatorScripts/data/reference_by_map.json
# It generates a JSON file with the resource name as the key and a list of fields that reference the specified resource type.

# generatorScripts/data/reference_by_search_map.json
# It also generates a JSON file with search parameters for those fields.


# Add the project root to the Python path to resolve imports
import sys
from pathlib import Path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import json
from generatorScripts.fhir_xml_schema_parser import FhirEntity, FhirProperty, FhirXmlSchemaParser
from generatorScripts.search_parameters import search_parameter_queries

all_classes = FhirXmlSchemaParser.generate_classes()
resource_type_list = FhirXmlSchemaParser.get_list_of_resources()
primitive_types_dict = FhirXmlSchemaParser.get_fhir_primitive_types()

####################
# Config for script
####################
resource_to_find_in_reference = "PractitionerRole"
include_any_reference = True # if True, will include Resource<any> references
log_fields_with_any_reference = False
skip_extension = True # if True, will skip fields with type Extension or ModifierExtension
skip_identifier = True
fields_depth = 3
keep_recursive_fields = False # if True, will keep recursive fields like extension in extension
resources_to_skip = []
#####################

total_fields = 0
total_references_with_param = 0
reference_by_map = {}
reference_by_search_map = {}
non_target_resources = FhirXmlSchemaParser.get_list_of_resources()
filter_array = [resource_to_find_in_reference]
if include_any_reference:
    filter_array.append("Resource")
non_target_resources = list(
    filter(lambda x: x not in filter_array, non_target_resources)
)


def get_field_type_property(field_type: str):
    """
    returns property class for given field
    """
    # eg: contained field in Observation have type Resource but have ResourceContainer in classes which have empty properties
    if field_type == "ResourceContainer":
        field_type = "Resource"
    for property_class in all_classes:
        if property_class.cleaned_name == field_type:
            return property_class
    return None


def make_reference_data(
    field_class: FhirProperty, recursive_path: str, resource: FhirEntity
):
    if (
        log_fields_with_any_reference
        and "Resource" in field_class.reference_target_resources_names
    ):
        print(f"Resource<any>: {recursive_path}")

    global total_references_with_param
    global total_fields

    for target_type in field_class.reference_target_resources_names:
        if not target_type in non_target_resources:

            if not reference_by_map.get(resource.fhir_name):
                reference_by_map[resource.fhir_name] = []

            if recursive_path not in reference_by_map[resource.fhir_name]:
                reference_by_map[resource.fhir_name].append(recursive_path)
                total_fields += 1

                search_params = search_parameter_queries.get(resource.fhir_name, {})
                for search_param, values in search_params.items():
                    if values.get("field") == recursive_path:
                        if not reference_by_search_map.get(resource.fhir_name):
                            reference_by_search_map[resource.fhir_name] = {}
                        if not reference_by_search_map[resource.fhir_name].get(
                            search_param
                        ):
                            total_references_with_param += 1
                            reference_by_search_map[resource.fhir_name][
                                search_param
                            ] = recursive_path
            return


def handle_nested_fields(
    field_class: FhirProperty, recursive_path: str, resource: FhirEntity
):

    if skip_extension:
        if field_class.cleaned_type in ["Extension", "ModifierExtension"]:
            return

    if skip_identifier:
        if field_class.cleaned_type == "Identifier":
            return

    if recursive_path:
        if not keep_recursive_fields and recursive_path.split(".").count(field_class.name) > 0:
            # Skip nested recursive fields like extension in extension
            return
        recursive_path += f".{field_class.name}"
    else:
        recursive_path = f"{field_class.name}"

    # for skipping nested recursive fields like extension in extension
    if recursive_path.split(".").count(field_class.name) > fields_depth:
        return

    if field_class.cleaned_type == "Reference":
        make_reference_data(field_class, recursive_path, resource)

    field_property = get_field_type_property(field_class.cleaned_type)

    if not field_property:
        # print(f"Missing field properties for {recursive_path}")
        return

    for prop in field_property.properties:
        if prop.is_v2_supported:
            continue
        # Skipping nested extension and modifierExtension fields
        if prop.fhir_name in ["extension", "modifierExtension"]:
            continue
        if prop.cleaned_type == "Reference":
            make_reference_data(field_class, recursive_path, resource)
        if prop.type_snake_case not in primitive_types_dict.keys():
            handle_nested_fields(prop, recursive_path, resource)

    return


def generate_reference_by_resource_fields_data():
    """
    Add field for each resource which contains reference to given resource
    """

    for resource in all_classes:
        if resource.is_resource and resource.fhir_name not in resources_to_skip:
            print("\n\n")
            print(f"Processing resource: {resource.fhir_name}")

            for property_class in resource.properties:
                if property_class.is_v2_supported:
                    continue
                if property_class.type_snake_case not in primitive_types_dict:
                    handle_nested_fields(property_class, "", resource)


def main():
    generate_reference_by_resource_fields_data()
    print("\n\n")
    json_file_path = "generatorScripts/data/reference_by_map.json"
    with open(json_file_path, "w") as json_file:
        json.dump(reference_by_map, json_file, indent=2)
        json_file.write("\n")

    json_file_path = "generatorScripts/data/reference_by_search_map.json"
    with open(json_file_path, "w") as json_file:
        json.dump(reference_by_search_map, json_file, indent=2)
        json_file.write("\n")

    print(
        f"Total fields with reference to {resource_to_find_in_reference}: {total_fields}"
    )
    print(f"Total references with search parameter: {total_references_with_param}")


if __name__ == "__main__":
    exit(main())
