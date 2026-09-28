import * as THREE from 'three';

export function analyzeGltfParts(gltfScene, options = {}) {
  const { proximityThreshold = 0.3 } = options;

  const rawParts = [];
  gltfScene.traverse((node) => {
    if (node.isMesh) {
      node.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(node);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      rawParts.push({
        name: node.name || '(unnamed)',
        dimensions: { width: size.x, height: size.y, depth: size.z },
        worldCenter: { x: center.x, y: center.y, z: center.z },
        worldBoundsMin: { x: box.min.x, y: box.min.y, z: box.min.z },
        worldBoundsMax: { x: box.max.x, y: box.max.y, z: box.max.z },
      });
    }
  });

  const genericPattern = /^Object_\d+$/i;
  const materialPattern = /^Mesh\d+_/i;
  const genericCount = rawParts.filter(p => genericPattern.test(p.name)).length;
  const materialCount = rawParts.filter(p => materialPattern.test(p.name)).length;

  let namingQuality = 'semantic';
  if (genericCount / rawParts.length > 0.5) namingQuality = 'generic';
  else if (materialCount / rawParts.length > 0.5) namingQuality = 'material-based';

  let finalParts = rawParts;
  let strategy = 'direct';

  if (namingQuality === 'material-based') {
    finalParts = groupPartsByProximity(rawParts, proximityThreshold).map((group, i) => {
      const combinedBox = new THREE.Box3();
      group.forEach(p => {
        combinedBox.expandByPoint(new THREE.Vector3(p.worldBoundsMin.x, p.worldBoundsMin.y, p.worldBoundsMin.z));
        combinedBox.expandByPoint(new THREE.Vector3(p.worldBoundsMax.x, p.worldBoundsMax.y, p.worldBoundsMax.z));
      });
      const size = new THREE.Vector3();
      combinedBox.getSize(size);
      return {
        groupId: "cluster_" + i,
        memberCount: group.length,
        memberNames: group.map(p => p.name),
        dimensions: { width: size.x, height: size.y, depth: size.z },
      };
    });
    strategy = 'clustered';
  } else if (namingQuality === 'generic') {
    strategy = 'coarse-only';
  }

  return {
    totalRawParts: rawParts.length,
    namingQuality,
    strategy,
    parts: finalParts,
    warning:
      strategy === 'coarse-only'
        ? 'Model geometry is merged at export; sub-part detail unavailable.'
        : strategy === 'clustered'
        ? 'Parts grouped by spatial proximity; labels are not semantic.'
        : null,
  };
}

function groupPartsByProximity(parts, distanceThreshold = 0.3) {
  const groups = [];
  const used = new Set();

  parts.forEach((part, i) => {
    if (used.has(i)) return;
    const group = [part];
    used.add(i);

    parts.forEach((other, j) => {
      if (used.has(j) || i === j) return;
      const dx = part.worldCenter.x - other.worldCenter.x;
      const dy = part.worldCenter.y - other.worldCenter.y;
      const dz = part.worldCenter.z - other.worldCenter.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < distanceThreshold) {
        group.push(other);
        used.add(j);
      }
    });

    groups.push(group);
  });

  return groups;
}
