import pymongo
import os

client = pymongo.MongoClient(os.environ["MONGO_URI"])
db = client[os.environ.get("MONGO_DB_NAME")]
collection = db["recordings"]

print("Total recordings in DB:", collection.count_documents({}))
for doc in collection.find().sort("created_at", -1).limit(5):
    print("Camera ID:", doc.get("camera_id"))
    print("Date:", doc.get("date"))
    print("Start Time:", doc.get("start_time"))
    print("File Path:", doc.get("file_path"))
    print("---")
