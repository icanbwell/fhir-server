import os
import re
from pymongo import MongoClient

# Requires the PyMongo package.
# https://api.mongodb.com/python/current

client = MongoClient(os.environ['MONGO_URL'])
filter = {
    'link': {
        '$not': {
            '$elemMatch': {
                'target.reference': re.compile(r"^Patient")
            }
        }
    }, 
    'meta.security': {
        '$elemMatch': {
            'system': 'https://www.icanbwell.com/owner', 
            'code': 'bwell'
        }
    }
}
# bwell master persion don't have Patient respurce
# count = client['fhir']['Person_4_0_0'].count_documents(filter)
# print(f'bwell master Person without patient: {count}')
profile_filter = {
    'link': {
        '$not': {
            '$elemMatch': {
                'target.reference': re.compile(r"^Patient")
            }
        }
    }, 
    'meta.security': {
        '$elemMatch': {
            'system': 'https://www.icanbwell.com/owner', 
            'code': 'bwell'
        }
    }, 
    'identifier': {
        '$elemMatch': {
            'system': 'http://www.walgreens.com/profileid'
        }
    }
}
# bwell master persion don't have Patient respurce but with profileid tag
# profile_filter_count = client['fhir']['Person_4_0_0'].count_documents(profile_filter)
# print(f'bwell master Person without patient but with profileid: {profile_filter_count}')
duplicate_profile_filter = [
    {
        '$match': {
            'link': {
                '$not': {
                    '$elemMatch': {
                        'target.reference': re.compile(r"^Patient")
                    }
                }
            }, 
            'meta.security': {
                '$elemMatch': {
                    'system': 'https://www.icanbwell.com/owner', 
                    'code': 'bwell'
                }
            }, 
            'identifier': {
                '$elemMatch': {
                    'system': 'http://www.walgreens.com/profileid'
                }
            }
        }
    }, {
        '$unwind': {
            'path': '$identifier'
        }
    }, {
        '$match': {
            'identifier.system': 'http://www.walgreens.com/profileid'
        }
    }, {
        '$group': {
            '_id': '$_id', 
            'count': {
                '$count': {}
            }
        }
    }, 
    {
        '$match': {
            'count': {
                '$gte': 2
            }
        }
    }, 
    {
        '$count': 'totalCount'
    }
]
duplicate_profile_filter_count = 0
for result in client['fhir']['Person_4_0_0'].aggregate(duplicate_profile_filter, allowDiskUse=True):
    duplicate_profile_filter_count = result['totalCount']
print(f'bwell person with duplicate Profile: {duplicate_profile_filter_count}')




