import json
import os
from dataclasses import dataclass
from pathlib import Path
import shutil
from typing import Any
from typing import Dict
from typing import List
from typing import Optional


@dataclass
class QueryEntry:
    resource: str
    search_parameter: str
    type_: str
    field: str
    target: Optional[List[str]]


def add_values_in_dict(sample_dict: Dict[str, List[QueryEntry]], query_entry: QueryEntry):
    """ Append multiple values to a key in
        the given dictionary """
    if query_entry.resource not in sample_dict:
        sample_dict[query_entry.resource] = list()
    sample_dict[query_entry.resource].append(query_entry)
    return sample_dict


def main() -> int:
    data_dir: Path = Path(__file__).parent.joinpath("./")

    with open(data_dir.joinpath("search-parameters.json"), "r+") as file:
        contents = file.read()

    fhir_schema = json.loads(contents)

    entries: List[Dict[str, str]] = fhir_schema["entry"]

    query_entries: List[QueryEntry] = []
    print("search_parameter,base,code,status,type_,xpath,xpath_transformed,target,expression")
    entry: Dict[str, Any]
    for entry in entries:
        resource: Dict[str, Any] = entry["resource"]
        search_parameter: str = resource["name"]
        code: str = resource["code"]
        status: str = resource["status"]
        description: str = resource["description"]
        type_: str = resource["type"]
        base: str = "|".join(resource["base"])
        expression: str = resource.get("expression", None)
        experimental: str = resource["experimental"]
        xpath: str = resource.get("xpath", None)
        xpath_transformed: str = xpath.replace("/f:", ".").replace("f:", "") if xpath else None
        target: str = "|".join(resource["target"]) if "target" in resource else None
        print(f"{search_parameter},{base},{code},{status},{type_},{xpath},{xpath_transformed},{target},{expression}")
        if xpath_transformed:
            exp: str
            for exp in xpath_transformed.split("|"):
                exp = exp.strip(" ")
                resource1, exp1 = exp.split(".", 1)
                query_entry: QueryEntry = QueryEntry(
                    resource=resource1,
                    search_parameter=search_parameter,
                    type_=type_,
                    field=exp1,
                    target=target.split("|") if target else None
                )
                query_entries.append(query_entry)

    # group by Resource
    sample_dict: Dict[str, List[QueryEntry]] = {}
    for query_entry in query_entries:
        add_values_in_dict(sample_dict=sample_dict, query_entry=query_entry)
    return 0


if __name__ == "__main__":
    exit(main())
