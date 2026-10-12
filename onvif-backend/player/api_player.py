from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from io import BytesIO
import tempfile
import os
from dotenv import load_dotenv
load_dotenv()

from decrypt_segment import decrypt_to_bytes

app = Flask(__name__)
# Restrict allowed origins instead of using a wildcard
CORS(app, origins=[o.strip() for o in os.environ["CORS_ALLOWED_ORIGINS"].split(",") if o.strip()])
@app.route("/play", methods=["POST"])
def play_video():
    try:
        print("🔥 Request received")

        # ── Check file ─────────────────────────────
        if "file" not in request.files:
            print("❌ No file in request")
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files["file"]
        print(f"📁 File received: {file.filename}")

        # ── Save .enc temporarily ──────────────────
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".enc")
        enc_path = tmp.name
        tmp.close()  # ⚠️ Important for Windows

        file.save(enc_path)
        print(f"💾 Saved at: {enc_path}")

        # ── Decrypt ────────────────────────────────
        decrypted = decrypt_to_bytes(enc_path)

        # Cleanup enc file
        try:
            os.remove(enc_path)
        except:
            pass

        if decrypted is None:
            print("❌ Decryption failed")
            return jsonify({"error": "Decryption failed"}), 500

        print(f"✅ Decrypted size: {len(decrypted)} bytes")

        # ── Return video directly (BEST METHOD) ────
        return send_file(
            BytesIO(decrypted),
            mimetype="video/mp4",
            as_attachment=False
        )

    except Exception as e:
        print("💥 ERROR:", e)
        return jsonify({"error": str(e)}), 500


# ── Run server ───────────────────────────────────
if __name__ == "__main__":
    app.run(
    host=os.environ.get("PLAYER_HOST", "127.0.0.1"),
    port=int(os.environ["PLAYER_PORT"]),
    debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true",
)
