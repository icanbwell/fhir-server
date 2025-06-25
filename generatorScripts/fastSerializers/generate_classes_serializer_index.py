# This file implements the code generator for generating schema and resolvers for FHIR
# It reads the FHIR XML schema and generates resolvers in the resolvers folder and schema in the schema folder

import os
import shutil
from os import path
from pathlib import Path
from typing import Union, List
import sys

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirXmlSchemaParser, FhirEntity

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
    serializers_dir: Path = fhir_dir.joinpath("serializers/4_0_0/")
    template_name = 'template.javascript.class_serializer.index.jinja2'

    # clean out old stuff
    serializers_resources_folder = serializers_dir.joinpath("resources")
    indexFilePath = serializers_resources_folder.joinpath("index.js")
    if os.path.exists(indexFilePath):
        os.remove(indexFilePath)

    serializers_complex_types_folder = serializers_dir.joinpath("complex_types")
    complexTypeIndexFilePath = serializers_complex_types_folder.joinpath("index.js")
    if os.path.exists(complexTypeIndexFilePath):
        os.remove(complexTypeIndexFilePath)

    fhir_entities: List[FhirEntity] = [f for f in FhirXmlSchemaParser.generate_classes() if f.is_resource]

    with open(data_dir.joinpath(template_name), "r") as file:
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

    with open(data_dir.joinpath(template_name), "r") as file:
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
