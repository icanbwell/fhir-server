import os
import re
from pymongo import MongoClient

# Requires the PyMongo package.
# https://api.mongodb.com/python/current
# export MONGO_URL=<URL with credentails>

client = MongoClient(os.environ['MONGO_URL'])
profile_filter = {
    'link': {
        '$elemMatch': {
            'target.reference': re.compile(r"^Patient")
        }
    }, 
    # 'meta.security': {
    #     '$elemMatch': {
    #         'system': 'https://www.icanbwell.com/owner', 
    #         'code': 'bwell'
    #     }
    # }, 
    'identifier': {
        '$elemMatch': {
            'system': 'http://www.walgreens.com/profileid'
        }
    }
}
# bwell master person for walgreens
person_docs = list(client['fhir']['Person_4_0_0'].find(profile_filter))
print('Total Person: ', len(person_docs))
# Check for each tags person id
idList = []
for doc in person_docs:
    _id = doc["_id"]
    doc_id = doc['id']
    # meta.security
    meta_security_list = doc['meta']['security']
    owner = None
    access = None
    sourceAssigningAuthority = None
    is_updated = False
    for index, meta_security in  enumerate(meta_security_list):
        if meta_security['system'] == 'https://www.icanbwell.com/owner':
            if owner:
                if owner['code'] ==  meta_security['code']:
                    # Duplicate owner
                    print(doc_id, ': Duplicate owner', meta_security['code'])
                    is_updated = True
                else:
                    print(doc_id, ': Multiple owner', meta_security['code'])
                    break
            else:
                owner = meta_security
        
        if meta_security['system'] == 'https://www.icanbwell.com/access':
            if access:
                if access['code'] ==  meta_security['code']:
                    # Duplicate access
                    print(doc_id, ': Duplicate access', meta_security['code'])
                    is_updated = True
                else:
                    print(doc_id, ': Multiple access', meta_security['code'])
                    break
            else:
                access = meta_security
        if meta_security['system'] == 'https://www.icanbwell.com/sourceAssigningAuthority':
            if sourceAssigningAuthority:
                if access['code'] ==  meta_security['code']:
                    # Duplicate sourceAssigningAuthority
                    print(doc_id, ': Duplicate sourceAssigningAuthority', meta_security['code'])
                    is_updated = True
                else:
                    print(doc_id, ': Multiple sourceAssigningAuthority', meta_security['code'])
                    break
            else:
                sourceAssigningAuthority = meta_security

    if access['code'] != owner['code']:
        print(doc_id, 'copied access to owner', access['code'])
        owner['code'] = access['code']
        is_updated = True
    if access['code'] != sourceAssigningAuthority['code']:
        print(doc_id, 'copied access to sourceAssigningAuthority', access['code'])
        sourceAssigningAuthority['code'] = access['code']
        is_updated = True
        
    if is_updated:
        # Updated doc
        doc['meta']['security'] = [owner, access, sourceAssigningAuthority]
        # print("Updated Doc")
        # print(doc)
        # print("End Updated Doc")
        # Remove _id for doc
        del doc['_id']
        client['fhir']['Person_4_0_0'].update_one({'_id': _id}, {'$set': doc})
        # Print the updated document
        # print(client['fhir']['Person_4_0_0'].find_one({'_id': _id}))
        idList.append(doc_id)

print('ID List:', ','.join(idList))

        
        
