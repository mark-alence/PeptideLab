// ============================================================
// postProcessing.js — Post-processing pipeline for PDB viewer
// RenderPass → SSAOPass → UnrealBloomPass → OutputPass.
// Quality toggle: Off / Low / High.
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ── Quality Presets ──────────────────────────────────────────

const QUALITY_PRESETS = {
  low: {
    ssao:  { kernelRadius: 12, minDistance: 0.005, maxDistance: 0.12 },
    bloom: { strength: 0.15, radius: 0.4, threshold: 0.7 },
  },
  high: {
    ssao:  { kernelRadius: 20, minDistance: 0.003, maxDistance: 0.15 },
    bloom: { strength: 0.25, radius: 0.6, threshold: 0.6 },
  },
};

// ── PostProcessingPipeline ───────────────────────────────────

export class PostProcessingPipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.ssaoPass = null;
    this.bloomPass = null;
    this.quality = 'off';
  }

  /**
   * Build (or rebuild) the pipeline for a given quality level.
   *
   * @param {'off'|'low'|'high'} quality
   */
  build(quality) {
    this.dispose();
    this.quality = quality;

    if (quality === 'off') return;

    const preset = QUALITY_PRESETS[quality];
    if (!preset) return;

    const size = this.renderer.getSize(new THREE.Vector2());
    const w = size.x;
    const h = size.y;

    // HDR render target for bloom / tone mapping
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.composer = new EffectComposer(this.renderer, rt);

    // 1. Render pass
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 2. SSAO — depth / ambient shadow on spheres
    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
    this.ssaoPass.kernelRadius = preset.ssao.kernelRadius;
    this.ssaoPass.minDistance = preset.ssao.minDistance;
    this.ssaoPass.maxDistance = preset.ssao.maxDistance;
    this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    this.composer.addPass(this.ssaoPass);

    // 3. Bloom — subtle glow on bright atoms
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      preset.bloom.strength,
      preset.bloom.radius,
      preset.bloom.threshold
    );
    this.composer.addPass(this.bloomPass);

    // 4. Output pass — tone mapping + color space
    this.composer.addPass(new OutputPass());
  }

  /**
   * Render one frame (delegates to composer or direct renderer).
   */
  render() {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Resize all internal render targets.
   */
  setSize(width, height) {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  /**
   * Dispose the entire pipeline and free GPU resources.
   */
  dispose() {
    if (this.composer) {
      // Dispose composer render targets
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();

      // Dispose SSAO internal buffers
      if (this.ssaoPass) {
        this.ssaoPass.dispose();
      }

      this.composer = null;
      this.ssaoPass = null;
      this.bloomPass = null;
    }
    this.quality = 'off';
  }
}
