# This file implements the code for generating json of fields for all resources which contains
# reference to non-clinical resources for patient $everything operation

from pathlib import Path
import json
from fhir_xml_schema_parser import FhirXmlSchemaParser

patient_graphs: Path = Path(__file__).parent.joinpath("./../../graphs/patient")

reference_type_list = FhirXmlSchemaParser.get_types_for_references()


def get_clinical_resources(obj, field_names=None):
    """
    Returns list of resources which are directly linked to patient resource
    """

    if field_names is None:
        field_names = []

    for key, value in obj.items():
        if key in ["type", "start"]:
            field_names.append(value)
        elif isinstance(value, dict):
            get_clinical_resources(value, field_names)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    get_clinical_resources(item, field_names)

    return field_names


def get_non_clinical_resources_fields(resources_to_exclude=[]):
    """
    Add field for each resource which contains reference to any non-clinical resource
    """

    result = {}
    for reference_type in reference_type_list:
        resource = reference_type.path.split(".", 1)[0]
        path = (reference_type.path.split(".", 1)[1]).replace("[x]", "Reference")
        if path.endswith("V2"):
            path = path[:-2]

        for type in reference_type.target_resources:
            if not type in resources_to_exclude:
                x = result.get(resource, [])
                x.append(path)
                result[resource] = x
                break

    return result


def main():
    json_file_path = patient_graphs.joinpath("everything.json")
    with open(json_file_path, "r") as json_file:
        patient_everything_graph = json.load(json_file)

    clinical_resources = get_clinical_resources(patient_everything_graph)

    json_file_path = patient_graphs.joinpath("generated.clinical_resources.json")
    with open(json_file_path, "w") as json_file:
        json.dump({"clinicalResources": clinical_resources}, json_file, indent=2)
        json_file.write("\n")

    # to prevent duplicate fields where reference type is 'Resource' as we have V2 with list of all resources
    # src/fhir/generator/fhir_xml_schema_parser.py (line 985)
    clinical_resources.append("Resource")

    non_clinical_resource_fields_list = get_non_clinical_resources_fields(
        clinical_resources
    )

    json_file_path = patient_graphs.joinpath("generated.non_clinical_resources_fields.json")
    with open(json_file_path, "w") as json_file:
        json.dump(non_clinical_resource_fields_list, json_file, indent=2)
        json_file.write("\n")

    print(
        "------------ Finished creating non-clinical resource fields list ------------"
    )


if __name__ == "__main__":
    exit(main())
