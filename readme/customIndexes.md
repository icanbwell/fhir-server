# Custom Indexes

## External Index Configuration

Set `CUSTOM_INDEXES_FILE_PATH` to a JSON file path to override the default indexes defined in `customIndexes.js`.

When this env var is set, the entire `customIndexes.js` is ignored. The JSON file becomes the single source of truth for index definitions.

### Format

The JSON file has the same structure as the `customIndexes` object — keys are collection names (or `*` for all collections, `*_History` for history collections), values are arrays of index definitions:

Each index supports:
- `keys` — MongoDB index key specification
- `options` — MongoDB index options (`name` required, plus `unique`, `expireAfterSeconds`, etc.)
- `include` — only apply to these collections (for `*` indexes)
- `exclude` — skip these collections (for `*` indexes)

**Note:** Access tag indexes (`_access.*`) in `*` or `*_History` are not used for access index query optimization. Define them under the specific resource collection (e.g., `Patient_4_0_0`) for the query rewriter to recognize them.

### Example

```json
{
    "*": [
        {
            "keys": {
                "_uuid": 1
            },
            "options": {
                "name": "uuid",
                "unique": true
            },
            "exclude": ["AuditEvent_4_0_0"]
        },
        {
            "keys": {
                "_access.client1": 1,
                "_uuid": 1
            },
            "options": {
                "name": "_access_client1_1._uuid_1"
            },
            "exclude": ["AuditEvent_4_0_0", "Person_4_0_0"]
        },
        {
            "keys": {
                "_access.client2": 1,
                "_uuid": 1
            },
            "options": {
                "name": "_access_client2_1._uuid_1"
            },
            "exclude": ["AuditEvent_4_0_0", "Person_4_0_0"]
        }
    ],
    "*_History": [
        {
            "keys": {
                "id": 1
            },
            "options": {
                "name": "id_1"
            }
        },
        {
            "keys": {
                "resource._uuid": 1
            },
            "options": {
                "name": "resource_uuid_1"
            }
        }
    ],
    "Patient_4_0_0": [
        {
            "keys": {
                "_access.client1": 1,
                "_uuid": 1
            },
            "options": {
                "name": "_access_client1_1._uuid_1"
            }
        },
        {
            "keys": {
                "identifier.value": 1,
                "identifier.system": 1,
                "_uuid": 1
            },
            "options": {
                "name": "identifier.value_1"
            }
        }
    ],
    "Practitioner_4_0_0": [
        {
            "keys": {
                "_access.client2": 1,
                "_uuid": 1
            },
            "options": {
                "name": "_access_client2_1._uuid_1"
            }
        },
        {
            "keys": {
                "_access.client3": 1,
                "_uuid": 1
            },
            "options": {
                "name": "_access_client3_1._uuid_1"
            }
        }
    ]
}
```

### Kubernetes / Docker

Mount your JSON file into the container and set the env var:

```yaml
# deployment.yaml
spec:
  containers:
    - name: fhir-server
      env:
        - name: CUSTOM_INDEXES_FILE_PATH
          value: /config/customIndexes.json
      volumeMounts:
        - name: index-config
          mountPath: /config
  volumes:
    - name: index-config
      configMap:
        name: fhir-indexes
```

Create the ConfigMap from your JSON file:

```bash
kubectl create configmap fhir-indexes --from-file=customIndexes.json=./my-indexes.json
```
