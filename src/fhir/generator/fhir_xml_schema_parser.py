import dataclasses
import re
from pathlib import Path
from typing import OrderedDict, Any, List, Union, Dict, Optional, Set
import logging

# noinspection PyPackageRequirements
from lxml import objectify

# noinspection PyPackageRequirements
from lxml.objectify import ObjectifiedElement


@dataclasses.dataclass
class SmartName:
    name: str
    cleaned_name: str
    snake_case_name: str


@dataclasses.dataclass
class FhirValueSetConcept:
    code: str
    display: Optional[str]
    cleaned_display: Optional[str]
    definition: Optional[str]
    source: str
    value_set_url: str


@dataclasses.dataclass
class FhirValueSet:
    id_: str
    name: str
    fhir_name: str
    name_snake_case: str
    cleaned_name: str
    concepts: List[FhirValueSetConcept]
    url: str
    value_set_url: str
    value_set_url_list: Set[str]
    documentation: List[str]
    source: str


@dataclasses.dataclass
class FhirCodeableType:
    codeable_type: str
    path: str
    codeable_type_url: str
    is_codeable_concept: bool = False


@dataclasses.dataclass
class FhirReferenceType:
    target_resources: List[str]
    path: str


@dataclasses.dataclass
class FhirProperty:
    name: str
    fhir_name: str
    javascript_clean_name: str
    type_: str
    cleaned_type: str
    type_snake_case: str
    optional: bool
    is_list: bool
    documentation: List[str]
    fhir_type: Optional[str]
    reference_target_resources: List[SmartName]
    reference_target_resources_names: List[str]
    graphqlv2_reference_target_resources_names: List[str]
    is_back_bone_element: bool
    is_basic_type: bool
    graphqlv2_type: str
    codeable_type: Optional[SmartName]
    scalar_type: Optional[str] = None
    is_resource: bool = False
    is_extension: bool = False
    is_code: bool = False
    is_complex: bool = False
    name_suffix: Optional[str] = None
    is_v2_supported: bool = False


@dataclasses.dataclass
class FhirEntity:
    fhir_name: str
    cleaned_name: str
    plural_name: str
    name_snake_case: str
    properties: List[FhirProperty]
    documentation: List[str]
    type_: Optional[str]
    is_back_bone_element: bool
    base_type: Optional[str]
    base_type_list: List[str]
    source: str
    graphqlv2_type: str
    is_value_set: bool = False
    value_set_concepts: Optional[List[FhirValueSetConcept]] = None
    value_set_url: Optional[str] = None
    is_basic_type: bool = False
    value_set_url_list: Optional[Set[str]] = None
    is_resource: bool = False
    is_extension: bool = False
    properties_unique: Optional[List[FhirProperty]] = None


logging.basicConfig(
    format="[%(filename)s:%(lineno)d] %(message)s",
    datefmt="%Y-%m-%d:%H:%M:%S",
    level=logging.DEBUG,
)
logger = logging.getLogger(__name__)


resources_plural_names_mapping: Dict[str, str] = {
    "DomainResource": "DomainResources",
    "Resource": "Resources",
    "Account": "Accounts",
    "ActivityDefinition": "ActivityDefinitions",
    "AdministrableProductDefinition": "AdministrableProductDefinitions",
    "AdverseEvent": "AdverseEvents",
    "AllergyIntolerance": "AllergyIntolerances",
    "Appointment": "Appointments",
    "AppointmentResponse": "AppointmentResponses",
    "AuditEvent": "AuditEvents",
    "Basic": "Basics",
    "Binary": "Binaries",
    "BiologicallyDerivedProduct": "BiologicallyDerivedProducts",
    "BodyStructure": "BodyStructures",
    "Bundle": "Bundles",
    "CapabilityStatement": "CapabilityStatements",
    "CarePlan": "CarePlans",
    "CareTeam": "CareTeams",
    "CatalogEntry": "CatalogEntries",
    "ChargeItem": "ChargeItems",
    "ChargeItemDefinition": "ChargeItemDefinitions",
    "Citation": "Citations",
    "Claim": "Claims",
    "ClaimResponse": "ClaimResponses",
    "ClinicalImpression": "ClinicalImpressions",
    "ClinicalUseDefinition": "ClinicalUseDefinitions",
    "CodeSystem": "CodeSystems",
    "Communication": "Communications",
    "CommunicationRequest": "CommunicationRequests",
    "CompartmentDefinition": "CompartmentDefinitions",
    "Composition": "Compositions",
    "ConceptMap": "ConceptMaps",
    "Condition": "Conditions",
    "Consent": "Consents",
    "Contract": "Contracts",
    "Coverage": "Coverages",
    "CoverageEligibilityRequest": "CoverageEligibilityRequests",
    "CoverageEligibilityResponse": "CoverageEligibilityResponses",
    "DetectedIssue": "DetectedIssues",
    "Device": "Devices",
    "DeviceDefinition": "DeviceDefinitions",
    "DeviceMetric": "DeviceMetrics",
    "DeviceRequest": "DeviceRequests",
    "DeviceUseStatement": "DeviceUseStatements",
    "DiagnosticReport": "DiagnosticReports",
    "DocumentManifest": "DocumentManifests",
    "DocumentReference": "DocumentReferences",
    "Encounter": "Encounters",
    "Endpoint": "Endpoints",
    "EnrollmentRequest": "EnrollmentRequests",
    "EnrollmentResponse": "EnrollmentResponses",
    "EpisodeOfCare": "EpisodesOfCare",
    "EventDefinition": "EventDefinitions",
    "Evidence": "Evidences",
    "EvidenceReport": "EvidenceReports",
    "EvidenceVariable": "EvidenceVariables",
    "ExampleScenario": "ExampleScenarios",
    "ExplanationOfBenefit": "ExplanationOfBenefits",
    "FamilyMemberHistory": "FamilyMemberHistories",
    "Flag": "Flags",
    "Goal": "Goals",
    "GraphDefinition": "GraphDefinitions",
    "Group": "Groups",
    "GuidanceResponse": "GuidanceResponses",
    "HealthcareService": "HealthcareServices",
    "ImagingStudy": "ImagingStudies",
    "Immunization": "Immunizations",
    "ImmunizationEvaluation": "ImmunizationEvaluations",
    "ImmunizationRecommendation": "ImmunizationRecommendations",
    "ImplementationGuide": "ImplementationGuides",
    "Ingredient": "Ingredients",
    "InsurancePlan": "InsurancePlans",
    "Invoice": "Invoices",
    "Library": "Libraries",
    "Linkage": "Linkages",
    "List": "Lists",
    "Location": "Locations",
    "ManufacturedItemDefinition": "ManufacturedItemDefinitions",
    "Measure": "Measures",
    "MeasureReport": "MeasureReports",
    "Media": "Media",
    "Medication": "Medications",
    "MedicationAdministration": "MedicationAdministrations",
    "MedicationDispense": "MedicationDispenses",
    "MedicationKnowledge": "MedicationKnowledges",
    "MedicationRequest": "MedicationRequests",
    "MedicationStatement": "MedicationStatements",
    "MedicinalProductDefinition": "MedicinalProductDefinitions",
    "MessageDefinition": "MessageDefinitions",
    "MessageHeader": "MessageHeaders",
    "MolecularSequence": "MolecularSequences",
    "NamingSystem": "NamingSystems",
    "NutritionOrder": "NutritionOrders",
    "NutritionProduct": "NutritionProducts",
    "Observation": "Observations",
    "ObservationDefinition": "ObservationDefinitions",
    "OperationDefinition": "OperationDefinitions",
    "OperationOutcome": "OperationOutcomes",
    "Organization": "Organizations",
    "OrganizationAffiliation": "OrganizationAffiliations",
    "PackagedProductDefinition": "PackagedProductDefinitions",
    "Parameters": "Parameters",
    "Patient": "Patients",
    "PaymentNotice": "PaymentNotices",
    "PaymentReconciliation": "PaymentReconciliations",
    "Person": "Persons",
    "PlanDefinition": "PlanDefinitions",
    "Practitioner": "Practitioners",
    "PractitionerRole": "PractitionerRoles",
    "Procedure": "Procedures",
    "Provenance": "Provenances",
    "Questionnaire": "Questionnaires",
    "QuestionnaireResponse": "QuestionnaireResponses",
    "RegulatedAuthorization": "RegulatedAuthorizations",
    "RelatedPerson": "RelatedPersons",
    "RequestGroup": "RequestGroups",
    "ResearchDefinition": "ResearchDefinitions",
    "ResearchElementDefinition": "ResearchElementDefinitions",
    "ResearchStudy": "ResearchStudies",
    "ResearchSubject": "ResearchSubjects",
    "RiskAssessment": "RiskAssessments",
    "Schedule": "Schedules",
    "SearchParameter": "SearchParameters",
    "ServiceRequest": "ServiceRequests",
    "Slot": "Slots",
    "Specimen": "Specimens",
    "SpecimenDefinition": "SpecimenDefinitions",
    "StructureDefinition": "StructureDefinitions",
    "StructureMap": "StructureMaps",
    "Subscription": "Subscriptions",
    "SubscriptionStatus": "SubscriptionStatuses",
    "SubscriptionTopic": "SubscriptionTopics",
    "Substance": "Substances",
    "SubstanceDefinition": "SubstanceDefinitions",
    "SupplyDelivery": "SupplyDeliveries",
    "SupplyRequest": "SupplyRequests",
    "Task": "Tasks",
    "TerminologyCapabilities": "TerminologyCapabilities",
    "TestReport": "TestReports",
    "TestScript": "TestScripts",
    "ValueSet": "ValueSets",
    "VerificationResult": "VerificationResults",
    "VisionPrescription": "VisionPrescriptions"
}

property_scalar_types_mapping: Dict[str, str] = {
    "base64Binary": "Base64Binary",
    "canonical": "Canonical",
    "code": "Code",
    "date": "Date",
    "dateTime": "DateTime",
    "decimal": "Float",
    "id": "ID",
    "instant": "Instant",
    "markdown": "Markdown",
    "number": "Int",
    "oid": "OID",
    "time": "Time",
    "unsignedInt": "Int",
    "uri": "URI",
    "url": "URL",
    "uuid": "UUID",
    "xhtml": "XHTML"
}

# when updating this, update in 'graphqlv2/*/custom' folder and in jinja templates if any
graphqlv2_custom_resource_type: Dict[str, str] = {
    "Subscription": "FhirSubscription",
    "Extension": "FhirExtension"
}

class FhirXmlSchemaParser:
    cleaned_type_mapping: Dict[str, str] = {
        "boolean": "Boolean",
        # "date": "date",
        # "dateTime": "dateTime",
        # "time": "time",
        # "instant": "instant",
        "integer": "Int",
        "positiveInt": "Int",
        # "decimal": "decimal",
        "string": "String",
        # "DataType": "FhirDataType",
        # "markdown": "FhirMarkdown",
        # "canonical": "FhirCanonical",
        # "List": "List_",
        # "uri": "FhirUri",
        # "url": "FhirUrl",
        # "id": "FhirId",
        # "base64Binary": "FhirBase64Binary",
        # "unsignedInt": "FhirUnsignedInt",
        # "uuid": "FhirUuid",
        # "oid": "FhirOid",
    }

    javascript_cleaned_type_mapping: Dict[str, str] = {
        "for": "for_",
        "class": "class_",
        "import": "import_",
        "extends": "extends_",
        "function": "function_",
        # "integer": "Int",
        # "positiveInt": "Int",
        # "decimal": "decimal",
        # "string": "String",
        # "DataType": "FhirDataType",
        # "markdown": "FhirMarkdown",
        # "canonical": "FhirCanonical",
        # "List": "List_",
        # "uri": "FhirUri",
        # "url": "FhirUrl",
        # "id": "FhirId",
        # "base64Binary": "FhirBase64Binary",
        # "unsignedInt": "FhirUnsignedInt",
        # "uuid": "FhirUuid",
        # "oid": "FhirOid",
    }

    @staticmethod
    def camel_to_snake(name: str) -> str:
        # name = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
        # return re.sub("([a-z0-9])([A-Z])", r"\1_\2", name).lower()
        # format for node.js
        return name[0].lower() + name[1:]

    @staticmethod
    def get_fhir_primitive_types():
        data_dir: Path = Path(__file__).parent.joinpath("./")

        fhir_xsd_all_file: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("fhir-all-xsd")
            .joinpath("fhir-single.xsd")
        )
        with open(fhir_xsd_all_file, "rb") as file:
            contents = file.read()
            root = objectify.fromstring(contents)

            types_list = [
                FhirXmlSchemaParser.camel_to_snake(element.get("name"))
                for element in root["simpleType"]
            ]
            primitive_types_dict = {}

            for type in types_list:
                primitive_types_dict[
                    type.replace("-primitive", "").replace("Enum", "")
                ] = (
                    "string"
                    if not type.endswith("-primitive")
                    else type.replace("-primitive", "")
                )
            
            primitive_types_dict['xhtml'] = 'string'

            return primitive_types_dict

    @staticmethod
    def generate_classes(filter_to_resource: Optional[str] = None) -> List[FhirEntity]:
        data_dir: Path = Path(__file__).parent.joinpath("./")
        fhir_entities: List[FhirEntity] = []

        # first read fhir-all.xsd to get a list of resources
        fhir_xsd_all_file: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("fhir-all-xsd")
            .joinpath("fhir-all.xsd")
        )
        resources: List[str] = ["fhir-base.xsd"]

        with open(fhir_xsd_all_file, "rb") as file:
            contents = file.read()
            root: ObjectifiedElement = objectify.fromstring(contents)
            resource_item: ObjectifiedElement
            for resource_item in root["include"]:
                resources.append(resource_item.get("schemaLocation"))

        resource_xsd_file_name: str
        for resource_xsd_file_name in resources:
            if (
                    filter_to_resource
                    and not resource_xsd_file_name.startswith(filter_to_resource)
                    and not resource_xsd_file_name == "fhir-base.xsd"
            ):
                continue
            resource_xsd_file: Path = (
                data_dir.joinpath("xsd")
                .joinpath("definitions.xml")
                .joinpath("fhir-all-xsd")
                .joinpath(resource_xsd_file_name)
            )
            fhir_entities.extend(
                FhirXmlSchemaParser._generate_classes_for_resource(resource_xsd_file)
            )

        for fhir_entity in fhir_entities:
            logger.info(f"2nd pass: setting flags on {fhir_entity.fhir_name}")
            if fhir_entity.fhir_name == "Resource":
                fhir_entity.is_resource = True
            if fhir_entity.fhir_name == "Extension":
                fhir_entity.is_extension = True

        # now set the types in each property
        property_type_mapping: Dict[str, FhirEntity] = {
            fhir_entity.fhir_name: fhir_entity
            for fhir_entity in fhir_entities
            if fhir_entity.type_
        }

        for fhir_entity in fhir_entities:
            logger.info(f"3rd pass: setting property types on {fhir_entity.fhir_name}")
            # set types on properties that are not set
            for fhir_property in fhir_entity.properties:
                logger.info(f"---- {fhir_property.name}: {fhir_property.type_} ----")
                if fhir_property.type_ not in property_type_mapping.keys():
                    logger.warning(
                        f"WARNING: 2nd pass: {fhir_property.type_} not found in property_type_mapping"
                    )
                else:
                    property_fhir_entity: FhirEntity = property_type_mapping[
                        fhir_property.type_
                    ]
                    fhir_property.fhir_type = property_fhir_entity.type_
                    if property_fhir_entity.base_type not in ["Element", "Reference", "BackboneElement"]:
                        fhir_property.is_complex = True
                        fhir_property.cleaned_type = fhir_property.fhir_type
                        fhir_property.graphqlv2_type = graphqlv2_custom_resource_type.get(fhir_property.fhir_type, fhir_property.fhir_type)
                        fhir_property.type_snake_case = FhirXmlSchemaParser.camel_to_snake(fhir_property.fhir_type)
                        fhir_property.scalar_type = property_scalar_types_mapping.get(fhir_property.type_snake_case)
                    fhir_property.is_resource = property_fhir_entity.is_resource
                    fhir_property.is_extension = property_fhir_entity.is_extension

        for fhir_entity in fhir_entities:
            logger.info(
                f"4th pass: inheriting properties from base {fhir_entity.fhir_name}"
            )
            # add properties from base_types
            if fhir_entity.base_type:
                fhir_base_entity = [
                    c for c in fhir_entities if c.fhir_name == fhir_entity.base_type
                ]
                if not fhir_base_entity:
                    logger.warning(
                        f"WARNING: base type {fhir_entity.base_type} not found"
                    )
                else:
                    fhir_entity.properties = (
                            fhir_base_entity[0].properties + fhir_entity.properties
                    )
                    # add the base class
                    fhir_entity.base_type_list.append(fhir_base_entity[0].fhir_name)
                    # and any base classes of the base class
                    fhir_entity.base_type_list.extend(
                        fhir_base_entity[0].base_type_list
                    )
                    if "Resource" in fhir_entity.base_type_list:
                        fhir_entity.is_resource = True

        # and the target resources for references
        FhirXmlSchemaParser.process_types_for_references(fhir_entities)

        value_sets: List[FhirValueSet] = FhirXmlSchemaParser.get_value_sets()

        # and the target types for codeable concepts
        FhirXmlSchemaParser.process_types_for_codeable_concepts(
            fhir_entities, value_sets
        )

        # remove any entities that are already in value_sets
        fhir_entities = [
            c
            for c in fhir_entities
            if c.fhir_name not in [b.name for b in value_sets]
               or c.cleaned_name in ["PractitionerRole", "ElementDefinition", "SubscriptionStatus"]
        ]
        fhir_entities.extend(
            [
                FhirEntity(
                    type_="ValueSet",
                    fhir_name=c.fhir_name,
                    name_snake_case=c.name_snake_case,
                    cleaned_name=c.cleaned_name,
                    graphqlv2_type=graphqlv2_custom_resource_type.get(c.cleaned_name, c.cleaned_name),
                    plural_name=resources_plural_names_mapping.get(c.cleaned_name, c.cleaned_name),
                    documentation=c.documentation,
                    properties=[],
                    is_back_bone_element=False,
                    is_value_set=True,
                    value_set_concepts=c.concepts,
                    value_set_url_list=c.value_set_url_list,
                    value_set_url=c.url,
                    source=c.source,
                    base_type=None,
                    base_type_list=[],
                )
                for c in value_sets
            ]
        )

        # update types
        # cleaned_type_mapping: Dict[str, str] = {
        #     "boolean": "FhirBoolean",
        #     "date": "FhirDate",
        #     "dateTime": "FhirDateTime",
        #     "integer": "FhirInteger",
        #     "string": "FhirString",
        # }
        # for fhir_entity in fhir_entities:
        #     if fhir_entity.fhir_name in cleaned_type_mapping.keys():
        #         fhir_entity.fhir_name = cleaned_type_mapping[fhir_entity.fhir_name]

        exclude_entities: List[str] = []

        fhir_entities = [
            f for f in fhir_entities if f.cleaned_name not in exclude_entities
        ]

        # cleaned names
        for fhir_entity in fhir_entities:
            if fhir_entity.fhir_name in FhirXmlSchemaParser.cleaned_type_mapping:
                fhir_entity.cleaned_name = FhirXmlSchemaParser.cleaned_type_mapping[
                    fhir_entity.fhir_name
                ]
                fhir_entity.is_basic_type = True

        # replace any lists
        value_set_names: List[str] = [c.name for c in value_sets]
        for fhir_entity in fhir_entities:
            for fhir_property in fhir_entity.properties:
                if not fhir_property.is_code and fhir_property.type_ in value_set_names:
                    fhir_property.is_code = True
                    fhir_property.cleaned_type = [
                        c.cleaned_name
                        for c in value_sets
                        if c.name == fhir_property.type_
                    ][0]
                # Consist entity name mapping to property for which we need to add a suffix name.
                update_property_name_map = {
                    'Contract': ({'subject': 'Type'}, )
                }
                if update_property_name_map.get(fhir_entity.cleaned_name) is not None:
                    for resource_property in update_property_name_map.get(fhir_entity.cleaned_name):
                        if resource_property.get(fhir_property.name) is not None:
                            fhir_property.name_suffix = resource_property.get(fhir_property.name)

        # create list of unique properties
        for fhir_entity in fhir_entities:
            fhir_entity.properties_unique = []
            has_code: bool = False
            for fhir_property in fhir_entity.properties:
                if not (has_code and fhir_property.is_code):
                    if fhir_property.is_code:
                        has_code = True

                    if not any(p for p in fhir_entity.properties_unique if p.type_ == fhir_property.type_):
                        fhir_entity.properties_unique.append(fhir_property)

        return fhir_entities

    @staticmethod
    def process_types_for_codeable_concepts(
            fhir_entities: List[FhirEntity], value_sets: List[FhirValueSet]
    ) -> None:
        codeable_types: List[
            FhirCodeableType
        ] = FhirXmlSchemaParser.get_types_for_codeable_concepts()
        codeable_type: FhirCodeableType
        for codeable_type in codeable_types:
            name_parts: List[str] = codeable_type.path.split(".")
            # find the entity corresponding to the name parts
            entity_name_parts: List[str] = name_parts[0:-1]
            fhir_entity_list: List[FhirEntity] = []
            parent_fhir_entity: Optional[FhirEntity] = None
            # parent_entity_name: Optional[str] = None
            for entity_name_part in entity_name_parts:
                if not parent_fhir_entity:
                    fhir_entity_list = [
                        f for f in fhir_entities if f.fhir_name == entity_name_part
                    ]
                    if not fhir_entity_list:
                        logger.warning(
                            f"WARNING: {entity_name_part} not found in fhir_entity_list"
                        )
                    else:
                        parent_fhir_entity = fhir_entity_list[0]
                else:
                    # find the property under the above entity
                    fhir_property_list = [
                        p
                        for p in parent_fhir_entity.properties
                        if p.name
                           == FhirXmlSchemaParser.fix_graphql_keywords(entity_name_part)
                           or (
                                   entity_name_part.endswith("[x]")
                                   and p.name
                                   == FhirXmlSchemaParser.fix_graphql_keywords(
                               entity_name_part.replace("[x]", "") + "CodeableConcept"
                           )
                           )
                    ]
                    if not fhir_property_list:
                        logger.warning(
                            f"WARNING: {entity_name_part} not found in properties of {parent_fhir_entity.fhir_name}"
                        )
                    else:
                        fhir_property = fhir_property_list[0]
                        parent_entity_name = fhir_property.cleaned_type
                        fhir_entity_list = [
                            f
                            for f in fhir_entities
                            if f.cleaned_name == parent_entity_name
                        ]
                        if not fhir_entity_list:
                            logger.warning(
                                f"WARNING: No FHIR entity list for {parent_entity_name}"
                            )
                        else:
                            parent_fhir_entity = fhir_entity_list[0]
            property_name: str = name_parts[-1]
            # find the corresponding fhir entity
            if fhir_entity_list:
                fhir_entity = fhir_entity_list[0]
                fhir_property_list = [
                    p
                    for p in fhir_entity.properties
                    if p.name == FhirXmlSchemaParser.fix_graphql_keywords(property_name)
                       or (
                               property_name.endswith("[x]")
                               and p.name
                               == FhirXmlSchemaParser.fix_graphql_keywords(
                           property_name.replace("[x]", "") + "CodeableConcept"
                       )
                       )
                ]

                if not fhir_property_list:
                    logger.warning(
                        f"WARNING: property {property_name} not found in {fhir_entity.fhir_name}"
                    )
                if fhir_property_list:
                    fhir_property = fhir_property_list[0]
                    value_set_matching = [
                        c
                        for c in value_sets
                        if (
                                   c.url
                                   and codeable_type.codeable_type_url
                                   and c.url.split("|")[0]
                                   == codeable_type.codeable_type_url.split("|")[0]
                           )
                           or (
                                   c.value_set_url
                                   and codeable_type.codeable_type_url
                                   and (
                                           c.value_set_url.split("|")[0]
                                           == codeable_type.codeable_type_url.split("|")[0]
                                   )
                           )
                    ]
                    if value_set_matching:
                        value_set = value_set_matching[0]
                        if codeable_type.is_codeable_concept:
                            # if property already has a codeable_type then we have a problem
                            if fhir_property.codeable_type:
                                logger.warning(
                                    f"WARNING: {fhir_property.name} in {fhir_entity.fhir_name} "
                                    f"already has a codeable type {fhir_property.codeable_type.name} "
                                    f"but we're trying to set it to {value_set.name}"
                                )
                            fhir_property.codeable_type = SmartName(
                                name=value_set.name,
                                cleaned_name=value_set.cleaned_name,
                                snake_case_name=value_set.name_snake_case,
                            )
                        else:
                            fhir_property.type_ = value_set.name
                            fhir_property.type_snake_case = value_set.name_snake_case
                            fhir_property.scalar_type = property_scalar_types_mapping.get(value_set.name_snake_case)
                            fhir_property.cleaned_type = value_set.cleaned_name
                            fhir_property.is_code = True
                    # putting in kludge for R4B as this field is removed in R5
                    elif fhir_property.fhir_name == "confidentiality":
                        fhir_property.is_code = True

        # set generic type for everything else
        for fhir_entity in fhir_entities:
            for property_ in fhir_entity.properties:
                if (
                        property_.cleaned_type.lower() in ["codeableconcept", "coding"]
                        and not property_.codeable_type
                ):
                    property_.codeable_type = SmartName(
                        name="generic_type",
                        cleaned_name="GenericTypeCode",
                        snake_case_name="generic_type",
                    )
                elif property_.cleaned_type == "code":
                    property_.type_ = "generic_type"
                    property_.type_snake_case = "generic_type"
                    property_.cleaned_type = "GenericTypeCode"
                    property_.is_code = True

    @staticmethod
    def process_types_for_references(fhir_entities: List[FhirEntity]) -> None:
        references: List[
            FhirReferenceType
        ] = FhirXmlSchemaParser.get_types_for_references()
        reference: FhirReferenceType
        for reference in references:
            name_parts: List[str] = reference.path.split(".")
            # find the entity corresponding to the name parts
            entity_name_parts: List[str] = name_parts[0:-1]
            fhir_entity_list: List[FhirEntity] = []
            parent_fhir_entity: Optional[FhirEntity] = None
            # parent_entity_name: Optional[str] = None
            for entity_name_part in entity_name_parts:
                if not parent_fhir_entity:
                    fhir_entity_list = [
                        f for f in fhir_entities if f.fhir_name == entity_name_part
                    ]
                    if not fhir_entity_list:
                        logger.warning(
                            f"WARNING: References: {entity_name_part} not found in fhir_entities"
                        )
                    else:
                        parent_fhir_entity = fhir_entity_list[0]
                else:
                    # find the property under the above entity
                    fhir_property_list = [
                        p
                        for p in parent_fhir_entity.properties
                        if p.name == entity_name_part
                    ]
                    if not fhir_property_list:
                        logger.warning(
                            f"WARNING: References: {entity_name_part} not found in properties of"
                            f" {parent_fhir_entity.fhir_name}"
                        )
                    else:
                        fhir_property = fhir_property_list[0]
                        parent_entity_name = fhir_property.cleaned_type
                        fhir_entity_list = [
                            f
                            for f in fhir_entities
                            if f.cleaned_name == parent_entity_name
                        ]
                        if not fhir_entity_list:
                            logger.warning(
                                f"WARNING: References: {parent_entity_name} not found in fhir_entities"
                            )
                        else:
                            parent_fhir_entity = fhir_entity_list[0]
            property_name: str = name_parts[-1]
            # find the corresponding fhir entity
            if fhir_entity_list:
                fhir_entity = fhir_entity_list[0]
                if property_name.endswith("[x]"):  # handle choice properties
                    property_name_prefix = property_name.split("[")[0]
                    fhir_property_list = [
                        p
                        for p in fhir_entity.properties
                        if p.name.startswith(property_name_prefix)
                           and p.type_ == "Reference"
                    ]
                else:
                    fhir_property_list = [
                        p
                        for p in fhir_entity.properties
                        if p.name
                           == FhirXmlSchemaParser.fix_graphql_keywords(property_name)
                    ]
                if fhir_property_list:
                    for fhir_property in fhir_property_list:
                        fhir_property.reference_target_resources = [
                            SmartName(
                                name=c,
                                cleaned_name=FhirXmlSchemaParser.cleaned_type_mapping[c]
                                if c in FhirXmlSchemaParser.cleaned_type_mapping
                                else c,
                                snake_case_name=FhirXmlSchemaParser.camel_to_snake(c),
                            )
                            for c in reference.target_resources
                        ]
                        fhir_property.reference_target_resources_names = [
                            FhirXmlSchemaParser.cleaned_type_mapping[c.name]
                            if c.name in FhirXmlSchemaParser.cleaned_type_mapping
                            else c.name
                            for c in fhir_property.reference_target_resources
                        ]
                        fhir_property.graphqlv2_reference_target_resources_names = [
                            graphqlv2_custom_resource_type.get(FhirXmlSchemaParser.cleaned_type_mapping[c.name], FhirXmlSchemaParser.cleaned_type_mapping[c.name])
                            if c.name in FhirXmlSchemaParser.cleaned_type_mapping
                            else graphqlv2_custom_resource_type.get(c.name, c.name)
                            for c in fhir_property.reference_target_resources
                        ]

        # set generic type for everything else
        for fhir_entity in fhir_entities:
            for property_ in fhir_entity.properties:
                if (
                        property_.cleaned_type in ["Reference"]
                        and not property_.reference_target_resources
                ):
                    if property_.fhir_name.endswith('V2') and len(property_.reference_target_resources) == 0:
                        continue

                    property_.reference_target_resources = [
                        SmartName(
                            name="Resource",
                            cleaned_name="Resource",
                            snake_case_name="resource",
                        )
                    ]
                    property_.reference_target_resources_names = ["Resource"]
                    property_.graphqlv2_reference_target_resources_names = ["Resource"]

    @staticmethod
    def _generate_classes_for_resource(resource_xsd_file: Path) -> List[FhirEntity]:
        logger.info(f"++++++ PROCESSING FILE {resource_xsd_file.name} +++++++++ ")
        with open(resource_xsd_file, "rb") as file:
            contents = file.read()
            root: ObjectifiedElement = objectify.fromstring(contents)

            # pprint(result)
        fhir_entities: List[FhirEntity] = []
        complex_types: ObjectifiedElement = root["complexType"]
        complex_type: ObjectifiedElement
        for complex_type in complex_types:
            complex_type_name: str = complex_type.get("name")
            cleaned_complex_type_name: str = complex_type_name.replace(".", "")
            complex_type_name_snake_case: str = FhirXmlSchemaParser.camel_to_snake(
                cleaned_complex_type_name
            )
            logger.info(f"========== {complex_type_name} ===========")
            documentation_items: ObjectifiedElement = (
                complex_type["annotation"]["documentation"]
                if hasattr(complex_type, "annotation")
                else []
            )
            documentation_item_dict: Union[ObjectifiedElement, str]
            documentation_entries: List[str] = []
            for documentation_item_dict in documentation_items:
                if hasattr(documentation_item_dict, "text"):
                    documentation: str = documentation_item_dict.text
                elif isinstance(documentation_item_dict, str):
                    documentation = documentation_item_dict
                else:
                    documentation = "Error"
                    if not isinstance(documentation_item_dict, OrderedDict):
                        raise Exception(f'documentation_item_dict type is {type(documentation_item_dict)} instead of OrderedDict')
                # print(f"// {documentation}")
                if documentation:
                    documentation_entries.append(documentation)

            inner_complex_type: Optional[ObjectifiedElement] = (
                complex_type["complexContent"]["extension"]
                if hasattr(complex_type, "complexContent")
                else None
            )
            entity_type: Optional[str] = None
            if inner_complex_type:
                entity_type = str(inner_complex_type.get("base"))
                # logger.info(f"type={entity_type}")
                fhir_properties = FhirXmlSchemaParser.generate_properties_for_class(
                    entity_name=complex_type_name, inner_complex_type=inner_complex_type
                )
            elif hasattr(complex_type, "sequence"):
                entity_type = "Element"
                fhir_properties = FhirXmlSchemaParser.generate_properties_for_class(
                    entity_name=complex_type_name, inner_complex_type=complex_type
                )
            else:
                fhir_properties = []

            # TODO: need a better check to detect value sets
            value_properties: List[bool] = [
                c.cleaned_type.endswith("-primitive")
                or c.cleaned_type.endswith("-list")
                or c.cleaned_type.endswith("Enum")
                for c in fhir_properties
                if c.fhir_name == "value" and c.cleaned_type
            ]
            if entity_type != "Element" or not any(value_properties):
                # now create the entity
                fhir_entity: FhirEntity = FhirEntity(
                    fhir_name=complex_type_name,
                    cleaned_name=cleaned_complex_type_name,
                    graphqlv2_type=graphqlv2_custom_resource_type.get(cleaned_complex_type_name, cleaned_complex_type_name),
                    plural_name=resources_plural_names_mapping.get(cleaned_complex_type_name, cleaned_complex_type_name),
                    name_snake_case=complex_type_name_snake_case,
                    type_=entity_type,
                    documentation=documentation_entries,
                    properties=fhir_properties,
                    is_back_bone_element="." in entity_type if entity_type else False,
                    base_type=inner_complex_type.get("base")
                    if hasattr(inner_complex_type, "base")
                    else None,
                    base_type_list=[inner_complex_type.get("base")]
                    if hasattr(inner_complex_type, "base")
                    else [],
                    source=str(resource_xsd_file.parts[-1]),
                )
                fhir_entities.append(fhir_entity)
        return fhir_entities

    @staticmethod
    def generate_properties_for_class(
            *,
            entity_name: str,
            inner_complex_type: ObjectifiedElement,
    ) -> List[FhirProperty]:
        logger.debug(f"Processing properties for {entity_name}")
        properties: List[ObjectifiedElement] = []
        attributes: Optional[ObjectifiedElement] = (
            inner_complex_type["attribute"]
            if hasattr(inner_complex_type, "attribute")
            else None
        )
        if attributes is not None:
            for attribute in attributes:
                properties.append(attribute)

        sequences: Optional[ObjectifiedElement] = (
            inner_complex_type["sequence"]
            if hasattr(inner_complex_type, "sequence")
            else None
        )
        if sequences is not None:
            for sequence_item in sequences.getchildren():
                if hasattr(sequence_item, "element"):
                    sequence_item_elements: ObjectifiedElement = sequence_item.element
                    properties.extend(sequence_item_elements)
                else:
                    properties.append(sequence_item)

        fhir_properties: List[FhirProperty] = []
        property_: ObjectifiedElement
        for property_ in properties:
            if "ref" in property_.attrib:
                ref_: str = str(property_.get("ref"))
                property_name: str = ref_.split(":")[-1]
                property_type: str = ref_.split(":")[0]
            else:
                property_name = str(property_.get("name"))
                property_type = str(property_.get("type"))

            # string-primitive is the same thing as string
            if property_name != "value" and property_type.endswith("-primitive"):
                property_type = property_type.replace("-primitive", "")

            # This is specified wrong in the xsd
            if property_type == "SampledDataDataType" and property_name == "data":
                property_type = "string"

            min_occurs: str = str(
                property_.get("minOccurs") if property_.get("minOccurs") else 0
            )
            max_occurs: str = str(
                property_.get("maxOccurs") if property_.get("maxOccurs") else 1
            )
            property_documentation_dict: Optional[ObjectifiedElement] = (
                property_["annotation"]["documentation"]
                if hasattr(property_, "annotation")
                else None
            )
            property_documentation: str = str(
                property_documentation_dict.text
                if property_documentation_dict
                else None
            )
            # print(
            #     f"{property_name}: {property_type} [{min_occurs}..{max_occurs}] // {property_documentation}"
            # )
            optional: bool = min_occurs == "0"
            is_list: bool = max_occurs == "unbounded"
            cleaned_type: str = property_type
            cleaned_type = cleaned_type.replace(".", "")
            if property_type and property_name and property_type != "None":
                if property_type == "Reference":
                    fhir_properties.append(
                        FhirProperty(
                            fhir_name=f'{property_name}V2',
                            name=f'{FhirXmlSchemaParser.fix_graphql_keywords(property_name)}V2',
                            javascript_clean_name=f'{FhirXmlSchemaParser.fix_javascript_keywords(property_name)}V2',
                            type_=property_type,
                            cleaned_type=FhirXmlSchemaParser.cleaned_type_mapping.get(cleaned_type, cleaned_type),
                            graphqlv2_type=graphqlv2_custom_resource_type.get(cleaned_type, cleaned_type),
                            type_snake_case=FhirXmlSchemaParser.camel_to_snake(
                                FhirXmlSchemaParser.cleaned_type_mapping.get(cleaned_type, cleaned_type)
                            ),
                            scalar_type=property_scalar_types_mapping.get(
                                FhirXmlSchemaParser.camel_to_snake(
                                    FhirXmlSchemaParser.cleaned_type_mapping.get(
                                        cleaned_type, cleaned_type
                                    )
                                )
                            ),
                            optional=optional,
                            is_list=is_list,
                            documentation=[property_documentation],
                            fhir_type=None,
                            reference_target_resources=[],
                            reference_target_resources_names=[],
                            graphqlv2_reference_target_resources_names = [],
                            is_back_bone_element="." in property_type,
                            is_basic_type=cleaned_type
                                        in FhirXmlSchemaParser.cleaned_type_mapping,
                            codeable_type=None,
                            is_v2_supported=True
                        )
                    )
                fhir_properties.append(
                    FhirProperty(
                        fhir_name=property_name,
                        name=FhirXmlSchemaParser.fix_graphql_keywords(property_name),
                        javascript_clean_name=FhirXmlSchemaParser.fix_javascript_keywords(property_name),
                        type_=property_type,
                        cleaned_type=FhirXmlSchemaParser.cleaned_type_mapping.get(cleaned_type, cleaned_type),
                        graphqlv2_type=graphqlv2_custom_resource_type.get(cleaned_type, cleaned_type),
                        type_snake_case=FhirXmlSchemaParser.camel_to_snake(
                            FhirXmlSchemaParser.cleaned_type_mapping.get(cleaned_type, cleaned_type)
                        ),
                        scalar_type=property_scalar_types_mapping.get(
                            FhirXmlSchemaParser.camel_to_snake(
                                FhirXmlSchemaParser.cleaned_type_mapping.get(
                                    cleaned_type, cleaned_type
                                )
                            )
                        ),
                        optional=optional,
                        is_list=is_list,
                        documentation=[property_documentation],
                        fhir_type=None,
                        reference_target_resources=[],
                        reference_target_resources_names=[],
                        graphqlv2_reference_target_resources_names = [],
                        is_back_bone_element="." in property_type,
                        is_basic_type=cleaned_type
                                      in FhirXmlSchemaParser.cleaned_type_mapping,
                        codeable_type=None,
                    )
                )
        return fhir_properties

    @staticmethod
    def fix_graphql_keywords(name: str) -> str:
        result: str = (
            name
            if name
               not in [
                   "as"
               ]
            else f"{name}_"
        )
        if result and result[0].isdigit():
            result = "_" + result
        return result

    @staticmethod
    def fix_javascript_keywords(name: str) -> str:
        result: str = FhirXmlSchemaParser.javascript_cleaned_type_mapping.get(name, name)
        return result

    @staticmethod
    def get_all_property_types() -> List[FhirProperty]:
        data_dir: Path = Path(__file__).parent.joinpath("./")

        # first read fhir-all.xsd to get a list of resources
        de_xml_file: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("dataelements.xml")
        )

        with open(de_xml_file, "rb") as file:
            contents: bytes = file.read()
            root: ObjectifiedElement = objectify.fromstring(contents)
            entries: ObjectifiedElement = root.entry

            fhir_properties: List[FhirProperty] = []
            entry: ObjectifiedElement
            for entry in entries:
                structure_definition: ObjectifiedElement = entry["resource"][
                    "StructureDefinition"
                ]
                name: str = structure_definition["name"].get("value")
                documentation: List[str] = structure_definition["description"].get(
                    "value"
                )
                snapshot_element: ObjectifiedElement = structure_definition["snapshot"][
                    "element"
                ]
                types: ObjectifiedElement = snapshot_element["type"]
                if not isinstance(types, OrderedDict):
                    raise Exception(f'{types} is not an instance of OrderedDict')

                # There are 3 main cases:
                # 1. A simple scalar type
                # 2. A complex type
                # 3. A reference
                # 4. A codeable type
                # 5. A value set
                type_ = types[0]["code"].get("value") if types else ""

                fhir_properties.append(
                    FhirProperty(
                        name=name,
                        fhir_name=name,
                        type_=type_,
                        cleaned_type=type_,
                        graphqlv2_type=graphqlv2_custom_resource_type.get(type_, type_),
                        type_snake_case=type_,
                        documentation=documentation,
                        is_back_bone_element=False,
                        codeable_type=None,
                        fhir_type=type_,
                        is_basic_type=False,
                        is_list=False,
                        optional=False,
                        reference_target_resources_names=[],
                        graphqlv2_reference_target_resources_names = [],
                        reference_target_resources=[],
                    )
                )

            return fhir_properties

    @staticmethod
    def get_list_of_resources():
        data_dir: Path = Path(__file__).parent.joinpath("./")
        # first read fhir-base.xsd to get a list of resources
        fhir_base_all_resources: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("fhir-all-xsd")
            .joinpath("fhir-base.xsd")
        )

        with open(fhir_base_all_resources, "rb") as resources_file:
            file_contents = resources_file.read()
            root_dir: objectify.ObjectifiedElement = objectify.fromstring(file_contents)
        resources_list = []
        for resource_container in root_dir.xpath("//xs:complexType[@name='ResourceContainer']", namespaces={"xs": "http://www.w3.org/2001/XMLSchema"}):
            for choice in resource_container.xpath(".//xs:choice/xs:element", namespaces={"xs": "http://www.w3.org/2001/XMLSchema"}):
                resources_list.append(choice.get("ref"))
        # List of all resources with Resource as base.
        resources_list.append("Resource")

        return resources_list

    @staticmethod
    def get_types_for_references(only_resources = False) -> List[FhirReferenceType]:
        data_dir: Path = Path(__file__).parent.joinpath("./")
        # List of resources to be used for reference any types.
        resources_list = FhirXmlSchemaParser.get_list_of_resources()
        fhir_references: List[FhirReferenceType] = []

        # first read fhir-all.xsd to get a list of resources
        de_xml_file: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("profiles-resources.xml")
        )

        if not only_resources:
            profile_types_xml_file: Path = (
                data_dir.joinpath("xsd")
                .joinpath("definitions.xml")
                .joinpath("profiles-types.xml")
            )

            with open(profile_types_xml_file, "rb") as file:
                contents: bytes = file.read()
                root: ObjectifiedElement = objectify.fromstring(contents)
                entries: ObjectifiedElement = root.entry

                entry: ObjectifiedElement
                for entry in entries:
                    if not hasattr(entry["resource"], "StructureDefinition"):
                        continue

                    structure_definition: ObjectifiedElement = entry["resource"]["StructureDefinition"]
                    # name: str = structure_definition["name"].get("value")
                    snapshot_elements: ObjectifiedElement = structure_definition["snapshot"]["element"]
                    snapshot_element: ObjectifiedElement
                    for snapshot_element in snapshot_elements:
                        if not hasattr(snapshot_element, 'type'):
                            continue

                        types: ObjectifiedElement = snapshot_element["type"]
                        type_: ObjectifiedElement
                        for type_ in types:
                            type_code_obj = type_["code"]
                            type_code: str = type_code_obj.get("value")
                            if type_code.endswith("Reference"):
                                if not hasattr(type_, "targetProfile"):
                                    logger.warning(
                                        f'ASSERT: targetProfile not in {type_} for {snapshot_element["path"].get("value")}'
                                    )
                                if hasattr(type_, "targetProfile"):
                                    target_profile_list: ObjectifiedElement = type_[
                                        "targetProfile"
                                    ]
                                    target_profiles: List[str] = [
                                        c.get("value") for c in target_profile_list
                                    ]
                                    target_resources: List[str] = [
                                        c.split("/")[-1] for c in target_profiles
                                    ]
                                    # If target resource is type Reference(Any),
                                    # the target resource will be a list of all resources.
                                    if "Resource" in target_resources:
                                        fhir_reference: FhirReferenceType = FhirReferenceType(
                                            target_resources=target_resources,
                                            path=snapshot_element["path"].get("value"),
                                        )
                                        fhir_reference_v2_support: FhirReferenceType = FhirReferenceType(
                                            target_resources=resources_list,
                                            path=f'{snapshot_element["path"].get("value")}V2',
                                        )
                                        fhir_references.append(fhir_reference_v2_support)
                                    # Else target resource is the list of allowed references.
                                    else :
                                        fhir_reference: FhirReferenceType = FhirReferenceType(
                                            target_resources=target_resources,
                                            path=snapshot_element["path"].get("value"),
                                        )
                                    fhir_references.append(fhir_reference)

        with open(de_xml_file, "rb") as file:
            contents: bytes = file.read()
            root: ObjectifiedElement = objectify.fromstring(contents)
            entries: ObjectifiedElement = root.entry

            entry: ObjectifiedElement
            for entry in entries:
                if not hasattr(entry["resource"], "StructureDefinition"):
                    continue

                structure_definition: ObjectifiedElement = entry["resource"]["StructureDefinition"]
                # name: str = structure_definition["name"].get("value")
                snapshot_elements: ObjectifiedElement = structure_definition["snapshot"]["element"]
                snapshot_element: ObjectifiedElement
                for snapshot_element in snapshot_elements:
                    if not hasattr(snapshot_element, 'type'):
                        continue

                    types: ObjectifiedElement = snapshot_element["type"]
                    type_: ObjectifiedElement
                    for type_ in types:
                        type_code_obj = type_["code"]
                        type_code: str = type_code_obj.get("value")
                        if type_code.endswith("Reference"):
                            if not hasattr(type_, "targetProfile"):
                                logger.warning(
                                    f'ASSERT: targetProfile not in {type_} for {snapshot_element["path"].get("value")}'
                                )
                            if hasattr(type_, "targetProfile"):
                                target_profile_list: ObjectifiedElement = type_[
                                    "targetProfile"
                                ]
                                target_profiles: List[str] = [
                                    c.get("value") for c in target_profile_list
                                ]
                                target_resources: List[str] = [
                                    c.split("/")[-1] for c in target_profiles
                                ]
                                # If target resource is type Reference(Any),
                                # the target resource will be a list of all resources.
                                if "Resource" in target_resources:
                                    fhir_reference: FhirReferenceType = FhirReferenceType(
                                        target_resources=target_resources,
                                        path=snapshot_element["path"].get("value"),
                                    )
                                    fhir_reference_v2_support: FhirReferenceType = FhirReferenceType(
                                        target_resources=resources_list,
                                        path=f'{snapshot_element["path"].get("value")}V2',
                                    )
                                    fhir_references.append(fhir_reference_v2_support)
                                # Else target resource is the list of allowed references.
                                else :
                                    fhir_reference: FhirReferenceType = FhirReferenceType(
                                        target_resources=target_resources,
                                        path=snapshot_element["path"].get("value"),
                                    )
                                fhir_references.append(fhir_reference)

        return fhir_references

    @staticmethod
    def get_types_for_codeable_concepts() -> List[FhirCodeableType]:
        data_dir: Path = Path(__file__).parent.joinpath("./")

        # first read fhir-all.xsd to get a list of resources
        de_xml_file: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("profiles-resources.xml")
        )

        with open(de_xml_file, "rb") as file:
            contents: bytes = file.read()
            root: ObjectifiedElement = objectify.fromstring(contents)
            entries: ObjectifiedElement = root.entry

            fhir_codeable_types: List[FhirCodeableType] = []
            entry: ObjectifiedElement
            for entry in entries:
                if not hasattr(entry["resource"], "StructureDefinition"):
                    continue

                structure_definition: ObjectifiedElement = entry["resource"]["StructureDefinition"]
                snapshot_elements: ObjectifiedElement = structure_definition["snapshot"]["element"]

                for snapshot_element in snapshot_elements:
                    if not hasattr(snapshot_element, "type"):
                        continue
                    type_ = snapshot_element["type"]

                    if type_["code"].get("value") in [ "Coding", "CodeableConcept", "code" ] and hasattr(snapshot_element, "binding"):
                        bindings: ObjectifiedElement = snapshot_element["binding"]
                        binding: ObjectifiedElement
                        for binding in bindings:
                            extension_code_list = binding["extension"]
                            url: str = "http://hl7.org/fhir/StructureDefinition/elementdefinition-bindingName"
                            value_set_url = (
                                binding["valueSet"].get("value")
                                if hasattr(binding, "valueSet")
                                else None
                            )
                            codeable_type_list: List[ObjectifiedElement] = [
                                bind
                                for bind in extension_code_list
                                if bind.get("url") == url
                            ]
                            if codeable_type_list:
                                codeable_type_obj: ObjectifiedElement = (
                                    codeable_type_list[0]
                                )
                                codeable_type: str = codeable_type_obj[
                                    "valueString"
                                ].get("value")
                                fhir_codeable_types.append(
                                    FhirCodeableType(
                                        path=snapshot_element["path"].get("value"),
                                        codeable_type=codeable_type,
                                        codeable_type_url=value_set_url,
                                        is_codeable_concept=type_["code"].get("value") in ["Coding", "CodeableConcept"],
                                    )
                                )
            return fhir_codeable_types

    @staticmethod
    def get_value_sets() -> List[FhirValueSet]:
        data_dir: Path = Path(__file__).parent.joinpath("./")

        fhir_value_sets: List[FhirValueSet] = []

        value_sets_file: Path = (
            data_dir.joinpath("xsd")
            .joinpath("definitions.xml")
            .joinpath("valuesets.xml")
        )
        with open(value_sets_file, "rb") as file:
            contents: bytes = file.read()
            root: ObjectifiedElement = objectify.fromstring(contents)
            entries: ObjectifiedElement = root.entry

        entry: ObjectifiedElement
        for entry in entries:
            value_set_resource = entry["resource"]
            is_code_system = hasattr(value_set_resource, "CodeSystem")
            value_set = (
                value_set_resource["CodeSystem"]
                if is_code_system
                else value_set_resource["ValueSet"]
            )
            id_ = value_set["id"].get("value")
            fhir_name: str = value_set["name"].get("value")
            name: str = fhir_name.replace("v3.", "")
            description: Union[List[str], str] = (
                value_set["description"].get("value")
                if hasattr(value_set, "description")
                else ""
            )
            if not isinstance(description, list):
                description = [description]
            url = value_set["url"].get("value")
            value_set_url = (
                value_set["valueSet"].get("value")
                if hasattr(value_set, "valueSet")
                else None
            )
            value_set_url_list: Set[str] = set()
            fhir_concepts: List[FhirValueSetConcept] = []
            if hasattr(value_set, "concept"):
                concepts: ObjectifiedElement = value_set["concept"]
                concept: ObjectifiedElement
                for concept in concepts:
                    fhir_concepts.append(
                        FhirXmlSchemaParser.create_concept(
                            concept, source="valuesets.xml", value_set_url=url
                        )
                    )
            if hasattr(value_set, "compose"):
                compose_includes: ObjectifiedElement = value_set["compose"]["include"]
                compose_include: ObjectifiedElement
                for compose_include in compose_includes:
                    is_code_system = hasattr(compose_include, "system")
                    is_value_set = hasattr(compose_include, "valueSet")
                    if is_code_system or is_value_set:
                        compose_include_code_system: str = (
                            compose_include["system"].get("value")
                            if is_code_system
                            else compose_include["valueSet"].get("value")
                        )
                        # find the corresponding item in code systems
                        if compose_include_code_system not in value_set_url_list and is_code_system:
                            value_set_url_list.add(compose_include_code_system)
                    if hasattr(compose_include, "concept"):
                        concepts = compose_include["concept"]
                        for concept in concepts:
                            fhir_concepts.append(
                                FhirXmlSchemaParser.create_concept(
                                    concept, source="valuesets.xml", value_set_url=url
                                )
                            )
            if "/" in name:
                name = name.replace("/", "_or_")
            if "/" not in name:
                fhir_value_sets.append(
                    FhirValueSet(
                        id_=id_,
                        name=name,
                        fhir_name=fhir_name,
                        name_snake_case=FhirXmlSchemaParser.camel_to_snake(
                            FhirXmlSchemaParser.clean_name(name)
                        ),
                        cleaned_name=FhirXmlSchemaParser.clean_name(name) + "Code",
                        concepts=fhir_concepts,
                        url=url,
                        value_set_url=value_set_url,
                        value_set_url_list=value_set_url_list or {url},
                        documentation=description,
                        source="valuesets.xml",
                    )
                )
            else:
                logger.warning(f"WARNING: value set {name} contains /")

        # for each value_set, if there is a code system and a value system with same name then choose valueset
        for fhir_value_set in fhir_value_sets:
            value_set_url_list = set()
            for value_set_url in fhir_value_set.value_set_url_list:
                if value_set_url.endswith("/"):
                    value_set_url = value_set_url[0:-1]
                value_set_url_name: str = value_set_url.split("/")[-1]
                if value_set_url_name != "" and value_set_url_name in [
                    c.split("/")[-1] for c in value_set_url_list
                ]:
                    # do nothing
                    pass
                else:
                    value_set_url_list.add(value_set_url)
            fhir_value_set.value_set_url_list = value_set_url_list
        return fhir_value_sets

    @staticmethod
    def create_concept(
            concept: ObjectifiedElement, source: str, value_set_url: str
    ) -> FhirValueSetConcept:
        code: str = concept["code"].get("value")
        display_value: str = (
            concept["display"].get("value") if hasattr(concept, "display") else code
        )
        cleaned_display: str = FhirXmlSchemaParser.clean_name(display_value)
        definition: Optional[str] = (
            concept["definition"].get("value")
            if hasattr(concept, "definition")
            else None
        )
        return FhirValueSetConcept(
            code=code,
            display=display_value,
            cleaned_display=cleaned_display,
            definition=definition,
            source=source,
            value_set_url=value_set_url,
        )

    @staticmethod
    def clean_name(display: str) -> str:
        cleaned_display: str = "".join(
            [c[:1].upper() + c[1:] for c in display.split(" ")]
        )
        cleaned_display = re.sub("[^0-9a-zA-Z]+", "_", cleaned_display)
        cleaned_display = FhirXmlSchemaParser.fix_graphql_keywords(cleaned_display)
        return cleaned_display

    @staticmethod
    def get_value_set(
        is_code_system: bool, is_value_set: bool, value_set_entry_resource: ObjectifiedElement,
        value_set_entry: Dict[str, Any]
    ) -> ObjectifiedElement:
        value_set: ObjectifiedElement = None
        if is_value_set:
            value_set = value_set_entry_resource["ValueSet"]
        elif is_code_system:
            value_set = value_set_entry_resource["CodeSystem"]
        else:
            value_set = value_set_entry["resource"]
        return value_set
