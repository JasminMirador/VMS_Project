import redis
import json
import time

def monitor_stream():
    print("Listening for AI alerts on Redis stream 'otherevent'...")
    r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)
    
    # '$' means listen to new messages arriving from now on
    last_id = '$'
    
    while True:
        try:
            # Block for up to 0 (indefinitely) waiting for new messages
            messages = r.xread({'vms:events:otherevent': last_id}, count=10, block=0)
            for stream, msgs in messages:
                for msg_id, msg_data in msgs:
                    print(f"\n--- New Alert Received (ID: {msg_id}) ---")
                    print(json.dumps(msg_data, indent=2))
                    last_id = msg_id
        except KeyboardInterrupt:
            print("\nStopped listening.")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(2)

if __name__ == '__main__':
    monitor_stream()
