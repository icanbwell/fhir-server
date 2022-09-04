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


def clean_duplicate_lines(file_path: Union[Path, str]) -> None:
    print(f"Removing duplicate lines from {file_path}")
    with open(file_path, "r") as file:
        lines: List[str] = file.readlines()
    new_lines: List[str] = []
    for line in lines:
        if not line.strip() or not line.lstrip().startswith("from"):
            new_lines.append(line)
        elif line not in new_lines and line.lstrip() not in [
            c.lstrip() for c in new_lines
        ]:
            new_lines.append(line)
    with open(file_path, "w") as file:
        file.writelines(new_lines)


def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")
    parent_schema_dir = Path(__file__).parent.joinpath("../")
    top_level_dir = Path(__file__).parent.joinpath("../../../")
    fhir_dir = top_level_dir.joinpath("fhir")
    classes_dir: Path = fhir_dir.joinpath("classes/4_0_0/")
    graphql_schema_dir: Path = parent_schema_dir.joinpath("schemas")
    graphql_resolvers_dir: Path = parent_schema_dir.joinpath("resolvers")

    # clean out old stuff
    classes_resources_folder = classes_dir.joinpath("resources")
    indexFilePath = classes_resources_folder.joinpath("index.js")
    if os.path.exists(indexFilePath):
        os.remove(indexFilePath)

    classes_complex_types_folder = classes_dir.joinpath("complex_types")
    complexTypeIndexFilePath = classes_complex_types_folder.joinpath("index.js")
    if os.path.exists(complexTypeIndexFilePath):
        os.remove(complexTypeIndexFilePath)

    fhir_entities: List[FhirEntity] = [f for f in FhirXmlSchemaParser.generate_classes() if f.is_resource]

    with open(data_dir.joinpath("template.javascript.class.index.jinja2"), "r") as file:
        template_contents = file.read()
        from jinja2 import Template

        file_path = indexFilePath
        template = Template(
            template_contents, trim_blocks=True, lstrip_blocks=True
        )
        result = template.render(
            fhir_entities=fhir_entities,
        )
    if not path.exists(file_path):
        with open(file_path, "w") as file2:
            file2.write(result)

    fhir_entities: List[FhirEntity] = [f for f in FhirXmlSchemaParser.generate_classes()
                                       if f.type_ == "Element" and f.cleaned_name != "Resource"]

    with open(data_dir.joinpath("template.javascript.class.index.jinja2"), "r") as file:
        template_contents = file.read()
        from jinja2 import Template

        file_path = complexTypeIndexFilePath
        template = Template(
            template_contents, trim_blocks=True, lstrip_blocks=True
        )
        result = template.render(
            fhir_entities=fhir_entities,
        )
    if not path.exists(file_path):
        with open(file_path, "w") as file2:
            file2.write(result)

    return 0


if __name__ == "__main__":
    exit(main())
