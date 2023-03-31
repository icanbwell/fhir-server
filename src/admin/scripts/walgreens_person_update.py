import os
from pymongo import MongoClient

# Requires the PyMongo package.
# https://api.mongodb.com/python/current

client = MongoClient(os.environ['MONGO_URL'])
result = client['fhir']['Person_4_0_0'].aggregate([
    {
        '$match': {
            'meta.security': {
                '$elemMatch': {
                    'system': 'https://www.icanbwell.com/owner', 
                    'code': 'walgreens'
                }
            }
        }
    }, {
        '$unwind': {
            'path': '$meta.security'
        }
    }, {
        '$match': {
            'meta.security.system': 'https://www.icanbwell.com/owner'
        }
    }, {
        '$group': {
            '_id': '$_id', 
            'count': {
                '$count': {}
            }
        }
    }, {
        '$match': {
            'count': {
                '$gte': 2
            }
        }
    }
])

for res in result:
    _id = res["_id"]
    doc = client['fhir']['Person_4_0_0'].find_one({'_id': _id})
    # meta.security
    meta_security_list = doc['meta']['security']
    for index, meta_security in  enumerate(meta_security_list):
        if meta_security['system'] == 'https://www.icanbwell.com/owner' and meta_security['code'] != 'walgreens':
            del meta_security_list[index]
    # Updated doc
    doc['meta']['security'] = meta_security_list
    print("Updated Doc")
    print(doc)
    print("End Updated Doc")
    # Remove _id for doc
    del doc['_id']
    client['fhir']['Person_4_0_0'].update_one({'_id': _id}, {'$set': doc})
    # Print the updated document
    print(client['fhir']['Person_4_0_0'].find_one({'_id': _id}))

