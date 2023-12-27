from pprint import pprint

from fhir_xml_schema_parser import FhirXmlSchemaParser


def test_generator() -> None:
    fhir_entities = FhirXmlSchemaParser.generate_classes(
        filter_to_resource=None
    )

    account_entity = [e for e in fhir_entities if e.fhir_name == "Account"][0]
    # now print the result
    for fhir_entity in fhir_entities:
        pprint(fhir_entity)
