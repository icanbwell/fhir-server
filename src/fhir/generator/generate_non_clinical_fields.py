# This file implements the code for generating json of fields for all resources which contains
# reference to non-clinical resources for patient $everything operation

from typing import Dict, Set, List, Union
from pathlib import Path
import json
from fhir_xml_schema_parser import FhirXmlSchemaParser
import copy

patient_graphs: Path = Path(__file__).parent.joinpath("./../../graphs/patient")

reference_type_list = FhirXmlSchemaParser.get_types_for_references(only_resources=True)
resource_type_list = FhirXmlSchemaParser.get_list_of_resources()


def get_clinical_resources_and_filters(
    obj: dict, field_names=None, patient_filter_map={}
):
    """
    Returns list of resources which are directly linked to patient resource
    """

    if field_names is None:
        field_names = set()

    if "params" in obj.keys():
        patient_filter_map[obj["type"]] = obj["params"].split("=")[0]
    for key, value in obj.items():
        if key in ["type", "start"]:
            field_names.add(value)
        elif isinstance(value, dict):
            get_clinical_resources_and_filters(value, field_names)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    get_clinical_resources_and_filters(item, field_names)

    # TODO: Find a better way to do this
    field_names.add('BiologicallyDerivedProduct')
    return field_names, patient_filter_map


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
                x.append(path + ".reference")
                result[resource] = x
                break

    return result


def get_non_clinical_to_referenced_by_resources_map(
    clinical_resources: List[str] = None,
    as_set: bool = False,
) -> Union[Dict[str, Set[str]], Dict[str, List[str]]]:
    """
    Generates map of non-clinical resources to resources which reference them.

    Args:
        clinical_resources: List of clinical resource types
        as_set: If True, returns sets of references; if False, returns sorted lists

    Returns:
        Dictionary mapping non-clinical resources to their referencing resources
    """
    if clinical_resources is None:
        clinical_resources = []

    # Resources that are patient-scoped but not included in $everything
    additional_resources_to_skip = {
        "AuditEvent",
        # TODO: This would be patient scope in future so remove it from here
        "BiologicallyDerivedProduct",
        "Resource",  # Skip the base Resource
    }

    clinical_resources_set = set(clinical_resources)
    reference_map = {}

    for reference_type in reference_type_list:
        resource = reference_type.path.split(".", 1)[0]

        # Non-clinical resources can't have patient reference
        if resource == "Patient":
            continue

        path = (reference_type.path.split(".", 1)[1]).replace("[x]", "Reference")
        if path.endswith("V2"):
            path = path[:-2]

        for non_clinical_resource in reference_type.target_resources:
            # Process only non-clinical resources that aren't in skip list
            if (
                non_clinical_resource not in clinical_resources_set
                and non_clinical_resource not in additional_resources_to_skip
            ):

                # Get or create set of resources that reference this non-clinical resource
                parent_resources = reference_map.get(non_clinical_resource, set())
                parent_resources.add(resource)
                reference_map[non_clinical_resource] = parent_resources

    # Add special case for Binary resource
    if "Binary" in reference_map:
        reference_map["Binary"].add("DocumentReference")

    if as_set:
        return reference_map
    return {
        resource: sorted(list(references))
        for resource, references in reference_map.items()
    }


def get_non_clinical_rechability_map(
    *,
    clinical_resources: List[str],
    level: int = 3,
    as_set: bool = False,
) -> Union[Dict[str, Set[str]], Dict[str, List[str]]]:
    """
    Returns a map of non-clinical resources to all resources through which they can be reached.

    Args:
        clinical_resources: List of clinical resource types
        level: Maximum number of reference levels to traverse
        as_set: If True, returns sets of references; if False, returns sorted lists

    Returns:
        Dictionary mapping non-clinical resources to all resources that can reference them,
        directly or indirectly up to the specified level
    """
    # Get direct references (level 0)
    direct_references: Dict[str, Set[str]] = (
        get_non_clinical_to_referenced_by_resources_map(
            clinical_resources=clinical_resources, as_set=True
        )
    )

    # Initialize result with direct references
    reachability_map = copy.deepcopy(direct_references)
    # Include the resource itself as we can reach to that resource directly
    for resource, references in reachability_map.items():
        references.add(resource)

    # Process additional levels
    for _ in range(1, level):
        for non_clinical_resource, current_references in reachability_map.items():
            indirect_references = set()

            for referencing_resource in current_references:
                # If the referencing resource is itself non-clinical,
                # add all resources that can reference it
                if referencing_resource in direct_references:
                    indirect_references.update(direct_references[referencing_resource])

            reachability_map[non_clinical_resource].update(indirect_references)

    if as_set:
        return reachability_map
    return {
        resource: sorted(list(references))
        for resource, references in reachability_map.items()
    }


def main():
    json_file_path = patient_graphs.joinpath("everything.json")
    with open(json_file_path, "r") as json_file:
        patient_everything_graph = json.load(json_file)

    clinical_resources, _ = get_clinical_resources_and_filters(patient_everything_graph)
    clinical_resources = list(clinical_resources)
    clinical_resources.sort()

    non_clininical_to_required_resources = get_non_clinical_rechability_map(
        clinical_resources=clinical_resources, level=3
    )
    non_clinical_resources = sorted(list(non_clininical_to_required_resources.keys()))

    print_non_clinical_stats(non_clininical_to_required_resources)

    json_file_path = patient_graphs.joinpath("generated.clinical_resources.json")
    with open(json_file_path, "w") as json_file:
        json.dump(
            {
                "clinicalResources": clinical_resources,
                "nonClinicalResources": non_clinical_resources,
            },
            json_file,
            indent=2,
        )
        json_file.write("\n")

    json_file_path = patient_graphs.joinpath(
        "generated.non_clinical_resources_reachablity.json"
    )
    with open(json_file_path, "w") as json_file:
        json.dump(
            {
                "level2": non_clininical_to_required_resources,
            },
            json_file,
            indent=2,
        )

    # to prevent duplicate fields where reference type is 'Resource' as we have V2 with list of all resources
    # src/fhir/generator/fhir_xml_schema_parser.py (line 985)
    clinical_resources.append("Resource")

    non_clinical_resource_fields_list = get_non_clinical_resources_fields(
        clinical_resources
    )

    # add custom field for accessing Binary resource from DocumentReference
    non_clinical_resource_fields_list["DocumentReference"].append(
        "content.attachment.url"
    )

    json_file_path = patient_graphs.joinpath(
        "generated.non_clinical_resources_fields.json"
    )
    with open(json_file_path, "w") as json_file:
        json.dump(non_clinical_resource_fields_list, json_file, indent=2)
        json_file.write("\n")

    print(
        "------------ Finished creating non-clinical resource fields list ------------"
    )


def print_non_clinical_stats(references_map: dict, level=2):
    """
    Print statistics for non-clinical references.

    Args:
        references_map: Dictionary mapping non-clinical resources to their referencing resources
    """
    stats = {"min": float("inf"), "max": 0, "total": 0, "count": 0}

    for _, references in references_map.items():
        ref_count = len(references)
        stats["total"] += ref_count
        stats["min"] = min(stats["min"], ref_count)
        stats["max"] = max(stats["max"], ref_count)
        stats["count"] += 1

    # Handle empty case
    if stats["count"] == 0:
        stats["min"] = 0
        stats["avg"] = 0
    else:
        stats["avg"] = stats["total"] / stats["count"]

    # Print statistics
    print(f"\nNon-Clinical Resources Reference Statistics for level {level}:")
    print("-------------------------------------------")
    print(f"Minimum references per resource: {stats['min']}")
    print(f"Maximum references per resource: {stats['max']}")
    print(f"Average references per resource: {stats['avg']:.2f}")
    print(f"Total references: {stats['total']}")
    print(f"Number of non-clinical resources: {stats['count']}")


if __name__ == "__main__":
    exit(main())
