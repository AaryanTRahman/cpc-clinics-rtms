import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';

// ─────────────────────────────────────────────
// VIGNETTE + ALPHA FEATHERING SHADER
// This gives the scene soft transparent edges so it
// composites cleanly over the page without a hard rectangle.
// ─────────────────────────────────────────────
const VignetteAlphaShader = {
    uniforms: {
        tDiffuse:   { value: null },
        /** How far from center the solid region extends (>1 = no vignette) */
        radius:     { value: 1.2 },
        /** How soft the fade-out edge is */
        smoothness: { value: 0.8 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float radius;
        uniform float smoothness;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);

            vec2 pos = (vUv - 0.5) * 2.0;
            float dist = length(pos);
            float vignette = smoothstep(radius, radius - smoothness, dist);

            // Derive alpha from brightness so pitch-black areas stay transparent.
            // This kills bloom/fog halos around the scene edges.
            float brightness = max(texel.r, max(texel.g, texel.b));
            float alpha = smoothstep(0.02, 0.1, brightness) * brightness;

            gl_FragColor = vec4(texel.rgb * vignette, max(alpha, brightness) * vignette);
        }
    `,
};

// ─────────────────────────────────────────────
// DEFAULT PARAMS
// ─────────────────────────────────────────────
const DEFAULTS = {
    // Camera
    fov:      30,
    position: [0, 0, 6],
    lookAt:   [0, 0, 0],

    // Renderer
    alpha:               true,   // transparent canvas — essential for overlay on page
    antialias:           true,
    toneMapping:         THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.0,
    pixelRatioCap:       2,      // cap devicePixelRatio to avoid GPU overload

    // Fog (set color:null to disable)
    fog: { color: '#000000', density: 0.1 },

    // Bloom
    bloom: {
        strength:  0.3,
        radius:    0.6,
        threshold: 0.2,
    },

    // Vignette / edge feathering
    vignette: {
        radius:     1.2,
        smoothness: 0.8,
    },

    useWindowSize: true, // <--- ADD THIS LINE

};

// ─────────────────────────────────────────────
// SCENEBASE CLASS
// ─────────────────────────────────────────────

export class SceneBase {
    /**
     * @param {HTMLCanvasElement|null} canvas
     *   Pass a <canvas> element to render into it, or null to auto-create
     *   one and append it to document.body.
     * @param {object} params  Override any value from DEFAULTS above.
     */
    constructor(canvas = null, params = {}) {
        const cfg = this._cfg = { ...DEFAULTS, ...params };
        
        // Save sizing preferences
        this._useWindowSize = cfg.useWindowSize;
        this._container = canvas ? canvas.parentElement : document.body;

        // ── Scene ──
        this.scene = new THREE.Scene();
        if (cfg.fog) {
            this.scene.fog = new THREE.FogExp2(cfg.fog.color, cfg.fog.density);
        }

        // ── Get Initial Dimensions ──
        const { w, h } = this._getSize();

        // ── Camera ──
        this.camera = new THREE.PerspectiveCamera(cfg.fov, w / h, 0.1, 1000);
        this.camera.position.set(...cfg.position);
        this.camera.lookAt(...cfg.lookAt);

        // ── Renderer ──
        const rendererOpts = { antialias: cfg.antialias, alpha: cfg.alpha };
        if (canvas) rendererOpts.canvas = canvas;

        this.renderer = new THREE.WebGLRenderer(rendererOpts);
        
        // KEY FIX: If using a container, prevent ThreeJS from injecting hardcoded inline styles
        this.renderer.setSize(w, h, this._useWindowSize); 
        
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.pixelRatioCap));
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.toneMapping = cfg.toneMapping;
        this.renderer.toneMappingExposure = cfg.toneMappingExposure;

        if (!canvas) {
            document.body.appendChild(this.renderer.domElement);
        }

        // ── Post-processing ──
        const renderTarget = new THREE.WebGLRenderTarget(w, h, {
            samples: 4,
            type: THREE.HalfFloatType,
        });

        this.composer = new EffectComposer(this.renderer, renderTarget);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloom = cfg.bloom;
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), bloom.strength, bloom.radius, bloom.threshold);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(new OutputPass());

        // Vignette
        this.vignettePass = new ShaderPass(VignetteAlphaShader);
        this.vignettePass.uniforms.radius.value = cfg.vignette.radius;
        this.vignettePass.uniforms.smoothness.value = cfg.vignette.smoothness;
        this.composer.addPass(this.vignettePass);

        // ── Resize ──
        this._boundResize = this._onResize.bind(this);
        window.addEventListener('resize', this._boundResize);

        // ── Loop state ──
        this._rafId = null;
        this._clock = new THREE.Clock();
    }

    // ─── Public helpers ───────────────────────

    /** Add any Object3D to the scene */
    add(object) {
        this.scene.add(object);
        return this;
    }

    /** Start the render loop. updateFn(elapsedTime, deltaTime) is called each frame. */
    startLoop(updateFn = () => {}) {
        this._clock.start();
        const tick = () => {
            this._rafId = requestAnimationFrame(tick);
            const elapsed = this._clock.getElapsedTime();
            const delta   = this._clock.getDelta();
            updateFn(elapsed, delta);
            this.composer.render();
        };
        tick();
    }

    /** Stop the render loop */
    stopLoop() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /** Clean up everything */
    dispose() {
        this.stopLoop();
        window.removeEventListener('resize', this._boundResize);
        this.renderer.dispose();
        this.composer.dispose();
    }

    // ─── Camera helpers ───────────────────────

    setCamera({ fov, position, lookAt } = {}) {
        if (fov      !== undefined) { this.camera.fov = fov; }
        if (position !== undefined) { this.camera.position.set(...position); }
        if (lookAt   !== undefined) { this.camera.lookAt(...lookAt); }
        this.camera.updateProjectionMatrix();
    }

    // ─── Bloom helpers ────────────────────────

    setBloom({ strength, radius, threshold } = {}) {
        if (strength  !== undefined) this.bloomPass.strength  = strength;
        if (radius    !== undefined) this.bloomPass.radius    = radius;
        if (threshold !== undefined) this.bloomPass.threshold = threshold;
    }

    // ─── Vignette helpers ─────────────────────

    setVignette({ radius, smoothness } = {}) {
        if (radius     !== undefined) this.vignettePass.uniforms.radius.value     = radius;
        if (smoothness !== undefined) this.vignettePass.uniforms.smoothness.value = smoothness;
    }

    // ─── Fog helpers ──────────────────────────

    setFog({ color, density } = {}) {
        if (this.scene.fog) {
            if (color   !== undefined) this.scene.fog.color.set(color);
            if (density !== undefined) this.scene.fog.density = density;
        }
    }

    // ─── Internal ─────────────────────────────

    // ─── NEW HELPER METHOD ────────────────────
    _getSize() {
        if (this._useWindowSize) {
            return { w: window.innerWidth, h: window.innerHeight };
        } else {
            // Respect the CSS boundaries, fallback to client sizes, 
            // and fallback to exact pixels as a last resort so it NEVER blows up.
            const rect = this._container ? this._container.getBoundingClientRect() : { width: 0, height: 0 };
            return { 
                w: rect.width || (this._container ? this._container.clientWidth : 320) || 320, 
                h: rect.height || (this._container ? this._container.clientHeight : 620) || 620
            }; 
        }
    }

    _onResize() {
        const { w, h } = this._getSize();
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, this._useWindowSize);
        this.composer.setSize(w, h);
        if (typeof this.onResize === 'function') this.onResize(w, h);
    }
}
