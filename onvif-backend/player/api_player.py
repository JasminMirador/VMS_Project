from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from io import BytesIO
import tempfile
import os

from decrypt_segment import decrypt_to_bytes

app = Flask(__name__)
# Restrict allowed origins instead of using a wildcard
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000","http://192.168.126.200:5173","http://14.99.8.170:5173"])  # ✅ Allow React frontend

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
    app.run(host="127.0.0.1", port=8000, debug=True)
