import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SceneBase } from './SceneBase.js';
import { BrainMesh } from './BrainMesh.js';

// ─────────────────────────────────────────────
// MACHINE SHADERS (Identical to Brain Shader logic)
// ─────────────────────────────────────────────
const machineVertexShader = `
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying vec3 vTangent;
    varying vec3 vBitangent;
    
    // Notice: We completely removed "attribute vec4 tangent;" from here!
    // Three.js will automatically inject it for us when needed.

    void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        
        // Safe fallback if the model lacks tangents
        #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
            vTangent = normalize(normalMatrix * objectTangent);
            vBitangent = normalize(cross(vNormal, vTangent) * tangent.w);
        #else
            vTangent = vec3(0.0);
            vBitangent = vec3(0.0);
        #endif
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const machineFragmentShader = `
    uniform sampler2D tNormalMap;
    uniform vec2 normalScale;
    uniform float emissionStrength;
    uniform float transparentOpacity;
    uniform vec3 colorCenter;
    uniform vec3 colorMid;
    uniform vec3 colorEdge;
    uniform float midPos;
    
    uniform float opacity;

    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying vec3 vTangent;
    varying vec3 vBitangent;

    void main() {
        // 1. Safeguard: Check if TBN is valid
        bool hasTangent = (length(vTangent) > 0.0);
        
        vec3 mapN = texture2D(tNormalMap, vUv).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        mapN = normalize(mapN);

        vec3 perturbedNormal;
        if (hasTangent) {
            mat3 tbn = mat3(vTangent, vBitangent, vNormal);
            perturbedNormal = normalize(tbn * mapN);
        } else {
            perturbedNormal = normalize(vNormal);
        }

        // 2. Safeguard: Ensure facing is never negative
        vec3 viewDir = normalize(vViewPosition);
        float facing = 1.0 - abs(dot(viewDir, perturbedNormal));
        facing = clamp(facing, 0.0, 1.0); // CRITICAL: Stop NaNs here

        vec3 rampColor;
        if (facing < midPos) {
            float t = facing / midPos;
            rampColor = mix(colorCenter, colorMid, t);
        } else {
            float t = (facing - midPos) / (1.0 - midPos);
            rampColor = mix(colorMid, colorEdge, t);
        }

        gl_FragColor = vec4(rampColor * emissionStrength, transparentOpacity * opacity);
    }
`;

const waveVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const waveFragmentShader = `
    uniform float time;
    uniform float scale;
    uniform vec3 color;
    uniform float speed;
    uniform bool useX; // true for X direction, false for Y
    varying vec2 vUv;
    uniform float opacity;

    void main() {
        // Use X or Y UV coordinate
        float coord = useX ? vUv.x : vUv.y;
        
        // Sine wave formula: sin(coord * scale + time)
        float wave = sin(coord * scale + time * speed) * 0.5 + 0.5;
        
        // Intensity logic
        float intensity = pow(wave, 2.0); 
        gl_FragColor = vec4(color * intensity, intensity * opacity);
    }
`;

// ─────────────────────────────────────────────
// DEFAULT PARAMS
// ─────────────────────────────────────────────
const DEFAULTS = {
    modelBasePath: 'https://cdn.jsdelivr.net/gh/AaryanTRahman/cpc-clinics-rtms@main/models',
    machineModel:  'Machine.glb', // <--- Name of your new machine model

    // ── Machine Customization ──
    machinePosition: [0.1, 1.08, 0], // [X, Y, Z] Adjustable location over the brain
    machineScale:    [0.4, 0.4, 0.4],
    machineRotation: [0, -Math.PI / 1 + 0.5, 0], 
    
    
    // Machine Material Colors
    machineColorCenter: '#2c2c2c', 
    machineColorMid:    '#156c77', 
    machineColorEdge:   '#d4d4d4', 
    machineEmission:    1,
    machineOpacity:     1,       // Slightly more opaque than the brain?
    machineMidPos:      0.5,
    machineWaveColor: '#3deffc',
    machineWaveScale: -30,
    machineWaveSpeed: 5.0,
    machineWaveDirection: 'X',

    // ── Brain Overrides ──
    brainActivation: 1.0,
    brainPositionY:  0,    // Center the brain
    brainRotationY: -1,

    // ── Scene Settings ──
    useWindowSize: true,   // Fullscreen canvas
    fov:      15,
    position: [0, 0, 10],  // Camera position
    lookAt:   [0, 0.5, 0],
    bloom:    { strength: 0.35, radius: 0.6, threshold: 0.2 },
    vignette: { radius: 1.2, smoothness: 0.8 },
};

// ─────────────────────────────────────────────
// INIT FUNCTION
// ─────────────────────────────────────────────
export async function initMachineScene(canvas = null, params = {}) {
    const cfg = { ...DEFAULTS, ...params };

    const sceneBase = new SceneBase(canvas, {
        useWindowSize: cfg.useWindowSize,
        fov: cfg.fov,
        position: cfg.position,
        lookAt: cfg.lookAt,
        bloom: cfg.bloom,
        vignette: cfg.vignette,
        fog: null,
    });

    const { scene } = sceneBase;

    // Standard Machine Material
    const machineMaterial = new THREE.ShaderMaterial({
        vertexShader: machineVertexShader,
        fragmentShader: machineFragmentShader,
        uniforms: {
            tNormalMap: { value: new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1) },
            normalScale: { value: new THREE.Vector2(0.5, 0.5) },
            emissionStrength: { value: cfg.machineEmission },
            transparentOpacity: { value: cfg.machineOpacity },
            colorCenter: { value: new THREE.Color(cfg.machineColorCenter) },
            colorMid: { value: new THREE.Color(cfg.machineColorMid) },
            colorEdge: { value: new THREE.Color(cfg.machineColorEdge) },
            midPos: { value: cfg.machineMidPos },
            opacity: { value: 0.0 }, // Initialize at 0
        },
        transparent: true,
        depthWrite: true,
        side: THREE.FrontSide,
        blending: THREE.NormalBlending,
    });
    machineMaterial.defines = { USE_TANGENT: '' };

    const loader = new GLTFLoader();
    const [brain, machineGLTF] = await Promise.all([
        BrainMesh.load(cfg.modelBasePath, { activation: cfg.brainActivation }),
        new Promise((resolve, reject) => loader.load(`${cfg.modelBasePath}/${cfg.machineModel}`, resolve, undefined, reject))
    ]);

    scene.add(brain.group);
    const machineGroup = machineGLTF.scene;
    machineGroup.position.set(...cfg.machinePosition);
    machineGroup.scale.set(...cfg.machineScale);
    machineGroup.rotation.set(...cfg.machineRotation);
    scene.add(machineGroup);

    // Set Up Traversal
    machineGroup.traverse((child) => {
        if (child.isMesh) {
            if (child.name.toLowerCase().includes('wave')) {
                child.material = new THREE.ShaderMaterial({
                    vertexShader: waveVertexShader,
                    fragmentShader: waveFragmentShader,
                    uniforms: {
                        time: { value: 0 },
                        scale: { value: cfg.machineWaveScale },
                        speed: { value: cfg.machineWaveSpeed },
                        useX: { value: cfg.machineWaveDirection === 'X' },
                        color: { value: new THREE.Color(cfg.machineWaveColor) },
                        opacity: { value: 0.0 }
                    },
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });
                child.userData.isWave = true;
            } else {
                child.material = machineMaterial;
            }
            child.frustumCulled = false;
        }
    });

    // THE CONTROLLER
    const setMachineOn = (value) => {
        const val = THREE.MathUtils.clamp(value, 0, 1);
        brain.setActivation(val);
        machineGroup.traverse((child) => {
            if (child.isMesh && child.material && child.material.uniforms.opacity) {
                child.material.uniforms.opacity.value = val;
                child.visible = (val > 0);
            }
        });
    };

    sceneBase.startLoop((elapsed) => {
        brain.update(elapsed);
        machineGroup.traverse((child) => {
            if (child.userData.isWave) child.material.uniforms.time.value = elapsed;
        });
    });

    return { sceneBase, brain, machineGroup, setMachineOn };
}