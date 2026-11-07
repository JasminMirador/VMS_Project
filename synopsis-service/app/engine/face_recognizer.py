import os
import cv2
import numpy as np
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

class FaceEmbeddingEngine:
    """
    Face Recognition & Embedding Engine using OpenCV YuNet (Detector) 
    and SFace (128-D Feature Recognizer).
    """
    def __init__(self, models_dir: Optional[str] = None):
        if models_dir is None:
            models_dir = str(Path(__file__).resolve().parent.parent.parent / "models")
        
        self.yunet_path = os.path.join(models_dir, "face_detection_yunet_2023mar.onnx")
        self.sface_path = os.path.join(models_dir, "face_recognition_sface_2021dec.onnx")

        if not os.path.exists(self.yunet_path) or not os.path.exists(self.sface_path):
            raise FileNotFoundError(
                f"Face models not found in {models_dir}. Expected "
                f"face_detection_yunet_2023mar.onnx and face_recognition_sface_2021dec.onnx"
            )

        # Initialize YuNet Detector (default 320x320, dynamically resized per image)
        self.detector = cv2.FaceDetectorYN.create(
            model=self.yunet_path,
            config="",
            input_size=(320, 320),
            score_threshold=0.6,
            nms_threshold=0.3,
            top_k=5000
        )

        # Initialize SFace Recognizer
        self.recognizer = cv2.FaceRecognizerSF.create(
            model=self.sface_path,
            config=""
        )
        logger.info("[FaceRecognizer] YuNet and SFace models loaded successfully.")

    def extract_probe_embedding(self, image_bytes: bytes) -> Tuple[np.ndarray, np.ndarray]:
        """
        Extracts probe embedding vector and aligned face crop from uploaded raw image bytes.
        Returns: (feature_vector_128d, aligned_face_bgr)
        """
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Uploaded file is not a valid image.")

        h, w = img.shape[:2]
        self.detector.setInputSize((w, h))
        retval, faces = self.detector.detect(img)

        # Fallback 1: Lower score threshold (0.35) for angled / profile or difficult lighting
        if faces is None or len(faces) == 0:
            self.detector.setScoreThreshold(0.35)
            retval, faces = self.detector.detect(img)
            self.detector.setScoreThreshold(0.6)

        # Fallback 2: Border padding (for tight passport/face crops touching image boundary)
        if faces is None or len(faces) == 0:
            pad_y, pad_x = max(10, int(h * 0.2)), max(10, int(w * 0.2))
            padded = cv2.copyMakeBorder(img, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REFLECT)
            ph, pw = padded.shape[:2]
            self.detector.setInputSize((pw, ph))
            self.detector.setScoreThreshold(0.35)
            retval, pfaces = self.detector.detect(padded)
            self.detector.setScoreThreshold(0.6)
            self.detector.setInputSize((w, h))
            if pfaces is not None and len(pfaces) > 0:
                faces_list = []
                for pf in pfaces:
                    sf = pf.copy()
                    sf[0] = max(0, sf[0] - pad_x)
                    sf[1] = max(0, sf[1] - pad_y)
                    for li in range(4, 14, 2):
                        sf[li] = max(0, sf[li] - pad_x)
                        sf[li + 1] = max(0, sf[li + 1] - pad_y)
                    faces_list.append(sf)
                faces = np.array(faces_list)

        # Fallback 3: Downscaling for large images (>1280px)
        if (faces is None or len(faces) == 0) and max(h, w) > 1280:
            scale = 960.0 / max(h, w)
            resized = cv2.resize(img, (int(w * scale), int(h * scale)))
            rh, rw = resized.shape[:2]
            self.detector.setInputSize((rw, rh))
            self.detector.setScoreThreshold(0.35)
            retval, rfaces = self.detector.detect(resized)
            self.detector.setScoreThreshold(0.6)
            self.detector.setInputSize((w, h))
            if rfaces is not None and len(rfaces) > 0:
                faces_list = []
                inv_s = 1.0 / scale
                for rf in rfaces:
                    sf = rf.copy()
                    sf[0:4] = sf[0:4] * inv_s
                    sf[4:14] = sf[4:14] * inv_s
                    faces_list.append(sf)
                faces = np.array(faces_list)

        if faces is None or len(faces) == 0:
            raise ValueError("No face detected in the uploaded photo. Please upload a clear frontal face image.")

        # Pick the largest face if multiple faces are present
        largest_face = max(faces, key=lambda f: float(f[2]) * float(f[3]))
        aligned_face = self.recognizer.alignCrop(img, largest_face)
        feature = self.recognizer.feature(aligned_face)
        
        # Ensure feature vector is 1D float32 normalized
        feature = feature.flatten()
        norm = np.linalg.norm(feature)
        if norm > 0:
            feature = feature / norm

        return feature, aligned_face

    def extract_crop_embedding(self, face_bgr: np.ndarray) -> Optional[np.ndarray]:
        """
        Extracts feature embedding from a cropped face image (from video frame or saved thumbnail).
        """
        if face_bgr is None or face_bgr.size == 0:
            return None

        h, w = face_bgr.shape[:2]
        if h < 20 or w < 20:
            return None

        self.detector.setInputSize((w, h))
        retval, faces = self.detector.detect(face_bgr)

        if faces is not None and len(faces) > 0:
            best_face = max(faces, key=lambda f: float(f[2]) * float(f[3]))
            aligned = self.recognizer.alignCrop(face_bgr, best_face)
        else:
            # Fallback direct resize to SFace standard input (112x112)
            aligned = cv2.resize(face_bgr, (112, 112))

        feature = self.recognizer.feature(aligned)
        feature = feature.flatten()
        norm = np.linalg.norm(feature)
        if norm > 0:
            feature = feature / norm
        return feature

    @classmethod
    def calibrate_similarity(cls, raw_sim: float) -> float:
        """
        Calibrates raw SFace cosine similarity into a standardized 0.0 to 1.0 confidence score.
        OpenCV SFace cosine benchmark threshold for the same person is 0.363.
        - raw <= 0.15 (completely different): 0% to 30%
        - 0.15 < raw <= 0.363 (uncertain / different): 30% to 70%
        - 0.363 < raw <= 0.60 (positive match / CCTV quality): 70% to 95%
        - raw > 0.60 (very high quality / same photo): 95% to 100%
        """
        if raw_sim <= 0.15:
            return max(0.0, (raw_sim / 0.15) * 0.30)
        elif raw_sim <= 0.363:
            return 0.30 + ((raw_sim - 0.15) / (0.363 - 0.15)) * 0.40
        elif raw_sim <= 0.60:
            return 0.70 + ((raw_sim - 0.363) / (0.60 - 0.363)) * 0.25
        else:
            return min(1.0, 0.95 + ((raw_sim - 0.60) / 0.40) * 0.05)

    @classmethod
    def compute_similarity(cls, feat1: np.ndarray, feat2: np.ndarray) -> float:
        """
        Calibrated similarity between two normalized feature vectors.
        Returns a human-readable match confidence score in range [0.0, 1.0].
        """
        if feat1 is None or feat2 is None:
            return 0.0
        dot = float(np.dot(feat1, feat2))
        raw_sim = max(0.0, min(1.0, dot))
        return cls.calibrate_similarity(raw_sim)

    @classmethod
    def match_against_multi_probes(cls, candidate_feat: np.ndarray, probe_feats_list: list) -> Tuple[float, int]:
        """
        Compares candidate against all probe vectors.
        Returns: (best_similarity_score, best_probe_index)
        """
        if candidate_feat is None or not probe_feats_list:
            return 0.0, 0
        best_sim = 0.0
        best_idx = 0
        for idx, probe in enumerate(probe_feats_list):
            sim = cls.compute_similarity(probe, candidate_feat)
            if sim > best_sim:
                best_sim = sim
                best_idx = idx
        return best_sim, best_idx


async def identify_faces_against_employees(faces: list, db, face_thumbs_dir: str) -> list:
    """
    Cross-references detected faces against the MongoDB employees collection.
    Attaches person_name, status ("authorised", "suspended", "unauthorised"),
    department, email, employee_id, and match_score to each face item.
    """
    import os as _os
    import cv2 as _cv2
    import numpy as _np

    try:
        rec_engine = FaceEmbeddingEngine()
    except Exception as ie:
        logger.error(f"[FaceIdentify] Failed to initialize FaceEmbeddingEngine: {ie}")
        for f in faces:
            f.setdefault("status", "unauthorised")
            f.setdefault("person_name", "Unknown")
        return faces

    try:
        emp_cursor = db["employees"].find({"face_embedding": {"$exists": True, "$ne": None}})
        enrolled_employees = await emp_cursor.to_list(length=2000)
        logger.info(f"[FaceIdentify] Checking {len(faces)} face(s) against {len(enrolled_employees)} enrolled employee(s)...")

        emp_feats = []
        for emp in enrolled_employees:
            emb = emp.get("face_embedding")
            if emb and len(emb) == 128:
                emp_feats.append({
                    "emp_id": emp.get("emp_id"),
                    "name": emp.get("name", "Unknown"),
                    "email": emp.get("email", ""),
                    "department": emp.get("department", ""),
                    "status": (emp.get("status") or "authorised").lower(),
                    "vector": _np.array(emb, dtype=_np.float32)
                })

        for f in faces:
            basename = f.get("thumbnail_path", "").replace("\\", "/").split("/")[-1]
            disk_path = _os.path.join(face_thumbs_dir, basename)
            if not _os.path.exists(disk_path):
                f.setdefault("person_name", "Unknown")
                f.setdefault("status", "unauthorised")
                continue

            crop_img = _cv2.imread(disk_path)
            if crop_img is None:
                f.setdefault("person_name", "Unknown")
                f.setdefault("status", "unauthorised")
                continue

            crop_feat = rec_engine.extract_crop_embedding(crop_img)
            if crop_feat is not None and emp_feats:
                best_emp = None
                best_sim = 0.0
                for emp in emp_feats:
                    sim = rec_engine.compute_similarity(emp["vector"], crop_feat)
                    if sim > best_sim:
                        best_sim = sim
                        best_emp = emp

                EMPLOYEE_MATCH_THRESHOLD = 0.60
                if best_sim >= EMPLOYEE_MATCH_THRESHOLD and best_emp:
                    f["person_name"] = best_emp["name"]
                    f["employee_id"] = best_emp["emp_id"]
                    f["email"] = best_emp["email"]
                    f["department"] = best_emp["department"]
                    f["status"] = best_emp["status"]  # "authorised" or "suspended"
                    f["employee_match_score"] = round(best_sim * 100.0, 1)
                    if "match_score" not in f:
                        f["match_score"] = round(best_sim * 100.0, 1)
                    logger.info(f"[FaceIdentify] Face {basename} -> {best_emp['name']} ({best_emp['status']}, {best_sim*100:.1f}%)")
                else:
                    f["person_name"] = "Unknown"
                    f["status"] = "unauthorised"
                    f["department"] = ""
                    if "match_score" not in f:
                        f["match_score"] = round(best_sim * 100.0, 1) if best_sim > 0 else 0
            else:
                f["person_name"] = "Unknown"
                f["status"] = "unauthorised"
                f["department"] = ""
                if "match_score" not in f:
                    f["match_score"] = 0

    except Exception as e:
        logger.error(f"[FaceIdentify] Error identifying employees: {e}", exc_info=True)
        for f in faces:
            f.setdefault("person_name", "Unknown")
            f.setdefault("status", "unauthorised")

    return faces
