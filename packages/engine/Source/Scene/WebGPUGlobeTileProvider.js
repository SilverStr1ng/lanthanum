import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  Ellipsoid,
  Event,
  Intersect,
  IntersectionTests,
  Matrix4,
  Ray,
  Rectangle,
  Visibility,
} from "@cesium/core";
import GeographicTilingScheme from "../Core/GeographicTilingScheme.js";
import RequestScheduler from "../Core/RequestScheduler.js";
import EllipsoidTerrainProvider from "../Core/EllipsoidTerrainProvider.js";
import UrlTemplateImageryProvider from "./UrlTemplateImageryProvider.js";
import QuadtreeTileLoadState from "./QuadtreeTileLoadState.js";
import TileBoundingRegion from "./TileBoundingRegion.js";

class NativeTileData {
  constructor(provider, tile) {
    this.provider = provider;
    this.tile = tile;
    this.cancelled = false;
    this.started = false;
    this.eligibleForUnloading = true;
    this.tileBoundingRegion = new TileBoundingRegion({
      rectangle: tile.rectangle,
      ellipsoid: provider.tilingScheme.ellipsoid,
    });
    this.pickBoundingSphere = BoundingSphere.clone(
      this.tileBoundingRegion.boundingSphere,
    );
  }
  freeResources() {
    this.cancelled = true;
    this.provider.renderer.destroyMesh(this.gpuMesh);
    this.provider.context.release(this.texture);
    this.gpuMesh = undefined;
    this.texture = undefined;
    this.mesh = undefined;
    this.renderedMesh = undefined;
    this.vertexArray = undefined;
  }
  pick(ray, mode, projection, cullBackFaces, result) {
    if (!this.mesh) {
      return undefined;
    }
    const { vertices, indices, encoding } = this.mesh;
    const a = new Cartesian3(),
      b = new Cartesian3(),
      c = new Cartesian3();
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < indices.length; i += 3) {
      encoding.decodePosition(vertices, indices[i], a);
      encoding.decodePosition(vertices, indices[i + 1], b);
      encoding.decodePosition(vertices, indices[i + 2], c);
      const distance = IntersectionTests.rayTriangleParametric(
        ray,
        a,
        b,
        c,
        cullBackFaces,
      );
      if (distance !== undefined && distance >= 0 && distance < closest) {
        closest = distance;
      }
    }
    return Number.isFinite(closest)
      ? Ray.getPoint(ray, closest, result)
      : undefined;
  }
}

/** Native resources behind Cesium's existing QuadtreePrimitive selection and eviction. */
class WebGPUGlobeTileProvider {
  constructor(globe, context, renderer, requestRender, maximumLevel = 12) {
    this.globe = globe;
    this.context = context;
    this.renderer = renderer;
    this.requestRender = requestRender;
    this.maximumLevel = maximumLevel;
    this.terrainProvider = globe.terrainProvider;
    this.tilingScheme = this.terrainProvider.tilingScheme;
    this.errorEvent = context.errorEvent;
    this.imageryLayersUpdatedEvent = new Event();
    this.baseColor = Color.clone(Color.DARKBLUE);
    this._pending = 0;
    this._destroyed = false;
    this._selected = [];
    this._layersChanged = true;
    const layers = globe.imageryLayers;
    this._removeListeners = [
      layers.layerAdded,
      layers.layerRemoved,
      layers.layerMoved,
      layers.layerShownOrHidden,
    ].map((event) =>
      event.addEventListener(() => {
        this._layersChanged = true;
        requestRender();
      }),
    );
  }
  initialize() {
    RequestScheduler.update();
  }
  update() {
    if (
      this.globe.material ||
      this.globe.enableLighting ||
      this.globe.clippingPlanes ||
      this.globe.clippingPolygons ||
      this.globe.translucency.enabled
    ) {
      throw new Error(
        "Native globe materials, lighting, clipping and translucency are not supported.",
      );
    }
    const layers = this.globe.imageryLayers;
    layers._update();
    const active = [];
    for (let i = 0; i < layers.length; i++) {
      if (layers.get(i).show) {
        active.push(layers.get(i));
      }
    }
    if (active.length > 1) {
      throw new Error(
        "The native basic profile supports one visible imagery layer.",
      );
    }
    const layer = active[0];
    if (!(this.globe.terrainProvider instanceof EllipsoidTerrainProvider)) {
      throw new Error(
        "The native basic profile currently supports EllipsoidTerrainProvider only.",
      );
    }
    const terrainScheme = this.globe.terrainProvider.tilingScheme;
    if (
      !(terrainScheme instanceof GeographicTilingScheme) ||
      !Ellipsoid.WGS84.equals(terrainScheme.ellipsoid) ||
      !Rectangle.equals(terrainScheme.rectangle, Rectangle.MAX_VALUE) ||
      terrainScheme.getNumberOfXTilesAtLevel(0) !== 2 ||
      terrainScheme.getNumberOfYTilesAtLevel(0) !== 1
    ) {
      throw new Error(
        "Native terrain requires WGS84 geographic tiling with full-world 2x1 roots.",
      );
    }
    if (layer) {
      const imagery = layer.imageryProvider;
      const scheme = imagery?.tilingScheme;
      if (
        !(imagery instanceof UrlTemplateImageryProvider) ||
        !(scheme instanceof GeographicTilingScheme) ||
        !Ellipsoid.WGS84.equals(scheme.ellipsoid) ||
        scheme.getNumberOfXTilesAtLevel(0) !== 2 ||
        scheme.getNumberOfYTilesAtLevel(0) !== 1 ||
        !Rectangle.equals(imagery.rectangle, Rectangle.MAX_VALUE) ||
        !Rectangle.equals(layer.rectangle, Rectangle.MAX_VALUE) ||
        (imagery.minimumLevel ?? 0) !== 0 ||
        imagery.tileDiscardPolicy
      ) {
        throw new Error(
          "Native imagery requires a full-world UrlTemplateImageryProvider, geographic 2x1 roots, minimumLevel 0 and no discard policy.",
        );
      }
      for (const [name, expected] of Object.entries({
        alpha: 1,
        brightness: 1,
        contrast: 1,
        hue: 0,
        saturation: 1,
        gamma: 1,
        splitDirection: 0,
      })) {
        if (layer[name] !== expected) {
          throw new Error(
            `Native imagery does not support non-default ${name}.`,
          );
        }
      }
      if (layer.cutoutRectangle || layer.colorToAlpha) {
        throw new Error(
          "Native imagery does not support cutouts or colorToAlpha.",
        );
      }
    }
    if (
      this._layersChanged ||
      this.terrainProvider !== this.globe.terrainProvider
    ) {
      this._layersChanged = false;
      this.layer = layer;
      this.terrainProvider = this.globe.terrainProvider;
      if (this.tilingScheme !== this.terrainProvider.tilingScheme) {
        this.tilingScheme = this.terrainProvider.tilingScheme;
      }
      this.quadtree.invalidateAllTiles();
      this.imageryLayersUpdatedEvent.raiseEvent();
    }
  }
  beginUpdate() {
    this._selected.length = 0;
  }
  endUpdate() {}
  getLevelMaximumGeometricError(level) {
    return this.terrainProvider.getLevelMaximumGeometricError(level);
  }
  canRefine(tile) {
    if (tile.level >= this.maximumLevel) {
      return false;
    }
    for (const child of tile.children) {
      if (
        this.terrainProvider.getTileDataAvailable(
          child.x,
          child.y,
          child.level,
        ) === false
      ) {
        return false;
      }
    }
    return true;
  }
  computeTileVisibility(tile, frameState) {
    if (!tile.data || tile.data.cancelled) {
      tile.data = new NativeTileData(this, tile);
    }
    tile._distance = Math.max(
      1,
      tile.data.tileBoundingRegion.distanceToCamera(frameState),
    );
    return frameState.cullingVolume.computeVisibility(
      tile.data.tileBoundingRegion.boundingVolume,
    ) === Intersect.OUTSIDE
      ? Visibility.NONE
      : Visibility.FULL;
  }
  showTileThisFrame(tile) {
    if (tile.data?.gpuMesh) {
      this._selected.push(tile);
    }
  }
  loadTile(frameState, tile) {
    if (!tile.data || tile.data.cancelled) {
      tile.data = new NativeTileData(this, tile);
    }
    const data = tile.data;
    if (data.started || this._pending >= 8 || this._destroyed) {
      return;
    }
    let promise;
    try {
      promise = this.terrainProvider.requestTileGeometry(
        tile.x,
        tile.y,
        tile.level,
      );
    } catch (error) {
      this.fail(tile, error);
      return;
    }
    if (!promise) {
      return;
    }
    data.started = true;
    data.eligibleForUnloading = false;
    tile.state = QuadtreeTileLoadState.LOADING;
    this._pending++;
    this.load(data, promise)
      .catch((error) => {
        if (!data.cancelled && !this._destroyed) {
          this.fail(tile, error);
        }
      })
      .finally(() => {
        this._pending--;
        data.eligibleForUnloading = true;
        this.requestRender();
      });
  }
  fail(tile, error) {
    tile.data?.freeResources();
    tile.state = QuadtreeTileLoadState.FAILED;
    this.context.errors.push(
      `Tile ${tile.level}/${tile.x}/${tile.y}: ${error.message}`,
    );
    this.errorEvent.raiseEvent(error);
  }
  async load(data, terrainPromise) {
    const tile = data.tile;
    const terrain = await terrainPromise;
    if (data.cancelled || this._destroyed) {
      return;
    }
    const mesh = await terrain.createMesh({
      tilingScheme: this.tilingScheme,
      x: tile.x,
      y: tile.y,
      level: tile.level,
      throttle: false,
    });
    if (!mesh) {
      throw new Error("Terrain provider did not produce a mesh.");
    }
    if (data.cancelled || this._destroyed) {
      return;
    }
    data.terrainData = terrain;
    data.mesh = data.renderedMesh = mesh;
    data.tileBoundingRegion = new TileBoundingRegion({
      rectangle: tile.rectangle,
      ellipsoid: this.tilingScheme.ellipsoid,
      minimumHeight: mesh.minimumHeight,
      maximumHeight: mesh.maximumHeight,
    });
    const layer = this.layer;
    const uv = [0, 0, 1, 1];
    if (layer) {
      const provider = layer.imageryProvider;
      const level = Math.min(tile.level, provider.maximumLevel ?? tile.level);
      const factor = 2 ** (tile.level - level),
        x = Math.floor(tile.x / factor),
        y = Math.floor(tile.y / factor);
      let request;
      // Undefined means request throttling, not a successful image.
      while (!request && !data.cancelled && !this._destroyed) {
        request = provider.requestImage(x, y, level);
        if (!request) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      if (data.cancelled || this._destroyed) {
        return;
      }
      const image = await request;
      if (data.cancelled || this._destroyed) {
        image?.close?.();
        return;
      }
      data.texture = this.context.createTexture({
        label: `imagery ${level}/${x}/${y}`,
        size: [image.width, image.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // ImageryProvider.loadImage requests flipY for ImageBitmap. Normalize to
      // top-left pixels here so the WGSL uses the same UV convention for HTML images.
      this.context.device.queue.copyExternalImageToTexture(
        { source: image, flipY: image instanceof ImageBitmap },
        { texture: data.texture },
        [image.width, image.height],
      );
      image.close?.();
      uv[0] = (tile.x % factor) / factor;
      uv[1] = 1 - ((tile.y % factor) + 1) / factor;
      uv[2] = uv[3] = 1 / factor;
    }
    const encoding = mesh.encoding;
    const count = mesh.vertices.length / encoding.stride;
    const vertices = new Float32Array(count * 5);
    const point = new Cartesian3(),
      textureCoordinates = new Cartesian2();
    for (let i = 0; i < count; i++) {
      encoding.decodePosition(mesh.vertices, i, point);
      Cartesian3.subtract(point, mesh.center, point);
      encoding.decodeTextureCoordinates(mesh.vertices, i, textureCoordinates);
      vertices.set(
        [point.x, point.y, point.z, textureCoordinates.x, textureCoordinates.y],
        i * 5,
      );
    }
    data.gpuMesh = this.renderer.createMesh(
      vertices,
      mesh.indices,
      Matrix4.fromTranslation(mesh.center),
      data.texture,
    );
    data.gpuMesh.uv = uv;
    data.vertexArray = data.gpuMesh;
    tile.renderable = true;
    tile.state = QuadtreeTileLoadState.DONE;
  }
  draw(pass, camera) {
    for (const tile of this._selected) {
      const mesh = tile.data.gpuMesh;
      const color = this.layer ? Color.WHITE : this.baseColor;
      mesh.color = [color.red, color.green, color.blue, 1];
      this.renderer.draw(pass, mesh, camera);
    }
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    this._destroyed = true;
    for (const remove of this._removeListeners) {
      remove();
    }
    return undefined;
  }
}
export default WebGPUGlobeTileProvider;
