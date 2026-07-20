# This file implements the code generator for generating schema and resolvers for FHIR
# It reads the FHIR XML schema and generates resolvers in the resolvers folder and schema in the schema folder

import json
import os
import shutil
import sys
from os import path
from pathlib import Path
from typing import Any, Dict, List
from jinja2 import Environment, FileSystemLoader

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

# Resolves to BlobMetaSerializer in src/fhir/writeSerializers/4_0_0/customSerializers/.
# Hand-written there because BlobMeta is not in the FHIR R4B schema.
_BLOB_META_EXTRA_PROPERTY: Dict[str, Any] = {
    "name": "_blobMeta",
    "is_complex": True,
    "cleaned_type": "BlobMeta",
    "import_path": "../customSerializers/blobMeta.js",
}


def _load_blob_meta_targets() -> Dict[str, List[Dict[str, Any]]]:
    """
    Read src/dataLayer/base64DataResources.json and derive, for each entry, which
    FHIR class's serializer should include `_blobMeta` in its allPropertyToSerializerMap.
    Mirrors the resolution logic in generatorScripts/classes/generate_classes.py.
    """
    config_path = Path("src/dataLayer/base64DataResources.json")
    if not config_path.exists():
        return {}
    with open(config_path, "r") as f:
        config: Dict[str, List[Dict[str, str]]] = json.load(f)

    targets: Dict[str, List[Dict[str, Any]]] = {}
    for resource_type, entries in config.items():
        for entry in entries:
            blob_meta_path: str = entry["blobMetaPath"]
            segments = [s for s in blob_meta_path.split("/") if s and s != "[]"]
            if segments == ["_blobMeta"]:
                target_entity = resource_type
            elif segments[-2:] == ["attachment", "_blobMeta"]:
                target_entity = "Attachment"
            else:
                target_entity = resource_type
            targets.setdefault(target_entity, [])
            if _BLOB_META_EXTRA_PROPERTY not in targets[target_entity]:
                targets[target_entity].append(_BLOB_META_EXTRA_PROPERTY)
    return targets


def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")
    fhir_dir = Path("src/fhir/")
    serializers_dir: Path = fhir_dir.joinpath("writeSerializers/4_0_0/")
    serializer_template_file_name = "template.javascript.serializer.jinja2"

    # Set up Jinja2 environment with FileSystemLoader for template inheritance
    env = Environment(
        loader=FileSystemLoader(str(data_dir)),
        trim_blocks=True,
        lstrip_blocks=True,
        autoescape=True
    )

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

    blob_meta_targets: Dict[str, List[Dict[str, Any]]] = _load_blob_meta_targets()

    # now print the result
    for fhir_entity in fhir_entities:
        # use template to generate new code files
        entity_file_name = fhir_entity.name_snake_case

        # Check if this entity has a custom template
        template_file_path = CUSTOM_SERIALIZERS_CONFIG.get(
            fhir_entity.cleaned_name, serializer_template_file_name
        )

        # Check if there are extra properties to be added to the serializer for this entity.
        # Copy so we can append blob_meta entries without mutating the shared config.
        extra_properties = list(
            CUSTOM_SERIALIZER_PROPERTIES_CONFIG.get(fhir_entity.cleaned_name, [])
        )
        output_folder = serializers_resources_folder

        if fhir_entity.is_value_set:
            continue

        elif fhir_entity.is_resource:
            if not extra_properties:
                extra_properties = list(
                    CUSTOM_SERIALIZER_PROPERTIES_CONFIG.get("Resource", [])
                )
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

        # Inject _blobMeta entries for any entity targeted by base64DataResources.json
        extra_properties.extend(blob_meta_targets.get(fhir_entity.cleaned_name, []))

        file_path = output_folder.joinpath(f"{entity_file_name}.js")
        print(f"Writing: {entity_file_name} to {file_path}...")
        template = env.get_template(template_file_path)
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

    template = env.get_template(index_template_name)
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

    template = env.get_template(index_template_name)
    result = template.render(
        fhir_entities=fhir_entities,
    )
    if not path.exists(complexTypeIndexFilePath):
        with open(complexTypeIndexFilePath, "w") as file2:
            file2.write(result)

    return 0


if __name__ == "__main__":
    exit(main())
