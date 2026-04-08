import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─────────────────────────────────────────────
// NEURON SHADERS
// ─────────────────────────────────────────────

const neuronVertexShader = `
    varying vec3 vPosition;
    void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const neuronFragmentShader = `
    // Active colors (full activation)
    uniform vec3 color1;
    uniform vec3 color2;
    // Dull color (zero activation)
    uniform vec3 dullColor;
    // 0 = fully dull/frozen, 1 = fully active/animated
    uniform float activation;

    uniform float noiseScale;
    uniform float noiseContrast;
    uniform float emissionStrength;
    uniform float time;          // Already pre-scaled by activation in JS

    varying vec3 vPosition;

    vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
    float permute(float x){return mod(((x*34.0)+1.0)*x, 289.0);}
    float taylorInvSqrt(float r){return 1.79284291400159 - 0.85373472095314 * r;}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

    vec4 grad4(float j, vec4 ip){
        const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
        vec4 p,s;
        p.xyz = floor( fract (vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
        p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
        s = vec4(lessThan(p, vec4(0.0)));
        p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www;
        return p;
    }

    float snoise(vec4 v){
        const vec2 C = vec2(0.138196601125010504, 0.309016994374947451);
        vec4 i  = floor(v + dot(v, C.yyyy));
        vec4 x0 = v - i + dot(i, C.xxxx);
        vec4 i0;
        vec3 isX = step(x0.yzw, x0.xxx);
        vec3 isYZ = step(x0.zww, x0.yyz);
        i0.x = isX.x + isX.y + isX.z;
        i0.yzw = 1.0 - isX;
        i0.y += isYZ.x + isYZ.y;
        i0.zw += 1.0 - isYZ.xy;
        i0.z += isYZ.z;
        i0.w += 1.0 - isYZ.z;
        vec4 i3 = clamp(i0, 0.0, 1.0);
        vec4 i2 = clamp(i0-1.0, 0.0, 1.0);
        vec4 i1 = clamp(i0-2.0, 0.0, 1.0);
        vec4 x1 = x0 - i1 + 1.0 * C.xxxx;
        vec4 x2 = x0 - i2 + 2.0 * C.xxxx;
        vec4 x3 = x0 - i3 + 3.0 * C.xxxx;
        vec4 x4 = x0 - 1.0 + 4.0 * C.xxxx;
        i = mod(i, 289.0);
        float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
        vec4 j1 = permute(permute(permute(permute(
                i.w + vec4(i1.w, i2.w, i3.w, 1.0))
                + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
                + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
                + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
        vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
        vec4 p0 = grad4(j0,   ip);
        vec4 p1 = grad4(j1.x, ip);
        vec4 p2 = grad4(j1.y, ip);
        vec4 p3 = grad4(j1.z, ip);
        vec4 p4 = grad4(j1.w, ip);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        p4 *= taylorInvSqrt(dot(p4,p4));
        vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
        vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
        m0 = m0 * m0; m1 = m1 * m1;
        return 49.0 * (dot(m0*m0, vec3(dot(p0,x0), dot(p1,x1), dot(p2,x2)))
                     + dot(m1*m1, vec2(dot(p3,x3), dot(p4,x4))));
    }

    float fbm(vec4 x) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 2; ++i) {
            v += a * snoise(x);
            x *= 2.0;
            a *= 0.5;
        }
        return v;
    }

    void main() {
        vec4 noiseVector = vec4(vPosition * noiseScale, time * 0.5);
        float noiseVal = fbm(noiseVector);
        noiseVal = (noiseVal / 0.75) * 0.5 + 0.5;
        noiseVal = (noiseVal - 0.5) * noiseContrast + 0.5;
        noiseVal = clamp(noiseVal, 0.0, 1.0);

        float factor = clamp(noiseVal / 0.427, 0.0, 1.0);
        vec3 activeColor = mix(color1, color2, factor);

        // Blend from dull to active based on activation
        vec3 finalColor = mix(dullColor, activeColor, activation);

        gl_FragColor = vec4(finalColor * emissionStrength, 1.0);
    }
`;

// ─────────────────────────────────────────────
// BRAIN SHADERS
// ─────────────────────────────────────────────

const brainVertexShader = `
    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying vec3 vTangent;
    varying vec3 vBitangent;

    attribute vec4 tangent;

    void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        vec3 objectTangent = vec3(tangent.xyz);
        vTangent = normalize(normalMatrix * objectTangent);
        vBitangent = normalize(cross(vNormal, vTangent) * tangent.w);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const brainFragmentShader = `
    uniform sampler2D tNormalMap;
    uniform vec2 normalScale;
    uniform float emissionStrength;
    uniform float transparentOpacity;

    uniform vec3 colorCenter;
    uniform vec3 colorMid;
    uniform vec3 colorEdge;
    uniform float midPos;

    varying vec2 vUv;
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying vec3 vTangent;
    varying vec3 vBitangent;

    void main() {
        vec3 mapN = texture2D(tNormalMap, vUv).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        mapN = normalize(mapN);

        mat3 tbn = mat3(vTangent, vBitangent, vNormal);
        vec3 perturbedNormal = normalize(tbn * mapN);

        vec3 viewDir = normalize(vViewPosition);
        float facing = 1.0 - abs(dot(viewDir, perturbedNormal));

        vec3 rampColor;
        if (facing < midPos) {
            float t = facing / midPos;
            rampColor = mix(colorCenter, colorMid, t);
        } else {
            float t = (facing - midPos) / (1.0 - midPos);
            rampColor = mix(colorMid, colorEdge, t);
        }

        vec3 finalEmission = rampColor * emissionStrength;
        gl_FragColor = vec4(finalEmission, transparentOpacity);
    }
`;

// ─────────────────────────────────────────────
// DEFAULT PARAMS
// ─────────────────────────────────────────────

const DEFAULTS = {
    // Model paths (relative to wherever you call load() from)
    brainModel:     'Brain2.glb',
    neuronModel:    'Neuron2.glb',

    // Initial activation level (0 = dull/frozen, 1 = fully active)
    activation: 1.0,

    // Neuron active colors
    neuronColor1:   '#c41717',
    neuronColor2:   '#ffaa00',
    // Neuron dull color (used at activation = 0)
    neuronDullColor:'#3a3a3a',
    noiseScale:     2.310,
    noiseContrast:  10.0,
    neuronEmission: 3.5,

    // Brain active colors
    brainColorCenter: '#0a192a',
    brainColorMid:    '#245775',
    brainColorEdge:   '#46e9c0',
    // Brain dull color (used at activation = 0)
    brainDullColor:   '#2a2a2a',
    brainEmission:    1.3,
    brainOpacity:     0.15,
    brainMidPos:      0.5,

    // Initial pose — matches original file
    rotationY: -1,
    positionY: -0.3,
};

// ─────────────────────────────────────────────
// BRAINMESH CLASS
// ─────────────────────────────────────────────

export class BrainMesh {
    constructor() {
        /** Add this to your scene */
        this.group = new THREE.Group();
        this._activation = 1.0;
        this._elapsedTime = 0;
        this._params = null;
        this.neuronMaterial = null;
        this.brainMaterial = null;
    }

    /**
     * Async factory — loads both GLBs and returns a ready BrainMesh.
     *
     * @param {string} modelBasePath  Folder containing the .glb files, e.g. './models'
     * @param {object} params         Override any value from DEFAULTS above
     * @returns {Promise<BrainMesh>}
     */
    static async load(modelBasePath = '../models', params = {}) {
        const instance = new BrainMesh();
        await instance._init(modelBasePath, { ...DEFAULTS, ...params });
        return instance;
    }

    async _init(modelBasePath, params) {
        this._params = params;
        this._activation = params.activation;

        const dummyNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
        dummyNormal.needsUpdate = true;

        // Build neuron material
        this.neuronMaterial = new THREE.ShaderMaterial({
            vertexShader: neuronVertexShader,
            fragmentShader: neuronFragmentShader,
            uniforms: {
                color1:          { value: new THREE.Color(params.neuronColor1) },
                color2:          { value: new THREE.Color(params.neuronColor2) },
                dullColor:       { value: new THREE.Color(params.neuronDullColor) },
                activation:      { value: params.activation },
                noiseScale:      { value: params.noiseScale },
                noiseContrast:   { value: params.noiseContrast },
                emissionStrength:{ value: params.neuronEmission },
                time:            { value: 0.0 },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
        });

        // Brain color values — stored so setActivation can lerp between them
        this._brainActiveColors = {
            center: new THREE.Color(params.brainColorCenter),
            mid:    new THREE.Color(params.brainColorMid),
            edge:   new THREE.Color(params.brainColorEdge),
        };
        this._brainDullColor = new THREE.Color(params.brainDullColor);

        this.brainMaterial = new THREE.ShaderMaterial({
            vertexShader: brainVertexShader,
            fragmentShader: brainFragmentShader,
            uniforms: {
                tNormalMap:       { value: dummyNormal },
                normalScale:      { value: new THREE.Vector2(0.5, 0.5) },
                emissionStrength: { value: params.brainEmission },
                transparentOpacity:{ value: params.brainOpacity },
                colorCenter:      { value: new THREE.Color(params.brainColorCenter) },
                colorMid:         { value: new THREE.Color(params.brainColorMid) },
                colorEdge:        { value: new THREE.Color(params.brainColorEdge) },
                midPos:           { value: params.brainMidPos },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.FrontSide,
            depthFunc: THREE.LessEqualDepth,
            premultipliedAlpha: true,
            blending: THREE.NormalBlending,
        });

        this.depthMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#050f1a'),
            transparent: false,
            colorWrite: false,
            depthWrite: true,
        });

        const loader = new GLTFLoader();
        const loadGLB = (path) => new Promise((resolve, reject) => {
            loader.load(path, resolve, undefined, reject);
        });

        // Load both in parallel
        const [brainGLTF, neuronGLTF] = await Promise.all([
            loadGLB(`${modelBasePath}/${params.brainModel}`),
            loadGLB(`${modelBasePath}/${params.neuronModel}`),
        ]);

        // ── Brain ──
        const brain = brainGLTF.scene;
        brain.rotation.y = params.rotationY;
        brain.position.y = params.positionY;

        brain.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry.attributes.uv) child.geometry.computeTangents();
                const tex = child.material?.emissiveMap || child.material?.map || child.material?.normalMap;
                if (tex) {
                    tex.colorSpace = THREE.LinearSRGBColorSpace;
                    tex.needsUpdate = true;
                    this.brainMaterial.uniforms.tNormalMap.value = tex;
                }
            }
        });

        // Depth mask clone (hides the bg behind the brain)
        const depthMask = brain.clone();
        depthMask.traverse((child) => {
            if (child.isMesh) {
                child.material = this.depthMaterial;
                child.renderOrder = -1;
            }
        });

        brain.traverse((child) => {
            if (child.isMesh) {
                child.material = this.brainMaterial;
                child.renderOrder = 1;
            }
        });

        this.group.add(depthMask);
        this.group.add(brain);

        // ── Neurons ──
        const neurons = neuronGLTF.scene;
        neurons.rotation.y = params.rotationY;
        neurons.position.y = params.positionY;

        neurons.traverse((child) => {
            if (child.isMesh) {
                child.material = this.neuronMaterial;
                child.renderOrder = 0;
            }
        });
        this.group.add(neurons);

        // Apply initial activation
        this.setActivation(this._activation);
    }

    /**
     * Drive the brain state.
     * 0 = fully dull, gray, frozen neurons
     * 1 = fully active, colored, animated neurons
     */
    setActivation(value) {
        this._activation = THREE.MathUtils.clamp(value, 0, 1);
        const a = this._activation;

        // Neuron shader — activation uniform controls color blend in GLSL
        if (this.neuronMaterial) {
            this.neuronMaterial.uniforms.activation.value = a;
        }

        // Brain shader — lerp colors in JS
        // if (this.brainMaterial) {
        //     const u = this.brainMaterial.uniforms;
        //     u.colorCenter.value.lerpColors(this._brainDullColor, this._brainActiveColors.center, a);
        //     u.colorMid.value.lerpColors(   this._brainDullColor, this._brainActiveColors.mid,    a);
        //     u.colorEdge.value.lerpColors(  this._brainDullColor, this._brainActiveColors.edge,   a);
        // }
    }

    /**
     * Call once per frame inside your animation loop.
     * Time is pre-scaled by activation so neurons freeze at 0.
     */
    update(elapsedTime) {
        this._elapsedTime = elapsedTime;
        if (this.neuronMaterial) {
            this.neuronMaterial.uniforms.time.value = elapsedTime*0.7;
        }
    }

    /** Convenience getters if you want to tweak colors after load */
    setNeuronColors(color1, color2) {
        this.neuronMaterial.uniforms.color1.value.set(color1);
        this.neuronMaterial.uniforms.color2.value.set(color2);
    }

    setBrainColors(center, mid, edge) {
        this._brainActiveColors.center.set(center);
        this._brainActiveColors.mid.set(mid);
        this._brainActiveColors.edge.set(edge);
        this.setActivation(this._activation); // re-apply lerp
    }
}
