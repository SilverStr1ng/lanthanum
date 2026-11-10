import {
  Cartesian3,
  Color,
  Ellipsoid,
  Event,
  GeographicProjection,
  JulianDate,
  Matrix4,
} from "@cesium/core";
import Camera from "./Camera.js";
import SceneMode from "./SceneMode.js";
import Globe from "./Globe.js";
import Primitive from "./Primitive.js";
import PrimitiveCollection from "./PrimitiveCollection.js";
import CreditDisplay from "./CreditDisplay.js";
import QuadtreePrimitive from "./QuadtreePrimitive.js";
import WebGPUGlobeTileProvider from "./WebGPUGlobeTileProvider.js";
import WebGPUGeometryRenderer from "../Renderer/WebGPUGeometryRenderer.js";
import WebGPUModelCollection from "./WebGPUModelCollection.js";
import WebGPUModelResources from "./WebGPUModelResources.js";

const ownedGlobes = new WeakSet();

/** Experimental native 3D scene. Unsupported rendering features are explicitly rejected. */
class WebGPUScene {
  constructor(options, context) {
    if (options.requestRenderMode) {
      throw new Error(
        "Native requestRenderMode is not supported; call render in an animation loop.",
      );
    }
    if (
      options.mapProjection &&
      !Ellipsoid.WGS84.equals(options.mapProjection.ellipsoid)
    ) {
      throw new Error("The native basic profile supports WGS84 only.");
    }
    const maximumLevel = options.maximumTerrainLevel ?? 12;
    if (
      !Number.isInteger(maximumLevel) ||
      maximumLevel < 0 ||
      maximumLevel > 20
    ) {
      throw new Error(
        "maximumTerrainLevel must be an integer between 0 and 20.",
      );
    }
    this.canvas = options.canvas;
    this.context = context;
    this.isWebGPU = true;
    this.mapProjection = options.mapProjection ?? new GeographicProjection();
    this.backgroundColor = Color.clone(Color.BLACK);
    this.renderError = context.errorEvent;
    this.postRender = new Event();
    this._destroyed = false;
    this._renderer = new WebGPUGeometryRenderer(context);
    this._geometries = new Set();
    this._nextObjectId = 2;
    this._pickObjects = new Map();
    this._frameNumber = 0;
    this.maximumTerrainLevel = maximumLevel;
    this.verticalExaggeration = options.verticalExaggeration ?? 1;
    this.verticalExaggerationRelativeHeight =
      options.verticalExaggerationRelativeHeight ?? 0;
    this.imagerySplitPosition = 0.5;
    this._nativeOptions = options;
    this._afterRender = [];
    this.screenSpaceCameraController = {
      minimumZoomDistance: 1,
      maximumZoomDistance: 100000000,
    };
    this.camera = new Camera(this);
    this.camera.frustum.near = 0.1;
    this.camera.frustum.far = 500000000;
    this.primitives = new PrimitiveCollection();
    this.models = new WebGPUModelCollection(this);
    this._nativePrimitives = new Set();
    const creditContainer =
      options.creditContainer ?? document.createElement("div");
    if (!options.creditContainer) {
      creditContainer.style.cssText =
        "position:absolute;bottom:0;right:0;font:11px sans-serif;color:white;z-index:1";
      this.canvas.parentNode?.appendChild(creditContainer);
      this._creditContainer = creditContainer;
    }
    this.creditDisplay = new CreditDisplay(
      creditContainer,
      undefined,
      options.creditViewport,
    );
  }
  get drawingBufferWidth() {
    return this.canvas.width;
  }
  get drawingBufferHeight() {
    return this.canvas.height;
  }
  get pixelRatio() {
    return 1;
  }
  get ellipsoid() {
    return this.mapProjection.ellipsoid;
  }
  get mode() {
    return SceneMode.SCENE3D;
  }
  set mode(value) {
    if (value !== SceneMode.SCENE3D) {
      throw new Error("The native basic profile supports 3D only.");
    }
  }
  get requestRenderMode() {
    return false;
  }
  set requestRenderMode(value) {
    if (value) {
      throw new Error("Native requestRenderMode is not supported.");
    }
  }
  get resourceStatistics() {
    return this.context.statistics;
  }
  get globe() {
    return this._globe;
  }
  set globe(value) {
    this.context.assertReady();
    if (value === this._globe) {
      return;
    }
    if (value !== undefined && !(value instanceof Globe)) {
      throw new Error("A Cesium.Globe is required.");
    }
    if (
      value &&
      (ownedGlobes.has(value) ||
        value.isDestroyed() ||
        !Ellipsoid.WGS84.equals(value.ellipsoid))
    ) {
      throw new Error("Globe must be a live, unowned WGS84 globe.");
    }
    this._globe?.destroy();
    this._globe = value;
    if (value) {
      ownedGlobes.add(value);
      const baseColor = Color.clone(value.baseColor);
      value._surface.destroy();
      const provider = new WebGPUGlobeTileProvider(
        value,
        this.context,
        this._renderer,
        () => this.requestRender(),
        this.maximumTerrainLevel,
        this._nativeOptions,
      );
      provider.baseColor = baseColor;
      value._surface = new QuadtreePrimitive({ tileProvider: provider });
    }
    this.requestRender();
  }
  // Native basic scenes render continuously; retained for Camera/provider compatibility.
  requestRender() {}
  _getModelResources() {
    this.context.assertReady();
    return (this._modelResources ??= new WebGPUModelResources(this));
  }
  addGeometry({
    geometry,
    modelMatrix = Matrix4.IDENTITY,
    color = Color.WHITE,
    id,
  }) {
    this.context.assertReady();
    if (
      geometry?.primitiveType !== 4 ||
      !geometry.attributes?.position ||
      !geometry.indices
    ) {
      throw new Error(
        "Native basic profile requires indexed triangle geometry with positions.",
      );
    }
    if (color.alpha !== 1) {
      throw new Error(
        "Transparent geometry is not supported by the native basic profile.",
      );
    }
    if (this._nextObjectId > 0xffffffff) {
      throw new Error("Native object ID capacity exceeded.");
    }
    const positions = geometry.attributes.position.values;
    const uv = geometry.attributes.st?.values;
    if (
      positions.length === 0 ||
      positions.length % 3 !== 0 ||
      geometry.indices.length % 3 !== 0 ||
      !positions.every(Number.isFinite) ||
      !geometry.indices.every(
        (index) =>
          Number.isInteger(index) && index >= 0 && index < positions.length / 3,
      )
    ) {
      throw new Error("Invalid triangle positions or indices.");
    }
    const origin = Cartesian3.fromArray(positions);
    const vertices = new Float32Array((positions.length / 3) * 8);
    const normals = geometry.attributes.normal?.values;
    for (let i = 0; i < positions.length / 3; i++) {
      vertices.set(
        [
          positions[i * 3] - origin.x,
          positions[i * 3 + 1] - origin.y,
          positions[i * 3 + 2] - origin.z,
          uv?.[i * 2] ?? 0,
          uv?.[i * 2 + 1] ?? 0,
          normals?.[i * 3] ?? 0,
          normals?.[i * 3 + 1] ?? 0,
          normals?.[i * 3 + 2] ?? 1,
        ],
        i * 8,
      );
    }
    const mesh = this._renderer.createMesh(
      vertices,
      geometry.indices,
      Matrix4.clone(modelMatrix),
    );
    mesh.objectId = this._nextObjectId++;
    mesh.color = [color.red, color.green, color.blue, color.alpha];
    const handle = {
      kind: "geometry",
      id,
      show: true,
      modelMatrix: Matrix4.clone(modelMatrix),
      color: Color.clone(color),
      mesh,
      origin: Matrix4.fromTranslation(origin),
    };
    this._pickObjects.set(mesh.objectId, handle);
    this._geometries.add(handle);
    this.requestRender();
    return handle;
  }
  removeGeometry(handle) {
    if (!this._geometries.delete(handle)) {
      return false;
    }
    this._pickObjects.delete(handle.mesh.objectId);
    this._renderer.destroyMesh(handle.mesh);
    this.requestRender();
    return true;
  }
  initializeFrame() {
    this.context.assertReady();
  }
  render(time = JulianDate.now()) {
    this.context.assertReady();
    this.context.resize();
    this.camera.frustum.aspectRatio = this.canvas.width / this.canvas.height;
    this.camera.update(SceneMode.SCENE3D);
    const { near, far } = this.camera.frustum;
    if (
      !Number.isFinite(near) ||
      !Number.isFinite(far) ||
      near <= 0 ||
      far <= near
    ) {
      throw new Error("Native frustum requires finite 0 < near < far.");
    }
    this.creditDisplay.beginFrame();
    const frameState = (this.frameState = {
      webgpuScene: this,
      nativeCommands: [],
      creditDisplay: this.creditDisplay,
      context: this.context,
      camera: this.camera,
      mode: this.mode,
      time,
      mapProjection: this.mapProjection,
      frameNumber: ++this._frameNumber,
      pixelRatio: 1,
      verticalExaggeration: this.verticalExaggeration,
      verticalExaggerationRelativeHeight:
        this.verticalExaggerationRelativeHeight,
      imagerySplitPosition: this.imagerySplitPosition,
      fog: { enabled: false },
      passes: { render: true, pick: false },
      afterRender: this._afterRender,
      cullingVolume: this.camera.frustum.computeCullingVolume(
        this.camera.positionWC,
        this.camera.directionWC,
        this.camera.upWC,
      ),
    });
    const globe = this._globe;
    const surface = globe?._surface;
    if (globe?.show) {
      surface.maximumScreenSpaceError = globe.maximumScreenSpaceError;
      surface.tileCacheSize = globe.tileCacheSize;
      surface.update(frameState);
      surface.beginFrame(frameState);
      surface.render(frameState);
      surface.endFrame(frameState);
      surface.tileProvider.finishFrame(frameState);
    }
    visitPrimitives(this.primitives);
    this.primitives.update(frameState);
    frameState.nativeCommands.sort(
      (a, b) =>
        Number(a.mesh.blend) - Number(b.mesh.blend) ||
        (a.mesh.blend ? b.distance - a.distance : a.distance - b.distance),
    );
    this.context.render(this.backgroundColor, (pass) => {
      let modelsDrawn = false;
      if (globe?.show) {
        surface.tileProvider.draw(pass, this.camera);
      }
      for (const handle of this._geometries) {
        if (!handle.show) {
          continue;
        }
        if (handle.color.alpha !== 1) {
          throw new Error(
            "Transparent geometry is not supported by the native basic profile.",
          );
        }
        Matrix4.multiply(
          handle.modelMatrix,
          handle.origin,
          handle.mesh.modelMatrix,
        );
        const color = handle.color;
        handle.mesh.color = [color.red, color.green, color.blue, 1];
        this._renderer.draw(pass, handle.mesh, this.camera);
      }
      for (const record of frameState.nativeCommands) {
        // Opaque models share the attachment before any translucent Primitive.
        if (!modelsDrawn && record.mesh.blend) {
          this.models.draw(pass, this.camera);
          modelsDrawn = true;
        }
        this._renderer.draw(pass, record.mesh, this.camera);
      }
      if (!modelsDrawn) {
        this.models.draw(pass, this.camera);
      }
    });
    for (const callback of this._afterRender.splice(0)) {
      callback();
    }
    this.creditDisplay.endFrame();
    this.creditDisplay.update();
    this.postRender.raiseEvent(this);
  }
  get statistics() {
    const provider = this._globe?._surface.tileProvider;
    return {
      frames: this._frameNumber,
      selectedTiles: provider?._selected.length ?? 0,
      maximumSelectedLevel: Math.max(
        -1,
        ...(provider?._selected.map((tile) => tile.level) ?? []),
      ),
      pendingTiles: provider?._pending ?? 0,
      terrainWork: provider?.workStatistics,
      modelWork: this._modelResources?.statistics,
      imageryTextures: provider?.imagery.textureCount ?? 0,
      imageryBytes: provider?.imagery.bytes ?? 0,
      tileErrors: provider?.errors ?? [],
      resources: this.resourceStatistics,
      errors: [...this.context.errors],
    };
  }
  captureAsync() {
    return this.context.captureAsync();
  }
  async pickAsync(position, options = {}) {
    this.context.assertReady();
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
      throw new Error("Pick position must be finite.");
    }
    if (options.signal?.aborted) {
      throw new DOMException("Pick cancelled", "AbortError");
    }
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (
      position.x < 0 ||
      position.y < 0 ||
      position.x >= width ||
      position.y >= height
    ) {
      return undefined;
    }
    this.render();
    const globe = this._globe;
    const snapshot = new Map(
      [...this._pickObjects].map(([key, value]) => [
        key,
        value.kind === "model"
          ? { ...value, epoch: value.model._visibilityEpoch }
          : value,
      ]),
    );
    const id = await this.context.readPickAsync(
      Math.floor((position.x * this.canvas.width) / width),
      Math.floor((position.y * this.canvas.height) / height),
    );
    if (this._destroyed || options.signal?.aborted) {
      throw new DOMException("Pick cancelled", "AbortError");
    }
    if (id === 0) {
      return undefined;
    }
    if (id === 1) {
      return this._globe === globe && globe?.show
        ? { primitive: globe, id: "globe" }
        : undefined;
    }
    const handle = snapshot.get(id);
    if (handle?.kind === "model") {
      const model = handle.model;
      return model.ready &&
        model.show &&
        model._visibilityEpoch === handle.epoch &&
        this.models.contains(model)
        ? { primitive: model, id: model.id }
        : undefined;
    }
    if (handle?.kind === "primitive") {
      const primitive = handle.adapter.primitive;
      return !handle.adapter.destroyed &&
        primitive.show &&
        handle.attributes.show?.[0] !== 0 &&
        handle.mesh.color[3] > 0 &&
        visitPrimitives(this.primitives, primitive)
        ? { primitive, id: handle.id }
        : undefined;
    }
    return handle?.show && this._geometries.has(handle)
      ? { primitive: handle, id: handle.id }
      : undefined;
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._modelResources?.destroy();
    this._globe?.destroy();
    this.primitives.destroy();
    for (const adapter of this._nativePrimitives) {
      adapter.destroy();
      adapter.primitive._webgpu = undefined;
      adapter.primitive._ready = false;
    }
    this._geometryTaskProcessor?.destroy();
    this.creditDisplay.destroy();
    this._creditContainer?.remove();
    for (const handle of this._geometries) {
      this._renderer.destroyMesh(handle.mesh);
    }
    this._geometries.clear();
    this._pickObjects.clear();
    this._renderer.destroy();
    this.context.destroy();
  }
}
function visitPrimitives(collection, target) {
  if (!collection.show) {
    return false;
  }
  let found = false;
  for (let i = 0; i < collection.length; i++) {
    const primitive = collection.get(i);
    if (primitive instanceof PrimitiveCollection) {
      found = visitPrimitives(primitive, target) || found;
    } else if (!(primitive instanceof Primitive)) {
      throw new Error(
        "Native scene.primitives supports Primitive and PrimitiveCollection only.",
      );
    } else if (primitive === target) {
      found = true;
    }
  }
  return found;
}
export default WebGPUScene;
