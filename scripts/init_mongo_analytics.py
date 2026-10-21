# scripts/init_mongo_analytics.py
"""
Mirador VMS - Analytics Database Initialization
Run this script to create all required collections and indexes for analytics
"""

import pymongo
from pymongo import ASCENDING, DESCENDING
from datetime import datetime
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../onvif-backend')))
from app.core.database import mongo_client

# Configuration
MONGODB_URL = os.environ["MONGO_URI"]
DATABASE_NAME = os.environ.get("MONGO_DB_NAME", "vms_database")

def init_analytics_collections():
    """Initialize all analytics collections and indexes"""
    
    print("\n" + "="*60)
    print("🚀 Mirador VMS - Analytics Database Setup")
    print("="*60 + "\n")
    
    print(f"📡 Connecting to MongoDB: {MONGODB_URL}")
    
    try:
        # Connect to MongoDB using shared pool
        client = mongo_client
        db = client[DATABASE_NAME]
        
        # Test connection
        client.admin.command('ping')
        print("✅ Connected to MongoDB successfully!\n")
        
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {e}")
        print("\n💡 Troubleshooting:")
        print("   1. Make sure MongoDB is installed and running")
        print("   2. Run 'net start MongoDB' if installed locally")
        print("   3. Or run 'docker run -d -p 27017:27017 --name mongodb mongo'")
        return False
    
    # ============================================
    # 1. ANALYTICS CONFIGURATIONS
    # ============================================
    print("📊 Creating collection: analytics_configs")
    if "analytics_configs" not in db.list_collection_names():
        db.create_collection("analytics_configs")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_configs.create_index([("device_id", ASCENDING), ("config_token", ASCENDING)], unique=True)
    db.analytics_configs.create_index([("device_id", ASCENDING)])
    db.analytics_configs.create_index([("profile_token", ASCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # 2. ANALYTICS RULES
    # ============================================
    print("\n📊 Creating collection: analytics_rules")
    if "analytics_rules" not in db.list_collection_names():
        db.create_collection("analytics_rules")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_rules.create_index([("device_id", ASCENDING), ("config_token", ASCENDING), ("rule_name", ASCENDING)])
    db.analytics_rules.create_index([("device_id", ASCENDING), ("rule_type", ASCENDING)])
    db.analytics_rules.create_index([("device_id", ASCENDING), ("is_active", ASCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # 3. ANALYTICS OBJECTS (Detected objects)
    # ============================================
    print("\n📊 Creating collection: analytics_objects")
    if "analytics_objects" not in db.list_collection_names():
        db.create_collection("analytics_objects")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_objects.create_index([("device_id", ASCENDING), ("frame_time", DESCENDING)])
    db.analytics_objects.create_index([("device_id", ASCENDING), ("object_id", ASCENDING)])
    db.analytics_objects.create_index([("device_id", ASCENDING), ("class_type", ASCENDING)])
    db.analytics_objects.create_index([("frame_time", DESCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # 4. ANALYTICS EVENTS (Rule triggers)
    # ============================================
    print("\n📊 Creating collection: analytics_events")
    if "analytics_events" not in db.list_collection_names():
        db.create_collection("analytics_events")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_events.create_index([("device_id", ASCENDING), ("triggered_at", DESCENDING)])
    db.analytics_events.create_index([("device_id", ASCENDING), ("rule_name", ASCENDING), ("is_acknowledged", ASCENDING)])
    db.analytics_events.create_index([("device_id", ASCENDING), ("event_type", ASCENDING)])
    db.analytics_events.create_index([("triggered_at", DESCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # 5. FACE RECOGNITION MATCHES
    # ============================================
    print("\n📊 Creating collection: analytics_face_matches")
    if "analytics_face_matches" not in db.list_collection_names():
        db.create_collection("analytics_face_matches")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_face_matches.create_index([("device_id", ASCENDING), ("enrollment_id", ASCENDING)])
    db.analytics_face_matches.create_index([("matched_at", DESCENDING)])
    db.analytics_face_matches.create_index([("device_id", ASCENDING), ("likelihood", DESCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # 6. LICENSE PLATE RECOGNITION MATCHES
    # ============================================
    print("\n📊 Creating collection: analytics_lpr_matches")
    if "analytics_lpr_matches" not in db.list_collection_names():
        db.create_collection("analytics_lpr_matches")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_lpr_matches.create_index([("device_id", ASCENDING), ("plate_number", ASCENDING)])
    db.analytics_lpr_matches.create_index([("matched_at", DESCENDING)])
    db.analytics_lpr_matches.create_index([("device_id", ASCENDING), ("country_code", ASCENDING)])
    db.analytics_lpr_matches.create_index([("device_id", ASCENDING), ("speed", ASCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # 7. OPTIONAL: AUDIO ANALYTICS
    # ============================================
    print("\n📊 Creating collection: analytics_audio_events")
    if "analytics_audio_events" not in db.list_collection_names():
        db.create_collection("analytics_audio_events")
        print("   ✅ Created")
    else:
        print("   ⏭️ Already exists")
    
    # Indexes
    db.analytics_audio_events.create_index([("device_id", ASCENDING), ("detected_at", DESCENDING)])
    db.analytics_audio_events.create_index([("device_id", ASCENDING), ("class_type", ASCENDING)])
    print("   ✅ Indexes created")
    
    # ============================================
    # INSERT SAMPLE DATA (Optional)
    # ============================================
    print("\n📝 Inserting sample data...")
    
    # Sample rule for testing
    if db.analytics_rules.count_documents({}) == 0:
        sample_rule = {
            "device_id": "sample_camera_001",
            "config_token": "main_config",
            "rule_name": "FrontGate_LineCrossing",
            "rule_type": "tt:LineDetector",
            "parameters": {
                "Direction": "Any",
                "ClassFilter": ["Vehicle", "Person"],
                "Segments": [
                    {"x": 0.1, "y": 0.5},
                    {"x": 0.9, "y": 0.5}
                ]
            },
            "is_active": True,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        db.analytics_rules.insert_one(sample_rule)
        print("   ✅ Sample rule inserted")
    else:
        print("   ⏭️ Sample data already exists")
    
    # ============================================
    # SUMMARY
    # ============================================
    print("\n" + "="*60)
    print("🎉 ANALYTICS COLLECTIONS INITIALIZED SUCCESSFULLY!")
    print("="*60)
    
    print("\n📁 Database Summary:")
    collections = [
        "analytics_configs",
        "analytics_rules", 
        "analytics_objects",
        "analytics_events",
        "analytics_face_matches",
        "analytics_lpr_matches",
        "analytics_audio_events"
    ]
    
    for col_name in collections:
        count = db[col_name].count_documents({})
        print(f"   📄 {col_name}: {count} documents")
    
    print("\n✅ Setup complete! You can now use analytics features.")
    client.close()
    return True

if __name__ == "__main__":
    success = init_analytics_collections()
    if not success:
        sys.exit(1)