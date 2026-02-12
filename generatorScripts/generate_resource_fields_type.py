# This file implements the code for generating json of fields data with min, max and type for all resources

import json
from pathlib import Path
from lxml import objectify
from lxml.objectify import ObjectifiedElement

data_dir: Path = Path(__file__).parent.joinpath("./")


def get_resources_fields_data():
    """
    Generates data for each resource for all fields
    """

    result = {}

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

        entry: ObjectifiedElement
        for entry in entries:
            if not hasattr(entry["resource"], "StructureDefinition"):
                continue

            structure_definition: ObjectifiedElement = entry["resource"][
                "StructureDefinition"
            ]
            snapshot_elements: ObjectifiedElement = structure_definition["snapshot"][
                "element"
            ]
            snapshot_element: ObjectifiedElement
            for snapshot_element in snapshot_elements:
                if not hasattr(snapshot_element, "type"):
                    continue

                if snapshot_element.get("id").endswith("[x]"):
                    for type in snapshot_element["type"]:
                        type_code_obj = type["code"]
                        type_code: str = type_code_obj.get("value")
                        type_name: str = type_code

                        if type_code:
                            if type_code == "http://hl7.org/fhirpath/System.String":
                                type_code = "string"
                                type_name = "String"
                            result[
                                snapshot_element.get("id").replace("[x]", "")
                                + type_name[0].upper()
                                + type_name[1:]
                            ] = {
                                "code": type_code,
                                "min": snapshot_element["min"].get("value"),
                                "max": snapshot_element["max"].get("value"),
                            }
                else:
                    type_: ObjectifiedElement = snapshot_element["type"][0]
                    if not hasattr(type_, "code"):
                        continue
                    type_code_obj = type_["code"]
                    type_code: str = type_code_obj.get("value")

                    if type_code:
                        if type_code == "http://hl7.org/fhirpath/System.String":
                            type_code = "string"
                        result[snapshot_element.get("id")] = {
                            "code": type_code,
                            "min": snapshot_element["min"].get("value"),
                            "max": snapshot_element["max"].get("value"),
                        }

    return result


def main():
    fields_data = get_resources_fields_data()

    json_file_path = Path('src/fhir/').joinpath(
        "fhir-generated.field-types.json"
    )
    with open(json_file_path, "w") as json_file:
        json.dump(fields_data, json_file, indent=2)
        json_file.write("\n")

    print("------------ Finished creating resources field types data ------------")


if __name__ == "__main__":
    exit(main())
