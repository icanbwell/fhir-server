from pathlib import Path
from types import SimpleNamespace

from jinja2 import Environment, FileSystemLoader

SCRIPT_DIR = Path(__file__).parent

TEMPLATE_NAME = "template.resource_queriesv2.jinja2"


def render(search_parameters_for_current_resource):
    env = Environment(loader=FileSystemLoader(str(SCRIPT_DIR)))
    template = env.get_template(TEMPLATE_NAME)
    fhir_entity = SimpleNamespace(
        fhir_name="Observation",
        cleaned_name="Observation",
        plural_name="Observations",
        type_="DomainResource",
        documentation=["An observation resource."],
    )
    return template.render(
        fhir_entity=fhir_entity,
        search_parameters_for_all_resources={},
        search_parameters_for_current_resource=search_parameters_for_current_resource,
    )


def test_composite_search_parameter_renders_as_search_string_not_error():
    result = render({
        "code-value-quantity": SimpleNamespace(
            type="composite",
            description="Code and quantity value parameter pair",
        )
    })
    assert "ERROR:" not in result
    assert "code_value_quantity: SearchString" in result


def test_known_types_still_render_without_error():
    result = render({
        "value-quantity": SimpleNamespace(type="quantity", description="The value"),
        "code": SimpleNamespace(type="token", description="The code"),
    })
    assert "ERROR:" not in result
    assert "value_quantity: SearchQuantity" in result
    assert "code: SearchToken" in result
