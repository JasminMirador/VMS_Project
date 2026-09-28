import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM();
global.window = dom.window;
global.document = dom.window.document;
global.fetch = () => {};

const buffer = fs.readFileSync('C:/Users/HP/Downloads/office_digital_twin_shell.glb');
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuffer, '', (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const partition = gltf.scene.getObjectByName('Right_Partition_1');
    if (partition) {
        const box = new THREE.Box3().setFromObject(partition);
        const size = new THREE.Vector3();
        box.getSize(size);
        console.log('Right_Partition_1 dimensions:', size);
    }
});
