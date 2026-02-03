# This file implements the code for generating json of fields for all resources which contains
# reference to non-clinical resources for patient $everything operation

from typing import Dict, Set, List, Union
from pathlib import Path
import json
import copy
import sys

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirEntity, FhirProperty, FhirXmlSchemaParser

everything_operation: Path = Path("src/operations/everything")

reference_type_list = FhirXmlSchemaParser.get_types_for_references(only_resources=True)
resource_type_list = FhirXmlSchemaParser.get_list_of_resources()

primitive_types_dict = FhirXmlSchemaParser.get_fhir_primitive_types()
all_classes = FhirXmlSchemaParser.generate_classes()


###############
# Config for non-clinical fields
###############

# configure recursive field depth
recursive_fields_depth = 3

# configure wether to skip extension types
skip_extension = True
skip_identifier = True

# log debug data
log_fields_with_any_reference = True


###############
# Clinical Resources List & Filters
###############


def get_clinical_resources_and_filters():
    """
    Returns list of resources which are directly linked to patient resource
    Note: this function is used in GraphQLv2 generator for making custom patient queries. After changes
    run `make graphqlv2` to confirm changes
    """

    clinical_resources = [
        "Account",
        "AdverseEvent",
        "AllergyIntolerance",
        "Appointment",
        "AppointmentResponse",
        "Basic",
        "BiologicallyDerivedProduct",
        "BodyStructure",
        "CarePlan",
        "CareTeam",
        "ChargeItem",
        "Claim",
        "ClaimResponse",
        "ClinicalImpression",
        "Communication",
        "CommunicationRequest",
        "Composition",
        "Condition",
        "Consent",
        "Contract",
        "Coverage",
        "CoverageEligibilityRequest",
        "CoverageEligibilityResponse",
        "DetectedIssue",
        "Device",
        "DeviceRequest",
        "DeviceUseStatement",
        "DiagnosticReport",
        "DocumentManifest",
        "DocumentReference",
        "Encounter",
        "EnrollmentRequest",
        "EpisodeOfCare",
        "ExplanationOfBenefit",
        "FamilyMemberHistory",
        "Flag",
        "Goal",
        "Group",
        "GuidanceResponse",
        "ImagingStudy",
        "Immunization",
        "ImmunizationEvaluation",
        "ImmunizationRecommendation",
        "Invoice",
        "Linkage",
        "List",
        "MeasureReport",
        "Media",
        "MedicationAdministration",
        "MedicationDispense",
        "MedicationRequest",
        "MedicationStatement",
        "MolecularSequence",
        "NutritionOrder",
        "Observation",
        "Patient",
        "PaymentNotice",
        "Person",
        "Procedure",
        "Provenance",
        "QuestionnaireResponse",
        "RelatedPerson",
        "RequestGroup",
        "ResearchSubject",
        "RiskAssessment",
        "Schedule",
        "ServiceRequest",
        "Specimen",
        "Subscription",
        "SubscriptionStatus",
        "SubscriptionTopic",
        "SupplyDelivery",
        "SupplyRequest",
        "Task",
        "VisionPrescription",
    ]
    patient_filter_map = {
        "Account": "patient",
        "AdverseEvent": "subject",
        "AllergyIntolerance": "patient",
        "Appointment": "patient",
        "AppointmentResponse": "patient",
        "Basic": "patient",
        "BodyStructure": "patient",
        "CarePlan": "patient",
        "CareTeam": "patient",
        "ChargeItem": "patient",
        "Claim": "patient",
        "ClaimResponse": "patient",
        "ClinicalImpression": "patient",
        "Communication": "patient",
        "CommunicationRequest": "patient",
        "Composition": "patient",
        "Condition": "patient",
        "Consent": "patient",
        "Contract": "patient",
        "Coverage": "patient",
        "CoverageEligibilityRequest": "patient",
        "CoverageEligibilityResponse": "patient",
        "DetectedIssue": "patient",
        "Device": "patient",
        "DeviceRequest": "patient",
        "DeviceUseStatement": "patient",
        "DiagnosticReport": "patient",
        "DocumentManifest": "patient",
        "DocumentReference": "patient",
        "Encounter": "patient",
        "EnrollmentRequest": "patient",
        "EpisodeOfCare": "patient",
        "ExplanationOfBenefit": "patient",
        "FamilyMemberHistory": "patient",
        "Flag": "patient",
        "Goal": "patient",
        "Group": "member",
        "GuidanceResponse": "patient",
        "ImagingStudy": "patient",
        "Immunization": "patient",
        "ImmunizationEvaluation": "patient",
        "ImmunizationRecommendation": "patient",
        "Invoice": "patient",
        "Linkage": "item",
        "List": "patient",
        "MeasureReport": "patient",
        "Media": "patient",
        "MedicationAdministration": "patient",
        "MedicationDispense": "patient",
        "MedicationRequest": "patient",
        "MedicationStatement": "patient",
        "MolecularSequence": "patient",
        "NutritionOrder": "patient",
        "Observation": "patient",
        "Patient": "link",
        "PaymentNotice": "request",
        "Person": "link",
        "Procedure": "patient",
        "Provenance": "patient",
        "QuestionnaireResponse": "patient",
        "RelatedPerson": "patient",
        "RequestGroup": "patient",
        "ResearchSubject": "patient",
        "RiskAssessment": "patient",
        "Schedule": "actor",
        "ServiceRequest": "patient",
        "Specimen": "patient",
        "Subscription": "extension",
        "SubscriptionStatus": "extension",
        "SubscriptionTopic": "identifier",
        "SupplyDelivery": "patient",
        "SupplyRequest": "requester",
        "Task": "patient",
        "VisionPrescription": "patient",
    }

    return clinical_resources, patient_filter_map

clinical_resources, _ = get_clinical_resources_and_filters()
clinical_resources = list(clinical_resources)

###############
# Non Clinical Resources Fields in clinical and resources referenced in each resource
###############

class NonClinicalFieldsData:
    def __init__(self):
        self.non_clinical_map = {}
        self.non_clinical_map_uuid = {}
        self.resource_referenced_by_map = {}
        for resource_name in resource_type_list:
            self.resource_referenced_by_map[resource_name] = set()

    def get_field_type_property(self, field_type: str):
        '''
        returns property class for given field
        '''
        # eg: contained field in Observation have type Resource but have ResourceContainer in classes which have empty properties
        if field_type == "ResourceContainer":
            field_type = "Resource"
        for property_class in all_classes:
            if property_class.cleaned_name == field_type:
                return property_class
        return None

    def make_reference_data(
        self, field_class: FhirProperty, recursive_path: str, resource: FhirEntity
    ):
        if log_fields_with_any_reference and "Resource" in field_class.reference_target_resources_names:
            print(f"Resource<any>: {recursive_path}")

        if "Resource" in field_class.reference_target_resources_names:
            for resource_name in resource_type_list:
                self.resource_referenced_by_map[resource_name].add(resource.cleaned_name)
        else:
            for resource_name in field_class.reference_target_resources_names:
                self.resource_referenced_by_map[resource_name].add(resource.cleaned_name)

        for target_type in field_class.reference_target_resources_names:
            if not target_type in clinical_resources:

                if not self.non_clinical_map.get(resource.fhir_name):
                    self.non_clinical_map[resource.fhir_name] = []

                if not self.non_clinical_map_uuid.get(resource.fhir_name):
                    self.non_clinical_map_uuid[resource.fhir_name] = []

                if (
                    recursive_path + ".reference"
                    not in self.non_clinical_map[resource.fhir_name]
                ):
                    self.non_clinical_map[resource.fhir_name].append(
                        recursive_path + ".reference"
                    )
                if (
                    recursive_path + "._uuid"
                    not in self.non_clinical_map_uuid[resource.fhir_name]
                ):
                    self.non_clinical_map_uuid[resource.fhir_name].append(
                        recursive_path + "._uuid"
                    )
                return


    def handle_nested_fields(
        self, field_class: FhirProperty, recursive_path: str, resource: FhirEntity
    ):

        if skip_extension:
            if field_class.cleaned_type in ["Extension", "ModifierExtension"]:
                return

        if skip_identifier:
            if field_class.cleaned_type == "Identifier":
                return
        
        if recursive_path:
            recursive_path += f".{field_class.name}"
        else:
            recursive_path = f"{field_class.name}"

        # for skipping nested recursive fields like extension in extension
        if recursive_path.split(".").count(field_class.name) > recursive_fields_depth:
            return

        if field_class.cleaned_type == "Reference":
            self.make_reference_data(field_class, recursive_path, resource)

        field_property = self.get_field_type_property(field_class.cleaned_type)

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
                self.make_reference_data(
                    field_class, recursive_path, resource
                )
            if prop.type_snake_case not in primitive_types_dict.keys():
                self.handle_nested_fields(prop, recursive_path, resource)

        return


    def generate_non_clinical_resource_fields_data(self):
        """
        Add field for each resource which contains reference to any non-clinical resource
        """

        for resource in all_classes:
            if resource.is_resource:
                print("\n\n")
                print(f"Processing resource: {resource.fhir_name}")

                for property_class in resource.properties:
                    if property_class.is_v2_supported:
                        continue
                    if property_class.type_snake_case not in primitive_types_dict:
                        self.handle_nested_fields(property_class, "", resource)


def get_non_clinical_resources_fields(resources_to_exclude=[], use_uuid=False):
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
                x.append(path + ("._uuid" if use_uuid else ".reference"))
                result[resource] = x
                break

    return result

###############
# Non clinical reachability map and stats
###############


def get_non_clinical_rechability_map(
    *,
    level: int = 3,
    as_set: bool = False,
    non_clinical_data: NonClinicalFieldsData
) -> Union[Dict[str, Set[str]], Dict[str, List[str]]]:
    """
    Returns a map of non-clinical resources to all resources through which they can be reached.

    Args:
        level: Maximum number of reference levels to traverse
        as_set: If True, returns sets of references; if False, returns sorted lists

    Returns:
        Dictionary mapping non-clinical resources to all resources that can reference them,
        directly or indirectly up to the specified level
    """
    # Get direct references (level 0)
    resource_referenced_by_map = non_clinical_data.resource_referenced_by_map
    resource_referenced_by_map["Binary"].add("DocumentReference")

    direct_references = {k: v for k, v in resource_referenced_by_map.items() if k not in clinical_resources and k not in ['AuditEvent', 'Resource']}

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

    reachability_map = dict(sorted(reachability_map.items()))

    if as_set:
        return reachability_map
    return {
        resource: sorted(list(references))
        for resource, references in reachability_map.items()
    }


def main():
    non_clinical_data = NonClinicalFieldsData()
    non_clinical_data.generate_non_clinical_resource_fields_data()

    non_clininical_to_required_resources = get_non_clinical_rechability_map(level=3, as_set=False, non_clinical_data=non_clinical_data)
    non_clinical_resources = sorted(list(non_clininical_to_required_resources.keys()))

    print_non_clinical_stats(non_clininical_to_required_resources)

    json_file_path = everything_operation.joinpath("generated.resource_types.json")
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

    json_file_path = everything_operation.joinpath(
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

    # add custom field for accessing Binary resource from DocumentReference
    non_clinical_data.non_clinical_map_uuid["DocumentReference"].append(
        "content.attachment.url"
    )

    json_file_path = everything_operation.joinpath("generated.non_clinical_resources_fields.json")
    with open(json_file_path, "w") as json_file:
        json.dump(non_clinical_data.non_clinical_map_uuid, json_file, indent=2)
        json_file.write("\n")

    print(
        "------------ Finished creating everything operation data ------------"
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
