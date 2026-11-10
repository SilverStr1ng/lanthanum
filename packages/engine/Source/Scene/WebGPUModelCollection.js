import WebGPUModel from "./WebGPUModel.js";
import { affineDeterminant } from "../Renderer/WebGPUTransforms.js";

/** Scene-owned model membership. Removal always destroys the instance. @private */
class WebGPUModelCollection {
  constructor(scene) {
    this._scene = scene;
    this._items = new Set();
  }
  get length() {
    return this._items.size;
  }
  contains(model) {
    return this._items.has(model);
  }
  get(index) {
    return [...this._items][index];
  }
  add(model) {
    this._scene.context.assertReady();
    if (
      !(model instanceof WebGPUModel) ||
      model._scene !== this._scene ||
      !model.ready ||
      this.contains(model)
    ) {
      throw new Error(
        "Model must be drawable, unregistered and owned by this scene",
      );
    }
    this._items.add(model);
    this._scene._pickObjects.set(model._objectId, { kind: "model", model });
    return model;
  }
  remove(model) {
    if (!this._items.has(model)) {
      return false;
    }
    model.destroy();
    return true;
  }
  removeAll() {
    for (const model of [...this._items]) {
      model.destroy();
    }
  }
  draw(pass, camera) {
    for (const model of this._items) {
      if (!model.show || !model.ready) {
        continue;
      }
      affineDeterminant(model.modelMatrix);
      for (const packet of model._packets) {
        model._resources.renderer.draw(pass, packet, camera, model.modelMatrix);
      }
    }
  }
}
export default WebGPUModelCollection;
