import * as THREE from 'three';
import { SceneBase } from './SceneBase.js';
import { BrainMesh } from './BrainMesh.js';

// ─────────────────────────────────────────────
// DEFAULT PARAMS
// ─────────────────────────────────────────────
const DEFAULTS = {
    modelBasePath: 'https://cdn.jsdelivr.net/gh/AaryanTRahman/cpc-clinics-rtms@main/models',
    useWindowSize: false, 

    // Camera
    fov:      20,
    position: [0, 0, 10],
    lookAt:   [0, 0, 0],

    // Vertical gap between the two brain centres (world units)
    brainSpacing: 2.8,

    // Inactive (top) brain overrides
    inactiveBrain: {
        rotationY:       -1,
        positionY:        0,
        neuronDullColor: '#535353',
        activation:       0,
    },

    // Active (bottom) brain overrides — inherits BrainMesh defaults for colors
    activeBrain: {
        rotationY:  -1,
        positionY:   0,
        activation:  1,
    },

    // Bloom — subtle, no background flair
    bloom: {
        strength:  0.25,
        radius:    0.5,
        threshold: 0.2,
    },

    // Vignette
    vignette: {
        radius:     1.3,
        smoothness: 0.7,
    },
};

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

/**
 * @param {HTMLCanvasElement|null} canvas
 * @param {object} params  Override any key from DEFAULTS above.
 * @returns {Promise<{ sceneBase, brainTop, brainBottom, dispose }>}
 */
export async function initComparisonScene(canvas = null, params = {}) {
    const cfg = { ...DEFAULTS, ...params };

    // ── SceneBase (no fog for clean comparison look) ──
    const sceneBase = new SceneBase(canvas, {
        fov:      cfg.fov,
        position: cfg.position,
        lookAt:   cfg.lookAt,
        fog:      null,
        bloom:    cfg.bloom,
        vignette: cfg.vignette,
        useWindowSize: cfg.useWindowSize 
    });

    const { scene } = sceneBase;

    const half = cfg.brainSpacing / 2;

    // ── Load both brains in parallel ──
    const [brainTop, brainBottom] = await Promise.all([
        BrainMesh.load(cfg.modelBasePath, {
            ...cfg.inactiveBrain,
            positionY: cfg.inactiveBrain.positionY + half -1.2,   // upper half
        }),
        BrainMesh.load(cfg.modelBasePath, {
            ...cfg.activeBrain,
            positionY: cfg.activeBrain.positionY - half,     // lower half
        }),
    ]);

    scene.add(brainTop.group);
    scene.add(brainBottom.group);

    // ── Animation loop — only bottom brain animates ──
    sceneBase.startLoop((elapsed) => {
        brainTop.update(elapsed);      // time runs but activation=0 keeps colors dull
        brainBottom.update(elapsed);   // fully active
    });

    return {
        sceneBase,
        brainTop,
        brainBottom,
        dispose: () => sceneBase.dispose(),
    };
}
