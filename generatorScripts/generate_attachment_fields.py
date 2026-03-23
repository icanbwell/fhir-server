# This file implements the code for generating json of fields for all resources which contains
# Attachment type fields

from pathlib import Path
import json
import sys

# Add the project root to the Python path to resolve imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from generatorScripts.fhir_xml_schema_parser import FhirEntity, FhirProperty, FhirXmlSchemaParser

# Get primitive types and all classes
primitive_types_dict = FhirXmlSchemaParser.get_fhir_primitive_types()
all_classes = FhirXmlSchemaParser.generate_classes()

###############
# Config
###############

# configure recursive field depth
recursive_fields_depth = 1

# configure whether to skip extension types
skip_extension = False
skip_nested_extension = True

# restrict to specific resources
restricted_resources = ["DocumentReference"]


###############
# Attachment Fields Extraction
###############

class AttachmentFieldsData:
    def __init__(self):
        self.attachment_fields_map = {}

    def get_field_type_property(self, field_type: str):
        '''
        Returns property class for given field type
        '''
        # eg: contained field in Observation have type Resource but have ResourceContainer in classes which have empty properties
        if field_type == "ResourceContainer":
            field_type = "Resource"
        for property_class in all_classes:
            if property_class.cleaned_name == field_type:
                return property_class
        return None

    def handle_nested_fields(
        self, field_class: FhirProperty, recursive_path: str, resource: FhirEntity
    ):
        print(recursive_path)
        if skip_extension and field_class.cleaned_type in ["Extension", "ModifierExtension"]:
            return

        recursive_path += f"/{field_class.name}"

        if field_class.is_list:
            recursive_path += "/[]"

        # for skipping nested recursive fields like extension in extension
        if recursive_path.split("/").count(field_class.name) > recursive_fields_depth:
            return

        # Check if this field is of type Attachment
        if field_class.cleaned_type == "Attachment":
            if not self.attachment_fields_map.get(resource.fhir_name):
                self.attachment_fields_map[resource.fhir_name] = []
            
            if recursive_path not in self.attachment_fields_map[resource.fhir_name]:
                self.attachment_fields_map[resource.fhir_name].append(recursive_path)

        # Get properties of this field type
        field_property = self.get_field_type_property(field_class.cleaned_type)

        if not field_property:
            return

        # Recursively check nested properties
        for prop in field_property.properties:
            if prop.is_v2_supported:
                continue
            # check extnsion type upto configured nested depth only
            if skip_nested_extension and prop.cleaned_type in ["Extension", "ModifierExtension"]:
                continue
            if field_class.cleaned_type in ["Extension", "ModifierExtension"]:
                if prop.cleaned_type not in ["Extension", "ModifierExtension", "Attachment"]:
                    continue
            if prop.type_snake_case not in primitive_types_dict.keys():
                self.handle_nested_fields(prop, recursive_path, resource)

    def generate_attachment_fields_data(self):
        """
        Generate field paths for each resource that contains Attachment type
        """
        for resource in all_classes:
            if resource.is_resource and resource.fhir_name in restricted_resources:
                print(f"Processing resource: {resource.fhir_name}")

                for property_class in resource.properties:
                    if property_class.is_v2_supported:
                        continue
                    if property_class.type_snake_case not in primitive_types_dict:
                        self.handle_nested_fields(property_class, "", resource)


def main():
    attachment_data = AttachmentFieldsData()
    attachment_data.generate_attachment_fields_data()

    # Write to JSON file
    output_path = Path("src/dataLayer/generated.databaseAttachmentResources.json")
    with open(output_path, "w") as json_file:
        json.dump(attachment_data.attachment_fields_map, json_file, indent=2)
        json_file.write("\n")

    print("\n------------ Finished creating attachment fields data ------------")
    print(f"Output written to: {output_path}")
    print(f"Total resources with Attachment fields: {len(attachment_data.attachment_fields_map)}")


if __name__ == "__main__":
    exit(main())
