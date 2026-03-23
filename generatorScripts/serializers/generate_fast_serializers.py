# This file implements the code generator for generating schema and resolvers for FHIR
# It reads the FHIR XML schema and generates resolvers in the resolvers folder and schema in the schema folder

import os
import shutil
import sys
from os import path
from pathlib import Path
from typing import List
from jinja2 import Template

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirEntity, FhirXmlSchemaParser

# Configuration for custom serializers
# Maps entity name to custom Jinja template file path
# Each custom template should contain all custom imports and methods
# For making custom serializer, copy the main jinja file and modify as needed,
# then add an entry here with the entity name and template path
CUSTOM_SERIALIZERS_CONFIG = {"Coding": "custom_serializers/coding.jinja2"}

CUSTOM_SERIALIZER_PROPERTIES_CONFIG = {
    "Resource": [
        {"name": "_access", "type": "null"},
        {"name": "_sourceAssigningAuthority", "type": "null"},
        {"name": "_uuid", "type": "null"},
        {"name": "_sourceId", "type": "null"},
    ],
    "Reference": [
        {"name": "_sourceAssigningAuthority", "type": "null"},
        {"name": "_uuid", "type": "null"},
        {"name": "_sourceId", "type": "null"},
    ],
    "Attachment": [{"name": "_file_id", "type": "null"}],
}


def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")
    fhir_dir = Path("src/fhir/")
    serializers_dir: Path = fhir_dir.joinpath("writeSerializers/4_0_0/")
    serializer_template_file_name = "template.javascript.serializer.jinja2"

    # clean out old stuff for serializers
    serializers_resources_folder = serializers_dir.joinpath("resources")
    if os.path.exists(serializers_resources_folder):
        shutil.rmtree(serializers_resources_folder)
    serializers_resources_folder.mkdir(parents=True, exist_ok=True)

    serializers_complex_types_folder = serializers_dir.joinpath(
        "complexTypes"
    )
    if os.path.exists(serializers_complex_types_folder):
        shutil.rmtree(serializers_complex_types_folder)
    serializers_complex_types_folder.mkdir(parents=True, exist_ok=True)

    serializers_backbone_elements_folder = serializers_dir.joinpath(
        "backboneElements"
    )
    if os.path.exists(serializers_backbone_elements_folder):
        shutil.rmtree(serializers_backbone_elements_folder)
    serializers_backbone_elements_folder.mkdir(parents=True, exist_ok=True)

    fhir_entities: List[FhirEntity] = FhirXmlSchemaParser.generate_classes()

    # now print the result
    for fhir_entity in fhir_entities:
        # use template to generate new code files
        entity_file_name = fhir_entity.name_snake_case

        # Check if this entity has a custom template
        template_file_path = CUSTOM_SERIALIZERS_CONFIG.get(
            fhir_entity.cleaned_name, serializer_template_file_name
        )

        # Check if there are extra properties to be added to the serializer for this entity
        extra_properties = CUSTOM_SERIALIZER_PROPERTIES_CONFIG.get(
            fhir_entity.cleaned_name, []
        )
        output_folder = serializers_resources_folder

        if fhir_entity.is_value_set:
            continue

        elif fhir_entity.is_resource:
            if not extra_properties:
                extra_properties = CUSTOM_SERIALIZER_PROPERTIES_CONFIG.get("Resource", [])
            output_folder = serializers_resources_folder

        elif fhir_entity.type_ == "BackboneElement" or fhir_entity.is_back_bone_element:
            output_folder = serializers_backbone_elements_folder

        elif (
            fhir_entity.is_extension
            or fhir_entity.type_ == "Element"
            or fhir_entity.type_ in ["Quantity"]
        ):
            output_folder = serializers_complex_types_folder
        else:
            print(
                f"Skipping {fhir_entity.cleaned_name} as it is not a resource, backbone element, extension, or complex type."
            )
            continue

        with open(data_dir.joinpath(template_file_path), "r") as file:
            template_contents = file.read()
            file_path = output_folder.joinpath(f"{entity_file_name}.js")
            print(f"Writing: {entity_file_name} to {file_path}...")
            template = Template(template_contents, trim_blocks=True, lstrip_blocks=True, autoescape=True)
            result = template.render(
                fhir_entity=fhir_entity,
                extra_properties=extra_properties,
            )

        if not path.exists(file_path):
            with open(file_path, "w") as file2:
                file2.write(result)

    # Add indexes
    indexFilePath = serializers_resources_folder.joinpath("index.js")
    complexTypeIndexFilePath = serializers_complex_types_folder.joinpath(
        "index.js"
    )
    index_template_name = "template.javascript.serializer.index.jinja2"

    fhir_index_entities: List[FhirEntity] = [f for f in fhir_entities if f.is_resource]

    with open(data_dir.joinpath(index_template_name), "r") as file:
        template = Template(file.read(), trim_blocks=True, lstrip_blocks=True, autoescape=True)
        result = template.render(
            fhir_entities=fhir_index_entities,
        )
    if not path.exists(indexFilePath):
        with open(indexFilePath, "w") as file2:
            file2.write(result)

    fhir_entities: List[FhirEntity] = [
        f
        for f in fhir_entities
        if f.type_ == "Element" and f.cleaned_name != "Resource"
    ]

    with open(data_dir.joinpath(index_template_name), "r") as file:
        template = Template(file.read(), trim_blocks=True, lstrip_blocks=True, autoescape=True)
        result = template.render(
            fhir_entities=fhir_entities,
        )
    if not path.exists(complexTypeIndexFilePath):
        with open(complexTypeIndexFilePath, "w") as file2:
            file2.write(result)

    return 0


if __name__ == "__main__":
    exit(main())
