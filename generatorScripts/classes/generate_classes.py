# This file implements the code generator for generating schema and resolvers for FHIR
# It reads the FHIR XML schema and generates resolvers in the resolvers folder and schema in the schema folder

import json
import os
import shutil
from os import path
from pathlib import Path
from typing import Union, List, Dict, Any
import sys

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirXmlSchemaParser
from generatorScripts.search_parameters import search_parameter_queries
from generatorScripts.fhir_xml_schema_parser import FhirEntity


# Import path for BlobMeta from a generated resource/complex_type/backbone class.
# All three live two directories deep under src/fhir/classes/4_0_0/, so the
# relative import is identical from each.
_BLOB_META_EXTRA_PROPERTY: Dict[str, Any] = {
    "name": "_blobMeta",
    "type": "BlobMeta",
    "is_complex": True,
    "import_path": "../custom_resources/blobMeta.js"
}


def _load_blob_meta_targets() -> Dict[str, List[Dict[str, Any]]]:
    """
    Read src/dataLayer/base64DataResources.json and derive, for each entry, the
    FHIR class on which a `_blobMeta` field should be defined. Root-level paths
    target the resource itself; nested paths through an Attachment target the
    Attachment complex type. Returns a dict keyed by FHIR entity cleaned_name.
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
            # Resolve the target entity from the blobMetaPath:
            #   "/_blobMeta"                          -> the resource itself
            #   "/content/[]/attachment/_blobMeta"    -> the Attachment complex type
            segments = [s for s in blob_meta_path.split("/") if s and s != "[]"]
            if segments == ["_blobMeta"]:
                target_entity = resource_type
            elif segments[-2:] == ["attachment", "_blobMeta"]:
                target_entity = "Attachment"
            else:
                # Unknown sidecar location — fall back to the resource itself so
                # we don't silently drop the entry. Add explicit handling here
                # when new sidecar locations are needed.
                target_entity = resource_type
            targets.setdefault(target_entity, [])
            if _BLOB_META_EXTRA_PROPERTY not in targets[target_entity]:
                targets[target_entity].append(_BLOB_META_EXTRA_PROPERTY)
    return targets


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
    fhir_dir = Path("src/fhir/")
    classes_dir: Path = fhir_dir.joinpath("classes/4_0_0/")

    # clean out old stuff
    classes_resources_folder = classes_dir.joinpath("resources")
    if os.path.exists(classes_resources_folder):
        shutil.rmtree(classes_resources_folder)
    os.mkdir(classes_resources_folder)

    classes_complex_types_folder = classes_dir.joinpath("complex_types")
    if os.path.exists(classes_complex_types_folder):
        shutil.rmtree(classes_complex_types_folder)
    os.mkdir(classes_complex_types_folder)

    classes_backbone_elements_folder = classes_dir.joinpath("backbone_elements")
    if os.path.exists(classes_backbone_elements_folder):
        shutil.rmtree(classes_backbone_elements_folder)
    os.mkdir(classes_backbone_elements_folder)

    fhir_entities: List[FhirEntity] = FhirXmlSchemaParser.generate_classes()

    blob_meta_targets: Dict[str, List[Dict[str, Any]]] = _load_blob_meta_targets()

    # now print the result
    for fhir_entity in fhir_entities:
        # use template to generate new code files
        resource_name: str = fhir_entity.cleaned_name
        entity_file_name = fhir_entity.name_snake_case
        if fhir_entity.is_value_set:  # valueset
            pass

        elif fhir_entity.is_resource:
            search_parameters_for_all_resources: Dict[str, Dict[str, Any]] = (
                search_parameter_queries.get("Resource", {}) if fhir_entity.fhir_name != "Resource" else {}
            )
            search_parameters_for_current_resource: Dict[str, Dict[str, Any]] = (
                search_parameter_queries.get(fhir_entity.fhir_name, {})
            )
            # write Javascript classes
            with open(data_dir.joinpath("template.javascript.class.jinja2"), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = classes_resources_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing domain resource: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                resource_extra_properties: List[Dict[str, Any]] = [
                    {
                        "name": "_access",
                        "type": "Object"
                    },
                    {
                        "name": "_sourceAssigningAuthority",
                        "type": "string"
                    },
                    {
                        "name": "_uuid",
                        "type": "string"
                    },
                    {
                        "name": "_sourceId",
                        "type": "string"
                    }
                ]
                resource_extra_properties.extend(blob_meta_targets.get(resource_name, []))
                result = template.render(
                    fhir_entity=fhir_entity,
                    search_parameters_for_all_resources=search_parameters_for_all_resources,
                    search_parameters_for_current_resource=search_parameters_for_current_resource,
                    extra_properties=resource_extra_properties
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        elif fhir_entity.type_ == "BackboneElement" or fhir_entity.is_back_bone_element:
            with open(data_dir.joinpath("template.javascript.class.jinja2"), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = classes_backbone_elements_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing back bone class: {entity_file_name} to {file_path}...")
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
            # write Javascript classes
            with open(data_dir.joinpath("template.javascript.class.jinja2"), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = classes_complex_types_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing extension as complex type: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        elif fhir_entity.type_ == "Element":  # valueset
            # write Javascript classes
            with open(data_dir.joinpath("template.javascript.class.jinja2"), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = classes_complex_types_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing complex type: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                extra_properties = [
                    {
                        "name": "_file_id",
                        "type": "string"
                    }
                ] if entity_file_name == "attachment" else []
                extra_properties.extend(blob_meta_targets.get(resource_name, []))
                result = template.render(
                    fhir_entity=fhir_entity,
                    extra_properties_for_reference=[
                        {
                            "name": "_sourceAssigningAuthority",
                            "type": "string"
                        },
                        {
                            "name": "_uuid",
                            "type": "string"
                        },
                        {
                            "name": "_sourceId",
                            "type": "string"
                        }
                    ],
                    extra_properties=extra_properties,
                    extra_properties_for_json=extra_properties
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        elif fhir_entity.type_ in ["Quantity"]:  # valueset
            with open(data_dir.joinpath("template.javascript.class.jinja2"), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = classes_complex_types_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing complex_type: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                )

            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        else:
            print(f"{resource_name}: {fhir_entity.type_} is not supported")
        # print(result)

    return 0


if __name__ == "__main__":
    exit(main())
