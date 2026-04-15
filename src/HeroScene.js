import * as THREE from 'three';
import { SceneBase }  from './SceneBase.js';
import { BrainMesh }  from './BrainMesh.js';

// ─────────────────────────────────────────────
// BACKGROUND IMAGE SHADER
// Tints a grayscale PNG with a solid color and adds
// an outward-ripple pulse animation.
// ─────────────────────────────────────────────
const bgVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const bgFragmentShader = `
    uniform sampler2D tDiffuse;
    uniform vec3      colorBase;
    uniform float     time;
    /** Frequency of ripple rings (higher = more rings) */
    uniform float     pulseFrequency;
    /** Speed the rings travel outward */
    uniform float     pulseSpeed;
    /** How much the rings modulate brightness (0 = no pulse) */
    uniform float     pulseDepth;

    varying vec2 vUv;

    void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));

        float dist = length(vUv - vec2(0.5));
        float pulse = sin(dist * pulseFrequency - time * pulseSpeed) * 0.5 + 0.5;
        float pulseFactor = mix(1.0 - pulseDepth, 1.0, pulse);

        float finalAlpha = luminance * pulseFactor;
        gl_FragColor = vec4(colorBase * finalAlpha, finalAlpha);
    }
`;

// ─────────────────────────────────────────────
// DEFAULT PARAMS
// ─────────────────────────────────────────────
const DEFAULTS = {
    // ── Paths ──
    modelBasePath: 'https://cdn.jsdelivr.net/gh/AaryanTRahman/cpc-clinics-rtms@a76063bd117df9ba5dbe053212692dcfec484527/models',
    bgImagePath:   'https://cdn.jsdelivr.net/gh/AaryanTRahman/cpc-clinics-rtms@main/images/NeuronBG.png',

    // ── Camera (passed through to SceneBase) ──
    fov:      30,
    position: [0, 0, 6],
    lookAt:   [0, 0, 0],

    // ── Background image ──
    bgColor:         '#46e9c0',
    bgDepth:         -20,         // Z position of the bg plane
    bgPulseFrequency: 15.0,
    bgPulseSpeed:     2.0,
    bgPulseDepth:     0.6,        // 0 = no pulse, 1 = full on/off

    // ── Particles ──
    particleCount:       400,
    particleSpread:      2.5,     // bounding cube half-size in world units
    particleSize:        0.025,
    particleColor:       '#4fecc5',
    particleOpacity:     0.8,
    particleWobbleSpeed: [0.5, 0.4, 0.6],  // per axis
    particleWobbleAmt:   0.2,              // world units of wobble

    // ── Mouse rotation (applied to centralGroup only) ──
    mouseStrength: 0.3,   // max rotation in radians
    mouseLerp:     0.05,  // smoothing (0 = instant, 1 = never moves)

    // ── BrainMesh params (any BrainMesh.DEFAULTS key is valid here) ──
    brain: {
        positionY: -0.5,
    },
};

// ─────────────────────────────────────────────
// INIT FUNCTION
// ─────────────────────────────────────────────

/**
 * Initialise the hero scene.
 *
 * @param {HTMLCanvasElement|null} canvas  Pass null to auto-create + append to body.
 * @param {object}                 params  Override any key from DEFAULTS above.
 * @returns {Promise<{ sceneBase, brain, dispose, setBrainActivation }>}
 */
export async function initHeroScene(canvas = null, params = {}) {
    const cfg = { ...DEFAULTS, ...params };

    // ── SceneBase ──
    const sceneBase = new SceneBase(canvas, {
        fov:      cfg.fov,
        position: cfg.position,
        lookAt:   cfg.lookAt,
    });
    const { scene, camera } = sceneBase;

    // centralGroup receives mouse rotation — brain lives inside it
    const centralGroup = new THREE.Group();
    scene.add(centralGroup);

    // ── Background image ──
    const bgTexture = new THREE.TextureLoader().load(cfg.bgImagePath);
    const bgMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse:       { value: bgTexture },
            colorBase:      { value: new THREE.Color(cfg.bgColor) },
            time:           { value: 0.0 },
            pulseFrequency: { value: cfg.bgPulseFrequency },
            pulseSpeed:     { value: cfg.bgPulseSpeed },
            pulseDepth:     { value: cfg.bgPulseDepth },
        },
        vertexShader:   bgVertexShader,
        fragmentShader: bgFragmentShader,
        transparent:    true,
        blending:       THREE.NormalBlending,
        depthWrite:     false,
        depthTest:      true,
    });

    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMaterial);
    bgMesh.position.set(0, 0, cfg.bgDepth);
    bgMesh.renderOrder = -2;
    scene.add(bgMesh);

    // Keep bg plane filling the viewport on resize
    function updateBgSize() {
        const dist   = camera.position.z - bgMesh.position.z;
        const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist;
        bgMesh.scale.set(height * camera.aspect, height, 1);
    }
    updateBgSize();

    // ── Particles ──
    const count   = cfg.particleCount;
    const spread  = cfg.particleSpread;
    const posArr  = new Float32Array(count * 3);
    const initArr = new Float32Array(count * 3);
    const phaseArr= new Float32Array(count * 3);

    for (let i = 0; i < count * 3; i += 3) {
        posArr[i]   = initArr[i]   = (Math.random() - 0.5) * spread;
        posArr[i+1] = initArr[i+1] = (Math.random() - 0.5) * spread;
        posArr[i+2] = initArr[i+2] = (Math.random() - 0.5) * spread;
        phaseArr[i]   = Math.random() * Math.PI * 2;
        phaseArr[i+1] = Math.random() * Math.PI * 2;
        phaseArr[i+2] = Math.random() * Math.PI * 2;
    }

    const particlesGeo = new THREE.BufferGeometry();
    particlesGeo.setAttribute('position',        new THREE.BufferAttribute(posArr,  3));
    particlesGeo.setAttribute('initialPosition', new THREE.BufferAttribute(initArr, 3));
    particlesGeo.setAttribute('phase',           new THREE.BufferAttribute(phaseArr,3));

    const particlesMat = new THREE.PointsMaterial({
        size:        cfg.particleSize,
        color:       cfg.particleColor,
        transparent: true,
        opacity:     cfg.particleOpacity,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
    });

    const particlesMesh = new THREE.Points(particlesGeo, particlesMat);
    // Added directly to scene (not centralGroup) so particles ignore mouse rotation
    scene.add(particlesMesh);

    // ── Brain ──
    const brain = await BrainMesh.load(cfg.modelBasePath, cfg.brain);
    centralGroup.add(brain.group);

    // ── Mouse rotation ──
    const mouse         = new THREE.Vector2();
    const targetRot     = new THREE.Vector2();
    let   windowHalfX   = window.innerWidth  / 2;
    let   windowHalfY   = window.innerHeight / 2;

    function onMouseMove(e) {
        mouse.x = (e.clientX - windowHalfX) / windowHalfX;
        mouse.y = (e.clientY - windowHalfY) / windowHalfY;
        targetRot.x = mouse.y * cfg.mouseStrength;
        targetRot.y = mouse.x * cfg.mouseStrength;
    }
    document.addEventListener('mousemove', onMouseMove);

    // Single onResize handler — updates both bg plane and mouse half-values
    sceneBase.onResize = (w, h) => {
        windowHalfX = w / 2;
        windowHalfY = h / 2;
        updateBgSize();
    };

    // ── Animation loop ──
    const wobbleSpeeds = cfg.particleWobbleSpeed;
    const wobbleAmt    = cfg.particleWobbleAmt;

    sceneBase.startLoop((elapsed) => {
        // Background ripple
        bgMaterial.uniforms.time.value = elapsed;

        // Brain neuron time
        brain.update(elapsed);

        // Smooth mouse rotation on centralGroup
        centralGroup.rotation.x += (targetRot.x - centralGroup.rotation.x) * cfg.mouseLerp;
        centralGroup.rotation.y += (targetRot.y - centralGroup.rotation.y) * cfg.mouseLerp;

        // Particle wobble
        const pos  = particlesGeo.attributes.position.array;
        const init = particlesGeo.attributes.initialPosition.array;
        const ph   = particlesGeo.attributes.phase.array;

        for (let i = 0; i < count * 3; i += 3) {
            pos[i]   = init[i]   + Math.sin(elapsed * wobbleSpeeds[0] + ph[i])   * wobbleAmt;
            pos[i+1] = init[i+1] + Math.cos(elapsed * wobbleSpeeds[1] + ph[i+1]) * wobbleAmt;
            pos[i+2] = init[i+2] + Math.sin(elapsed * wobbleSpeeds[2] + ph[i+2]) * wobbleAmt;
        }
        particlesGeo.attributes.position.needsUpdate = true;
    });

    // ── Public API ──
    return {
        sceneBase,
        brain,

        /** Set brain activation 0→1 from outside (e.g. scroll-driven) */
        setBrainActivation: (v) => brain.setActivation(v),

        /** Tear down the scene cleanly */
        dispose: () => {
            sceneBase.dispose();
            document.removeEventListener('mousemove', onMouseMove);
            particlesGeo.dispose();
            particlesMat.dispose();
            bgMaterial.dispose();
        },
    };
}
