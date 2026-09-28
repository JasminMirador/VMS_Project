/**
 * GltfFloorRenderer.js
 * ─────────────────────────────────────────────────────────────────
 * Loads a .gltf or .glb 3D model file and renders it from a
 * top-down orthographic camera into a 2D PNG data URL.
 *
 * The resulting image can be used directly as a floor plan image
 * in the existing MapView 2D canvas pipeline.
 *
 * Usage:
 *   import { renderGltfToImage } from "./GltfFloorRenderer";
 *   const { dataUrl, width, height } = await renderGltfToImage(file);
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { analyzeGltfParts } from "./GltfPartAnalyzer.js";

/**
 * Render a .gltf / .glb file to a top-down 2D image.
 *
 * @param {File} file  – the .gltf or .glb File object from an <input>
 * @param {number} size – max pixel dimension of output image (default 2048)
 * @returns {Promise<{ dataUrl: string, width: number, height: number }>}
 */
export async function renderGltfToImage(file, size = 2048) {
  // ── 1. Read file into an ArrayBuffer ────────────────────────────
  const arrayBuffer = await file.arrayBuffer();

  // ── 2. Load the GLTF/GLB model first to get bounds ─────────────
  const loader = new GLTFLoader();

  const gltf = await new Promise((resolve, reject) => {
    const ext = file.name.toLowerCase().split(".").pop();

    if (ext === "glb") {
      // Binary GLB — parse directly from ArrayBuffer
      loader.parse(arrayBuffer, "", resolve, reject);
    } else {
      // .gltf (JSON) — create a blob URL for loading
      const blob = new Blob([arrayBuffer], { type: "model/gltf+json" });
      const url = URL.createObjectURL(blob);
      loader.load(
        url,
        (result) => { URL.revokeObjectURL(url); resolve(result); },
        undefined,
        (err) => { URL.revokeObjectURL(url); reject(err); }
      );
    }
  });

  const model = gltf.scene;

  // ── 2.4 Extract Embedded Camera Markers (from previous Mirador exports) ──
  let embeddedMarkers = [];
  if (gltf.scene?.userData?.markers && Array.isArray(gltf.scene.userData.markers)) {
    embeddedMarkers = gltf.scene.userData.markers;
  } else if (gltf.userData?.markers && Array.isArray(gltf.userData.markers)) {
    embeddedMarkers = gltf.userData.markers;
  } else {
    gltf.scene.traverse((node) => {
      if (node.userData?.isMiradorCamera && node.userData?.camId) {
        embeddedMarkers.push({
          camId: node.userData.camId,
          x: node.userData.x,
          y: node.userData.y,
          direction: node.userData.direction || 0,
          fovAngle: node.userData.fovAngle || 60,
          camName: node.userData.camName || ""
        });
      }
    });
  }

  // Detach any baked camera / beam meshes before computing bounding box and rendering 2D floor plan
  const nodesToExclude = [];
  model.traverse((node) => {
    if (node.userData?.isMiradorCamera || node.userData?.isMiradorFovBeam || node.name?.startsWith("MiradorCamera_") || node.name?.startsWith("FOV_Beam_")) {
      nodesToExclude.push(node);
    }
  });
  nodesToExclude.forEach((node) => {
    if (node.parent) node.parent.remove(node);
  });

  // ── 2.5 Analyze Parts ──
  const partsReport = analyzeGltfParts(model);

  // ── 3. Compute bounding box ─────────────────────────────────────
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const boxSize = box.getSize(new THREE.Vector3());

  // ── 4. Detect up-axis ───────────────────────────────────────────
  // For architectural / floor-plan models:
  //   - glTF standard is Y-up → camera looks down -Y
  //   - CAD exports often use Z-up → camera looks down -Z
  //
  // Heuristic: The up-axis is the one with the smallest extent
  // (building height < building width/depth for most floor plans).
  // If Y and Z are very close in size, prefer Y-up (glTF standard).
  const ratioYZ = boxSize.y > 0 && boxSize.z > 0
    ? Math.min(boxSize.y, boxSize.z) / Math.max(boxSize.y, boxSize.z)
    : 1;

  let upAxis;
  if (ratioYZ > 0.8) {
    // Y and Z are similar — use glTF standard Y-up
    upAxis = "y";
  } else if (boxSize.y <= boxSize.x && boxSize.y <= boxSize.z) {
    upAxis = "y";
  } else if (boxSize.z <= boxSize.x && boxSize.z <= boxSize.y) {
    upAxis = "z";
  } else {
    upAxis = "y"; // fallback to glTF default
  }

  // ── 5. Determine horizontal extents and output dimensions ───────
  let spanW, spanH; // horizontal plane dimensions
  if (upAxis === "y") {
    spanW = boxSize.x; // left-right
    spanH = boxSize.z; // front-back
  } else {
    spanW = boxSize.x; // left-right
    spanH = boxSize.y; // front-back
  }

  // Maintain aspect ratio of the floor plan (don't force square)
  const aspect = spanW / spanH;
  let outW, outH;
  if (aspect >= 1) {
    outW = size;
    outH = Math.round(size / aspect);
  } else {
    outH = size;
    outW = Math.round(size * aspect);
  }
  // Ensure even dimensions for GPU compatibility
  outW = Math.max(outW, 64);
  outH = Math.max(outH, 64);

  // ── 6. Set up offscreen renderer ────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(outW, outH);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0xffffff, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── 7. Scene + lighting ─────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // Strong ambient for even, shadow-free illumination (floor plan look)
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  // Directional light from directly above
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  if (upAxis === "y") {
    dirLight.position.set(center.x, box.max.y + 50, center.z);
  } else {
    dirLight.position.set(center.x, center.y, box.max.z + 50);
  }
  dirLight.target.position.copy(center);
  scene.add(dirLight);
  scene.add(dirLight.target);

  scene.add(model);

  // ── 8. Orthographic camera — pure top-down ──────────────────────
  const padding = 1.05;
  const halfW = (spanW * padding) / 2;
  const halfH = (spanH * padding) / 2;
  const far = boxSize.x + boxSize.y + boxSize.z + 200;

  const camera = new THREE.OrthographicCamera(
    -halfW, halfW, halfH, -halfH,
    0.01, far
  );

  if (upAxis === "y") {
    // Y-up: camera above, looking straight down
    camera.position.set(center.x, box.max.y + 50, center.z);
    camera.up.set(0, 0, -1); // Z- is "forward" when looking down Y
    camera.lookAt(center.x, center.y, center.z);
  } else {
    // Z-up: camera above, looking straight down
    camera.position.set(center.x, center.y, box.max.z + 50);
    camera.up.set(0, 1, 0); // Y is "forward" when looking down Z
    camera.lookAt(center.x, center.y, center.z);
  }

  camera.updateProjectionMatrix();

  // ── 9. Render ───────────────────────────────────────────────────
  renderer.render(scene, camera);

  // ── 10. Extract image ───────────────────────────────────────────
  const dataUrl = renderer.domElement.toDataURL("image/png");

  // ── 11. Cleanup GPU resources ───────────────────────────────────
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => {
          if (m.map) m.map.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          if (m.metalnessMap) m.metalnessMap.dispose();
          if (m.aoMap) m.aoMap.dispose();
          m.dispose();
        });
      } else {
        if (obj.material.map) obj.material.map.dispose();
        if (obj.material.normalMap) obj.material.normalMap.dispose();
        if (obj.material.roughnessMap) obj.material.roughnessMap.dispose();
        if (obj.material.metalnessMap) obj.material.metalnessMap.dispose();
        if (obj.material.aoMap) obj.material.aoMap.dispose();
        obj.material.dispose();
      }
    }
  });
  renderer.dispose();
  renderer.forceContextLoss();

  // ── 12. Calculate absolute Scale (Pixels Per Meter) ─────────────
  // The camera frustum horizontally covers exactly (spanW * 1.05) meters.
  // This is rendered into an image of outW pixels wide.
  const ppm = outW / (spanW * 1.05);

  return { dataUrl, width: outW, height: outH, ppm, partsReport, embeddedMarkers };
}
