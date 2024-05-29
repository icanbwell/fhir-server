from pathlib import Path
import logging
import json

# noinspection PyPackageRequirements
from lxml import objectify

data_dir: Path = Path(__file__).parent.joinpath('./')

logging.basicConfig(
    format="[%(filename)s:%(lineno)d] %(message)s",
    datefmt="%Y-%m-%d:%H:%M:%S",
    level=logging.DEBUG,
)
logger = logging.getLogger(__name__)


class FhirXmlToJsonSchemaParser:
    def generate_resource_list(self, root):
        '''
        Returns a list of all resource
        '''

        return [element.get('name') for element in root['element']]

 
    def generate_simple_type_list(self, root):
        '''
        Returns a list of all simpleTypes in fhir
        '''

        return [element.get('name').replace('-primitive', '').replace('-list', '').replace('Enum', '') for element in root['simpleType']]


    def generate_discriminator(self, root):
        '''
        Generates discriminator for schema
        '''

        return {
            'propertyName': 'resourceType',
            'mapping': { resource: f'#/definitions/{resource}' for resource in self.generate_resource_list(root) }
        }


    def generate_resource_choice(self, root):
        '''
        Generates array of resources to consider from while validating with schema
        One of the reference from this list should match with the resource to be validated
        '''

        return [
            { '$ref': f'#/definitions/{resource}' } for resource in self.generate_resource_list(root)
        ]


    def generate_simple_type_schema(self, root):
        '''
        Generates schema for simpleTypes in fhir
        '''

        schema = {}
        # these fields should have number type
        numerical_typing = [
            'positiveInt',
            'unsignedInt',
            'integer'
        ]

        # Add types from schema
        for simple_type in root.simpleType:
            name: str = simple_type.get('name')

            if hasattr(simple_type, 'restriction'):
                # check for primitive type like string, integer
                if name.endswith('-primitive'):
                    name = name.replace('-primitive', '')
                    pattern = simple_type.restriction.pattern.get('value') if name != 'string' else '[ \\r\\n\\t\\S]+'

                    # Cannot support pattern from r4b since it in inefficient for larger base64 strings
                    if name == 'base64Binary':
                        pattern = '[A-Za-z0-9+/\\s]*={0,2}'

                    if '{1,64}' in pattern:
                        # we can have id with length more than 64
                        pattern = pattern.replace('{1,64}', '{1,}')

                    if pattern is not None:
                        logger.info(f'Schema generated for {name}')
                        schema[name] = {
                            'type': ('string' if name != 'boolean' else 'boolean') if not name in numerical_typing else 'number',
                            'pattern': f'^{pattern}$'
                        }
                # if not a primitive type then check for list types
                elif hasattr(simple_type.restriction, 'enumeration'):
                    name = name.replace('-list', '').replace('Enum', '')
                    values = [b.get('value') for b in simple_type.restriction.enumeration]

                    if len(values) > 0:
                        logger.info(f'Schema generated for {name}')
                        schema[name] = {
                            'type': 'string' if not name in numerical_typing else 'number',
                            'enum': values
                        }

        # Add types that are not present correctly in schema
        schema['xhtml'] = {
            'description': 'xhtml - escaped html (see specfication)'
        }
        schema['decimal'] = {
            'pattern': '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$',
            'type': 'number'
        }

        return schema


    def generate_properties(self, content):
        '''
        Extracts properties from the content provided with fields name, required, is_list, and type.
        Also returns base type of the content
        '''

        properties = []
        # get all the properties present in the content
        if hasattr(content, 'attribute'):
            properties.extend(content['attribute'])
        
        if hasattr(content, 'sequence'):
            for sequence in content['sequence'].getchildren():
                if hasattr(sequence, 'element'):
                    properties.extend(sequence['element'])
                else:
                    properties.append(sequence)

        base = content.get('base') if not isinstance(content, list) else None
        properties_data = []
        # get data from the properties
        for property in properties:
            required = property.get('minOccurs') == '1'
            is_list = property.get('maxOccurs') == 'unbounded'
            property_name = property.get('name')
            property_type = property.get('type')

            if property_name is None:
                if property.get('ref') is None:
                    continue
                property_name = property.get('ref').split(':')[-1]
                property_type = property.get('ref').split(':')[0]

            property_name = property_name.replace('.', '')
            property_type = property_type.replace('.', '').replace('-primitive', '').replace('-list', '').replace('Enum', '')
            
            if property_type == 'SampledDataDataType' and property_name == 'data':
                property_type = 'string'

            properties_data.append({
                'name': property_name,
                'type': property_type,
                'required': required,
                'is_list': is_list,
            })

        return { 'base': base, 'properties': properties_data }


    def generate_complex_type_schema(self, root):
        '''
        Generates schema for complexType in fhir
        '''

        # get list of resources
        resources_list = self.generate_resource_list(root)
        simple_types_list = self.generate_simple_type_list(root)
        schema = {}
        resource_properties = {}

        for complex_type in root['complexType']:
            name: str = complex_type.get('name').replace('.', '')
            content = []

            if name in simple_types_list:
                logger.info(f'Skipping simpleType {name} it is generated with simpleType')
                continue
            if hasattr(complex_type, 'complexContent'):
                content = complex_type['complexContent']['extension']
            elif hasattr(complex_type, 'sequence'):
                content = complex_type

            resource_properties[name] = self.generate_properties(content)

        for name in resource_properties.keys():
            logger.info(f'Generating properties for {name}')
            if name == 'ResourceContainer':
                schema[name] = { 'oneOf': self.generate_resource_choice(root) }
                logger.info(f'Schema generated for {name}')
                continue
            
            base = resource_properties[name]['base']

            if base in resource_properties.keys():
                resource_properties[name]['properties'].extend(resource_properties[base]['properties'])

            properties = {}
            required = []
            if name in resources_list:
                properties['resourceType'] = {
                    'const': name
                }
                required.append('resourceType')
            
            for property in resource_properties[name]['properties']:
                if property['required']:
                    required.append(property['name'])
                
                if property['is_list']:
                    properties[property['name']] = {
                        'items': {
                            '$ref': f"#/definitions/{property['type']}"
                        },
                        'type': 'array'
                    }
                else:
                    properties[property['name']] = {
                        '$ref': f"#/definitions/{property['type']}"
                    }
            
            if name == "GraphDefinitionTarget":
                required = []

            schema[name] = {
                'additionalProperties': False,
                'properties': properties,
                'required': required
            }
            logger.info(f'Schema generated for {name}')

        return schema


    def get_schema(self):
        '''
        Returns fhir schema generated from fhir-single.xsd for validating resources
        '''
        
        # read everything from fhir-single
        fhir_xsd_all_file: Path = (
            data_dir.joinpath('xsd')
            .joinpath('definitions.xml')
            .joinpath('fhir-all-xsd')
            .joinpath('fhir-single.xsd')
        )

        logger.info('Reading schema from fhir-single.xsd')
        with open(fhir_xsd_all_file, "rb") as file:
            contents = file.read()
            root = objectify.fromstring(contents)

            schema = {
                '$schema': 'http://json-schema.org/draft-06/schema#',
                'id': 'http://hl7.org/fhir/json-schema/4.0',
                'description': 'see http://hl7.org/fhir/json.html#schema for information about the FHIR Json Schemas',
                'discriminator': {},
                'oneOf': [],
                'definitions': {}
            }

            logger.info('Generating schema descriminator')
            schema['discriminator'].update(self.generate_discriminator(root))
            logger.info('Generating schema choices')
            schema['oneOf'] = self.generate_resource_choice(root)
            logger.info('Generating simpleType definitions')
            schema['definitions'].update(self.generate_simple_type_schema(root))
            logger.info('Generating complexType definitions')
            schema['definitions'].update(self.generate_complex_type_schema(root))
            logger.info('Schema generated')

            return schema


def main():
    fhir_parser = FhirXmlToJsonSchemaParser()
    
    schema = fhir_parser.get_schema(); 

    json_file_path = data_dir.joinpath('json').joinpath('fhir-generated.schema.json')
    with open(json_file_path, 'w') as json_file:
        json.dump(schema, json_file, indent=2)
        json_file.write('\n')


if __name__ == '__main__':
    exit(main())
