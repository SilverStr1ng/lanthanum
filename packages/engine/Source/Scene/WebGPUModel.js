import { Matrix4, BoundingSphere } from "@cesium/core";
import {
  affineHandedness,
  transformModelBounds,
} from "../Renderer/WebGPUTransforms.js";

/**
 * Experimental static unlit glTF/GLB model belonging to one native WebGPU scene.
 * @private
 */
class WebGPUModel {
  constructor(options) {
    const scene = options.scene;
    if (!scene?.isWebGPU || scene.isDestroyed()) {
      throw new Error("WebGPUModel requires a live native scene");
    }
    scene.context.assertReady();
    this._scene = scene;
    this._resources = scene._getModelResources();
    this._generation = this._resources.generation;
    this._controller = new AbortController();
    this._leases = [];
    this._packets = [];
    this._state = "loading";
    this._startedAt = performance.now();
    this.loadStatistics = {};
    this._destroyed = false;
    this._show = true;
    this._visibilityEpoch = 0;
    this.url = new URL(
      options.url,
      globalThis.document?.baseURI ?? globalThis.location?.href,
    ).href;
    this.sceneIndex = options.sceneIndex;
    this.id = options.id;
    this.modelMatrix = Matrix4.clone(options.modelMatrix ?? Matrix4.IDENTITY);
    affineHandedness(this.modelMatrix);
    if (scene._nextObjectId > 0xffffffff) {
      throw new Error("Native object ID capacity exceeded");
    }
    this._objectId = scene._nextObjectId++;
    this._resources.instances.add(this);
  }
  /**
   * Resolves when CPU data, uploads and pipelines are ready, without requiring render().
   * Does not add the returned instance to scene.models.
   * @param {object} options Model options.
   * @param {string} options.url glTF or GLB URL.
   * @param {object} options.scene Owning native scene.
   * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] Geographic placement (glTF Y-up is converted to Z-up).
   * @param {*} [options.id] Application identifier returned by pickAsync.
   * @param {number} [options.sceneIndex] glTF scene index; defaults to the asset's scene.
   * @param {AbortSignal} [options.signal] Cancels this load only.
   * @returns {Promise<WebGPUModel>} A drawable, unregistered model.
   */
  static async fromGltfAsync(options) {
    if (options.signal?.aborted) {
      throw new DOMException("Model load cancelled", "AbortError");
    }
    const model = new WebGPUModel(options),
      abort = () => model.destroy();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      await model._resources.prepare(model);
      model._assertLive();
      return model;
    } catch (error) {
      model.destroy();
      if (error.name === "AbortError") {
        throw error;
      }
      throw new Error(`${model.url}: ${error.message}`, { cause: error });
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
  get ready() {
    return this._state === "drawable" && !this._destroyed;
  }
  get show() {
    return this._show;
  }
  set show(value) {
    if (!value && this._show) {
      this._visibilityEpoch++;
    }
    this._show = !!value;
  }
  get boundingSphere() {
    this._assertLive();
    let result;
    for (const packet of this._packets) {
      const transform = Matrix4.multiply(
          this.modelMatrix,
          packet.nodeTransform,
          new Matrix4(),
        ),
        sphere = transformModelBounds(
          packet.bounds,
          transform,
          new BoundingSphere(),
        );
      result = result ? BoundingSphere.union(result, sphere, result) : sphere;
    }
    return result;
  }
  _assertLive() {
    if (
      this._destroyed ||
      this._resources.destroyed ||
      this._generation !== this._resources.generation ||
      this._controller.signal.aborted
    ) {
      throw new DOMException(`${this.url}: model invalidated`, "AbortError");
    }
    this._scene.context.assertReady();
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._state = "destroyed";
    this._visibilityEpoch++;
    this._controller.abort();
    this._scene._pickObjects.delete(this._objectId);
    this._scene.models._items.delete(this);
    for (const packet of this._packets) {
      this._resources.renderer.destroyPacket(packet);
    }
    this._packets.length = 0;
    for (const lease of this._leases) {
      lease.release();
    }
    this._leases.length = 0;
    this._descriptor = undefined;
    this._resources.instances.delete(this);
  }
}
export default WebGPUModel;
