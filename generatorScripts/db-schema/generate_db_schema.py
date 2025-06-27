import os
import json
import shutil
from pathlib import Path
import sys

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirProperty, FhirXmlSchemaParser

data_dir: Path = (
    Path(__file__)
    .parent.joinpath("./")
    .joinpath("fhir-generated.db-schema")
)

primitive_types_dict = FhirXmlSchemaParser.get_fhir_primitive_types()
all_classes = FhirXmlSchemaParser.generate_classes()

# configure recursive field depth
recursive_fields_depth = 1


def get_field_type_property(field_type: str):
    # eg: contained field in Observation have type Resource but have ResourceContainer in classes which have empty properties
    if field_type == "ResourceContainer":
        field_type = "Resource"
    for property in all_classes:
        if property.cleaned_name == field_type:
            return property


def get_nested_fields(field_class: FhirProperty, recursive_path: str):
    path = field_class.name
    if field_class.is_list:
        path += ".[]"

    if field_class.is_code:
        return {path: "string"}

    # for skipping nested recursive fields like extension in extension
    if recursive_path.split(".").count(field_class.name) > recursive_fields_depth:
        return {}
    else:
        recursive_path += f".{field_class.name}"

    field_property = get_field_type_property(field_class.cleaned_type)

    nested_fields = {}

    if field_class.cleaned_type == "Reference":
        nested_fields = {
            f"{path}._uuid": "string",
            f"{path}._sourceId": "string",
            f"{path}._sourceAssigningAuthority": "string",
        }

    if not field_property:
        if field_class.type_ in primitive_types_dict.keys():
            return {path: primitive_types_dict[field_class.type_]}
        else:
            print(f"Missing field type for {path}")
            return {}

    for property in field_property.properties:
        if property.is_v2_supported:
            continue
        # Skipping nested extension and modifierExtension fields
        if property.fhir_name in ["extension", "modifierExtension"]:
            continue
        if property.type_snake_case not in primitive_types_dict.keys():
            field_types = get_nested_fields(
                property, recursive_path + f".{property.name}"
            )
            for key, value in field_types.items():
                nested_fields[f"{path}.{key}"] = value
        else:
            nested_fields[f"{path}.{property.name}"] = primitive_types_dict[
                property.type_snake_case
            ]
    if not nested_fields.keys():
        print(f"Missing field properties for {path}")

    return nested_fields


def main():
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    os.mkdir(data_dir)

    for resource in all_classes:
        if resource.is_resource:
            print(f"Processing for resource: {resource.fhir_name}")
            # additional properties
            all_properties = {
                "_id": "string",
                "_uuid": "string",
                "_sourceId": "string",
                "_access.slug": "integer",
                "_sourceAssigningAuthority": "string",
            }
            for property in resource.properties:
                if property.is_v2_supported:
                    continue
                if property.type_snake_case not in primitive_types_dict.keys():
                    nested_fields = get_nested_fields(property, "")
                    all_properties.update(nested_fields)
                else:
                    path = property.name
                    if property.is_list:
                        path += ".[]"
                    all_properties[path] = primitive_types_dict[
                        property.type_snake_case
                    ]

            json_file_path = data_dir.joinpath(f"{resource.fhir_name}_4_0_0.json")
            with open(json_file_path, "w") as json_file:
                json.dump(all_properties, json_file, indent=2)
                json_file.write("\n")


if __name__ == "__main__":
    exit(main())
