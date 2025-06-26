from pathlib import Path
from pprint import pprint
import sys

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirXmlSchemaParser


def test_generator() -> None:
    fhir_entities = FhirXmlSchemaParser.generate_classes()

    # now print the result
    for fhir_entity in fhir_entities:
        pprint(fhir_entity)

test_generator()
