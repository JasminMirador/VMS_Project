import pymongo
import os
client = pymongo.MongoClient(os.environ["MONGO_URI"])
db = client[os.environ.get("MONGO_DB_NAME")]
col = db['mqtt_logs']
pipeline = [
    {'$group': {'_id': {'ip': '$ip', 'type': '$type'}, 'count': {'$sum': 1}}},
    {'$sort': {'_id.ip': 1, '_id.type': 1}}
]
for doc in col.aggregate(pipeline):
    ip = doc['_id'].get('ip') or 'Unknown'
    analytic = doc['_id'].get('type') or 'Unknown'
    print(f"IP: {ip} - Analytic: {analytic} (Total: {doc['count']})")
