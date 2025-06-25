# This file implements the code generator for generating schema and resolvers for FHIR
# It reads the FHIR XML schema and generates resolvers in the resolvers folder and schema in the schema folder

import json
import os
import shutil
import sys
from jinja2 import Template
from os import path
from pathlib import Path
from typing import Union, List, Dict, Any

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirXmlSchemaParser
from generatorScripts.search_parameters import search_parameter_queries
from generatorScripts.fhir_xml_schema_parser import FhirEntity
from generatorScripts.generate_everything_operation_data import get_clinical_resources_and_filters

# data for applying custom directives to graphql types or fields
custom_data = {
    "shareable_directive": [
        "CodeSystemProperty",
        "OperationOutcomeIssue",
        "PatientCommunication",
        "Address",
        "Attachment",
        "CodeableConcept",
        "Coding",
        "ContactPoint",
        "Expression",
        "IdentifierAssignerReference",
        "Identifier",
        "Meta",
        "Period",
        "Reference",
        "Extension",
        "HumanName"
    ],
    "inaccessible_directive": {
        "Identifier": ["extension", "use", "period", "assigner"],
        "Period": ["id", "extension"],
        "Reference": ["id", "extension"],
        "FhirExtension": [
            "extension",
            "valueBase64Binary",
            "valueCanonical",
            "valueCode",
            "valueDate",
            "valueDateTime",
            "valueDecimal",
            "valueId",
            "valueInstant",
            "valueMarkdown",
            "valueOid",
            "valuePositiveInt",
            "valueTime",
            "valueUnsignedInt",
            "valueUri",
            "valueUrl",
            "valueUuid",
            "valueAddress",
            "valueAge",
            "valueAnnotation",
            "valueAttachment",
            "valueCodeableReference",
            "valueCoding",
            "valueContactPoint",
            "valueCount",
            "valueDistance",
            "valueDuration",
            "valueHumanName",
            "valueIdentifier",
            "valueMoney",
            "valuePeriod",
            "valueQuantity",
            "valueRange",
            "valueRatio",
            "valueRatioRange",
            "valueReference",
            "valueSampledData",
            "valueSignature",
            "valueTiming",
            "valueContactDetail",
            "valueContributor",
            "valueDataRequirement",
            "valueParameterDefinition",
            "valueRelatedArtifact",
            "valueTriggerDefinition",
            "valueUsageContext",
            "valueDosage"
        ]
    },
}

def my_copytree(
        src: Union[Path, str],
        dst: Union[Path, str],
        symlinks: bool = False,
        # ignore: Union[
        #     None,
        #     Callable[[str, List[str]], Iterable[str]],
        #     Callable[[Union[str, os.PathLike[str]], List[str]], Iterable[str]],
        # ] = None,
) -> None:
    for item in os.listdir(src):
        s = os.path.join(src, item)
        d = os.path.join(dst, item)
        if os.path.isdir(s):
            shutil.copytree(s, d, symlinks)
        else:
            shutil.copy2(s, d)

def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")
    parent_schema_dir = Path("src/graphqlv2")
    graphql_schema_dir: Path = parent_schema_dir.joinpath("schemas")
    graphql_resolvers_dir: Path = parent_schema_dir.joinpath("resolvers")

    # clean out old stuff
    resources_folder = graphql_schema_dir.joinpath("resources")
    if os.path.exists(resources_folder):
        shutil.rmtree(resources_folder)
    os.mkdir(resources_folder)

    interfaces_folder = graphql_schema_dir.joinpath("interfaces")
    if os.path.exists(interfaces_folder):
        shutil.rmtree(interfaces_folder)
    os.mkdir(interfaces_folder)

    queries_folder = graphql_schema_dir.joinpath("queries")
    if os.path.exists(queries_folder):
        shutil.rmtree(queries_folder)
    os.mkdir(queries_folder)

    resource_resolvers_folder = graphql_resolvers_dir.joinpath("resources")
    if os.path.exists(resource_resolvers_folder):
        shutil.rmtree(resource_resolvers_folder)
    os.mkdir(resource_resolvers_folder)

    interface_resolvers_folder = graphql_resolvers_dir.joinpath("interfaces")
    if os.path.exists(interface_resolvers_folder):
        shutil.rmtree(interface_resolvers_folder)
    os.mkdir(interface_resolvers_folder)

    complex_types_folder = graphql_schema_dir.joinpath("complex_types")
    if os.path.exists(complex_types_folder):
        shutil.rmtree(complex_types_folder)
    os.mkdir(complex_types_folder)

    complex_resolvers_types_folder = graphql_resolvers_dir.joinpath("complex_types")
    if os.path.exists(complex_resolvers_types_folder):
        shutil.rmtree(complex_resolvers_types_folder)
    os.mkdir(complex_resolvers_types_folder)

    extensions_folder = graphql_schema_dir.joinpath("extensions")
    if os.path.exists(extensions_folder):
        shutil.rmtree(extensions_folder)
    os.mkdir(extensions_folder)

    extensions_resolvers_folder = graphql_resolvers_dir.joinpath("extensions")
    if os.path.exists(extensions_resolvers_folder):
        shutil.rmtree(extensions_resolvers_folder)
    os.mkdir(extensions_resolvers_folder)

    backbone_elements_folder = graphql_schema_dir.joinpath("backbone_elements")
    if os.path.exists(backbone_elements_folder):
        shutil.rmtree(backbone_elements_folder)
    os.mkdir(backbone_elements_folder)

    backbone_elements_resolvers_folder = graphql_resolvers_dir.joinpath("backbone_elements")
    if os.path.exists(backbone_elements_resolvers_folder):
        shutil.rmtree(backbone_elements_resolvers_folder)
    os.mkdir(backbone_elements_resolvers_folder)

    custom_patient_schema = graphql_schema_dir.joinpath("./custom/patient.graphql")
    if os.path.exists(custom_patient_schema):
        os.remove(custom_patient_schema)

    custom_patient_resolver = graphql_resolvers_dir.joinpath("./custom/patient.js")
    if os.path.exists(custom_patient_resolver):
        os.remove(custom_patient_resolver)

    fhir_entities: List[FhirEntity] = FhirXmlSchemaParser.generate_classes()

    # generate schema.graphql
    with open(data_dir.joinpath("template.query.jinja2"), "r") as file:
        template_contents = file.read()

        file_path = graphql_schema_dir.joinpath("schema.graphql")
        template = Template(
            template_contents, trim_blocks=True, lstrip_blocks=True
        )
        result = template.render(
            fhir_entities=[f for f in fhir_entities if f.is_resource],
        )
        with open(file_path, "w") as file2:
            file2.write(result)

    # now print the result
    for fhir_entity in fhir_entities:
        # use template to generate new code files
        resource_name: str = fhir_entity.cleaned_name
        entity_file_name = fhir_entity.name_snake_case

        if fhir_entity.is_value_set:  # valueset
            pass

        elif fhir_entity.is_resource and fhir_entity.fhir_name in ["Resource", "DomainResource"]:
            # write interface schema
            with open(data_dir.joinpath("schema/template.interface.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = interfaces_folder.joinpath(f"{entity_file_name}.graphql")
                print(f"Writing interface: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)

            # write interface resolvers
            with open(data_dir.joinpath("resolvers/template.interface.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = interface_resolvers_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing interface resolver: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)

        elif fhir_entity.is_resource:
            search_parameters_for_all_resources: Dict[str, Dict[str, Any]] = (
                search_parameter_queries.get("Resource", {}) if fhir_entity.fhir_name != "Resource" else {}
            )
            search_parameters_for_current_resource: Dict[str, Dict[str, Any]] = (
                search_parameter_queries.get(fhir_entity.fhir_name, {})
            )
            # write schema
            with open(data_dir.joinpath("schema/template.resource.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = resources_folder.joinpath(f"{entity_file_name}.graphql")
                print(f"Writing domain resource: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                    search_parameters_for_all_resources=search_parameters_for_all_resources,
                    search_parameters_for_current_resource=search_parameters_for_current_resource,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
            # write queries
            with open(data_dir.joinpath("template.resource_queriesv2.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = queries_folder.joinpath(f"{entity_file_name}.graphql")
                print(f"Writing query: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                    search_parameters_for_all_resources=search_parameters_for_all_resources,
                    search_parameters_for_current_resource=search_parameters_for_current_resource,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
            # write resolvers
            with open(data_dir.joinpath("resolvers/template.resource.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = resource_resolvers_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing domain resource resolver: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        elif fhir_entity.type_ == "BackboneElement" or fhir_entity.is_back_bone_element:
            with open(
                    data_dir.joinpath("schema/template.backbone_element.jinja2"), "r"
            ) as file:
                template_contents = file.read()

                file_path = backbone_elements_folder.joinpath(f"{entity_file_name}.graphql")
                print(
                    f"Writing backbone_elements_folder: {entity_file_name} to {file_path}..."
                )
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity, custom_data=custom_data
                )

            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
            # write resolvers
            with open(data_dir.joinpath("resolvers/template.backbone_element.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = backbone_elements_resolvers_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing domain resource resolver: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)

        elif fhir_entity.is_extension:  # valueset
            with open(data_dir.joinpath("schema/template.complex_type.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = extensions_folder.joinpath(f"{entity_file_name}.graphql")
                print(f"Writing extension: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity, custom_data=custom_data
                )

            with open(file_path, "w") as file2:
                file2.write(result)
            # write resolvers
            with open(data_dir.joinpath("resolvers/template.complex_type.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = extensions_resolvers_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing extension resolver: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)

        elif fhir_entity.type_ == "Element":  # valueset
            with open(data_dir.joinpath("schema/template.complex_type.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = complex_types_folder.joinpath(f"{entity_file_name}.graphql")
                print(f"Writing complex_type: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity, custom_data=custom_data
                )

            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
            # write resolvers
            with open(data_dir.joinpath("resolvers/template.complex_type.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = complex_resolvers_types_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing domain resource resolver: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)

        elif fhir_entity.type_ in ["Quantity"]:  # valueset
            with open(data_dir.joinpath("schema/template.complex_type.jinja2"), "r") as file:
                template_contents = file.read()

                file_path = complex_types_folder.joinpath(f"{entity_file_name}.graphql")
                print(f"Writing complex_type: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity, custom_data=custom_data
                )

            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        else:
            print(f"{resource_name}: {fhir_entity.type_} is not supported")
        # print(result)

    # write custom patient schema using patient everything.json graph definition
    patient_graphs: Path = Path("src/graphs/patient")
    json_file_path = patient_graphs.joinpath("everything.json")
    with open(json_file_path, "r") as json_file:
        patient_everything_graph = json.load(json_file)

    clinical_resources, patient_resources_search_param_dict = list(get_clinical_resources_and_filters(patient_everything_graph))
    clinical_resources.remove("Patient")

    patient_entities = [fhir_entity for fhir_entity in fhir_entities if fhir_entity.is_resource and fhir_entity.fhir_name in clinical_resources]
    with open(data_dir.joinpath("schema/template.patient_custom.jinja2"), "r") as file:
        template_contents = file.read()

        print(f"Writing custom patient queries to {custom_patient_schema}...")
        template = Template(
            template_contents, trim_blocks=True, lstrip_blocks=True
        )
        result = template.render(
            fhir_entities=patient_entities,
        )
        if not path.exists(custom_patient_schema):
            with open(custom_patient_schema, "w") as file2:
                file2.write(result)

    with open(data_dir.joinpath("resolvers/template.patient_custom.jinja2"), "r") as file:
        template_contents = file.read()

        print(f"Writing custom patient resolver to {custom_patient_resolver}...")
        template = Template(
            template_contents, trim_blocks=True, lstrip_blocks=True
        )
        result = template.render(
            fhir_entities=patient_entities,
            patient_resources_search_param_dict = patient_resources_search_param_dict
        )
        if not path.exists(custom_patient_resolver):
            with open(custom_patient_resolver, "w") as file2:
                file2.write(result)

    print("------ Finished generating classes ------")
    return 0


if __name__ == "__main__":
    exit(main())
