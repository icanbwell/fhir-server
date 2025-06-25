# This file implements the code generator for generating schema and resolvers for FHIR
# It reads the FHIR XML schema and generates resolvers in the resolvers folder and schema in the schema folder

import os
import shutil
from os import path
from pathlib import Path
from typing import Union, List, Dict, Any

from fhir_xml_schema_parser import FhirXmlSchemaParser
from search_parameters import search_parameter_queries
from fhir_xml_schema_parser import FhirEntity


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
    fhir_dir = Path(__file__).parent.joinpath("../")
    serializers_dir: Path = fhir_dir.joinpath("serializers/4_0_0/")
    serializer_template_file_name = 'template.javascript.class_serializer.jinja2'
    
    # clean out old stuff for serializers
    serializers_resources_folder = serializers_dir.joinpath("resources")
    if os.path.exists(serializers_resources_folder):
        shutil.rmtree(serializers_resources_folder)
    os.mkdir(serializers_resources_folder)

    serializers_complex_types_folder = serializers_dir.joinpath("complex_types")
    if os.path.exists(serializers_complex_types_folder):
        shutil.rmtree(serializers_complex_types_folder)
    os.mkdir(serializers_complex_types_folder)

    serializers_backbone_elements_folder = serializers_dir.joinpath("backbone_elements")
    if os.path.exists(serializers_backbone_elements_folder):
        shutil.rmtree(serializers_backbone_elements_folder)
    os.mkdir(serializers_backbone_elements_folder)

    fhir_entities: List[FhirEntity] = FhirXmlSchemaParser.generate_classes()

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
            with open(data_dir.joinpath(serializer_template_file_name), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = serializers_resources_folder.joinpath(f"{entity_file_name}.js")
                print(f"Writing domain resource: {entity_file_name} to {file_path}...")
                template = Template(
                    template_contents, trim_blocks=True, lstrip_blocks=True
                )
                result = template.render(
                    fhir_entity=fhir_entity,
                    search_parameters_for_all_resources=search_parameters_for_all_resources,
                    search_parameters_for_current_resource=search_parameters_for_current_resource,
                    extra_properties=[
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
                )
            if not path.exists(file_path):
                with open(file_path, "w") as file2:
                    file2.write(result)
        elif fhir_entity.type_ == "BackboneElement" or fhir_entity.is_back_bone_element:
            with open(data_dir.joinpath(serializer_template_file_name), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = serializers_backbone_elements_folder.joinpath(f"{entity_file_name}.js")
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
            with open(data_dir.joinpath(serializer_template_file_name), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = serializers_complex_types_folder.joinpath(f"{entity_file_name}.js")
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
            with open(data_dir.joinpath(serializer_template_file_name), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = serializers_complex_types_folder.joinpath(f"{entity_file_name}.js")
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
            with open(data_dir.joinpath(serializer_template_file_name), "r") as file:
                template_contents = file.read()
                from jinja2 import Template

                file_path = serializers_complex_types_folder.joinpath(f"{entity_file_name}.js")
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
