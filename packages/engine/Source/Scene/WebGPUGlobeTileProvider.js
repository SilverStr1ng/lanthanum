import {
  AttributeCompression,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  Ellipsoid,
  EllipsoidalOccluder,
  Event,
  Intersect,
  IntersectionTests,
  Matrix4,
  Ray,
  Rectangle,
  Visibility,
} from "@cesium/core";
import GeographicTilingScheme from "../Core/GeographicTilingScheme.js";
import EllipsoidTerrainProvider from "../Core/EllipsoidTerrainProvider.js";
import Request from "../Core/Request.js";
import RequestType from "../Core/RequestType.js";
import RequestScheduler from "../Core/RequestScheduler.js";
import QuadtreeTileLoadState from "./QuadtreeTileLoadState.js";
import TileBoundingRegion from "./TileBoundingRegion.js";
import WebGPUImagery from "./WebGPUImagery.js";

class NativeTileData {
  constructor(provider, tile) {
    this.provider = provider;
    this.tile = tile;
    this.generation = provider._generation;
    this.tilingScheme = provider.tilingScheme;
    this.exaggeration = provider.exaggeration;
    this.relativeHeight = provider.relativeHeight;
    this.cancelled = false;
    this.started = false;
    this.eligibleForUnloading = true;
    this.tileBoundingRegion = new TileBoundingRegion({
      rectangle: tile.rectangle,
      ellipsoid: provider.tilingScheme.ellipsoid,
      minimumHeight: -20000,
      maximumHeight: 100000,
    });
    this.pickBoundingSphere = BoundingSphere.clone(
      this.tileBoundingRegion.boundingSphere,
    );
  }
  freeResources() {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.request?.cancel();
    this.provider.imagery.releaseTile(this);
    this.provider.renderer.destroyMesh(this.gpuMesh);
    this.gpuMesh =
      this.mesh =
      this.renderedMesh =
      this.vertexArray =
      this.terrainData =
        undefined;
  }
  pick(ray, mode, projection, cullBackFaces, result) {
    if (!this.mesh) {
      return undefined;
    }
    const { vertices, indices, encoding } = this.mesh;
    const a = new Cartesian3(),
      b = new Cartesian3(),
      c = new Cartesian3();
    let closest = Infinity;
    for (let i = 0; i < this.mesh.indexCountWithoutSkirts; i += 3) {
      encoding.getExaggeratedPosition(vertices, indices[i], a);
      encoding.getExaggeratedPosition(vertices, indices[i + 1], b);
      encoding.getExaggeratedPosition(vertices, indices[i + 2], c);
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

/** Cesium quadtree scheduling with native terrain meshes and independently cached imagery. */
class WebGPUGlobeTileProvider {
  constructor(
    globe,
    context,
    renderer,
    requestRender,
    maximumLevel = 12,
    options = {},
  ) {
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
    this._destroyed = false;
    this._generation = 0;
    this._work = {
      requests: 0,
      upsamples: 0,
      meshes: 0,
      requested: 0,
      upsampled: 0,
      uploaded: 0,
      cancelled: 0,
      peakInFlight: 0,
    };
    this._selected = [];
    this._terrainRequests = new Set();
    this._uploads = [];
    this.errors = [];
    this.exaggeration = 1;
    this.relativeHeight = 0;
    this.imagery = new WebGPUImagery(
      context,
      renderer,
      (error) => this.report(error),
      options,
    );
    this.occluder = new EllipsoidalOccluder(Ellipsoid.WGS84);
    this.fallbackProvider = new EllipsoidTerrainProvider();
  }
  get _pending() {
    return (
      this._terrainRequests.size + this._uploads.length + this.imagery.pending
    );
  }
  get ready() {
    return this._pending === 0;
  }
  get workStatistics() {
    return {
      ...this._work,
      inFlight: this._terrainRequests.size,
      queuedUploads: this._uploads.length,
      generation: this._generation,
    };
  }
  isCurrent(data) {
    return (
      !this._destroyed &&
      !data.cancelled &&
      data.generation === this._generation &&
      data.tile.data === data
    );
  }
  report(error) {
    error.recoverable = true;
    this.errors.push(error.message);
    if (this.errors.length > 32) {
      this.errors.shift();
    }
    this.errorEvent.raiseEvent(error);
  }
  update(frameState) {
    this.creditDisplay = frameState.creditDisplay;
    if (
      this.globe.material ||
      this.globe.clippingPlanes ||
      this.globe.clippingPolygons ||
      this.globe.translucency.enabled
    ) {
      throw new Error(
        "Native globe custom materials, clipping and translucency are not supported.",
      );
    }
    const terrain = this.globe.terrainProvider,
      scheme = terrain.tilingScheme;
    if (terrain.credit) {
      this.creditDisplay?.addCreditToNextFrame(terrain.credit);
    }
    if (
      !(scheme instanceof GeographicTilingScheme) ||
      !Ellipsoid.WGS84.equals(scheme.ellipsoid) ||
      !Rectangle.equals(scheme.rectangle, Rectangle.MAX_VALUE) ||
      scheme.getNumberOfXTilesAtLevel(0) !== 2 ||
      scheme.getNumberOfYTilesAtLevel(0) !== 1
    ) {
      throw new Error(
        "Native terrain requires WGS84 geographic tiling with full-world 2x1 roots.",
      );
    }
    const exaggeration = frameState.verticalExaggeration ?? 1,
      relative = frameState.verticalExaggerationRelativeHeight ?? 0;
    if (
      !Number.isFinite(exaggeration) ||
      exaggeration < 0 ||
      exaggeration > 100 ||
      !Number.isFinite(relative)
    ) {
      throw new Error("Invalid terrain verticalExaggeration.");
    }
    if (
      terrain !== this.terrainProvider ||
      exaggeration !== this.exaggeration ||
      relative !== this.relativeHeight
    ) {
      this._generation++;
      for (const data of this._terrainRequests) {
        data.freeResources();
      }
      for (const data of this._uploads) {
        data.freeResources();
      }
      this._uploads.length = 0;
      this.terrainProvider = terrain;
      this.tilingScheme = scheme;
      this.exaggeration = exaggeration;
      this.relativeHeight = relative;
      this.quadtree.invalidateAllTiles();
    }
    this.occluder.cameraPosition = frameState.camera.positionWC;
    this.imagery.update(this.globe.imageryLayers, frameState);
  }
  initialize() {
    RequestScheduler.update();
    for (let i = 0; i < 2 && this._uploads.length; i++) {
      const data = this._uploads.shift();
      if (this.isCurrent(data)) {
        this.upload(data);
      }
    }
  }
  beginUpdate() {
    this._selected.length = 0;
  }
  endUpdate() {}
  getLevelMaximumGeometricError(level) {
    return (
      this.terrainProvider.getLevelMaximumGeometricError(level) *
      Math.max(1, this.exaggeration)
    );
  }
  canRefine(tile) {
    return tile.level < this.maximumLevel && !!tile.data?.terrainData;
  }
  computeTileVisibility(tile, frameState) {
    if (!tile.data || !this.isCurrent(tile.data)) {
      tile.data = new NativeTileData(this, tile);
    }
    const data = tile.data;
    tile._distance = Math.max(
      1,
      data.tileBoundingRegion.distanceToCamera(frameState),
    );
    if (
      frameState.cullingVolume.computeVisibility(
        data.tileBoundingRegion.boundingVolume,
      ) === Intersect.OUTSIDE
    ) {
      return Visibility.NONE;
    }
    const point = data.mesh?.occludeePointInScaledSpace;
    if (
      point &&
      Cartesian3.magnitudeSquared(point) > 0 &&
      this.exaggeration === 1 &&
      frameState.camera.positionCartographic.height > 0 &&
      !this.occluder.isScaledSpacePointVisiblePossiblyUnderEllipsoid(
        point,
        data.mesh.minimumHeight,
      )
    ) {
      return Visibility.NONE;
    }
    return Visibility.FULL;
  }
  showTileThisFrame(tile) {
    if (tile.data?.gpuMesh) {
      this._selected.push(tile);
    }
  }
  upsample(data) {
    const tile = data.tile,
      parent = tile.parent;
    if (parent?.data?.terrainData) {
      return parent.data.terrainData.upsample(
        this.tilingScheme,
        parent.x,
        parent.y,
        parent.level,
        tile.x,
        tile.y,
        tile.level,
      );
    }
    return this.fallbackProvider.requestTileGeometry(
      tile.x,
      tile.y,
      tile.level,
    );
  }
  loadTile(frameState, tile) {
    if (!tile.data || !this.isCurrent(tile.data)) {
      tile.data = new NativeTileData(this, tile);
    }
    const data = tile.data;
    data.lastNeeded = frameState.frameNumber;
    if (data.started || this._terrainRequests.size >= 8 || this._destroyed) {
      return;
    }
    let promise;
    try {
      const available = this.terrainProvider.getTileDataAvailable?.(
        tile.x,
        tile.y,
        tile.level,
      );
      const parent = tile.parent;
      const parentUnavailable =
        parent?.data?.terrainData &&
        !parent.data.terrainData.isChildAvailable(
          parent.x,
          parent.y,
          tile.x,
          tile.y,
        );
      if (data.fallback || available === false || parentUnavailable) {
        promise = this.upsample(data);
        data.fallback = true;
      } else {
        data.request = new Request({
          throttle: true,
          throttleByServer: true,
          type: RequestType.TERRAIN,
        });
        promise = this.terrainProvider.requestTileGeometry(
          tile.x,
          tile.y,
          tile.level,
          data.request,
        );
      }
    } catch (error) {
      this.fail(data, error);
      return;
    }
    if (!promise) {
      return;
    }
    data.started = true;
    data.eligibleForUnloading = false;
    tile.state = QuadtreeTileLoadState.LOADING;
    this._terrainRequests.add(data);
    data.phase = data.fallback ? "upsamples" : "requests";
    this._work[data.phase]++;
    this._work[data.fallback ? "upsampled" : "requested"]++;
    this._work.peakInFlight = Math.max(
      this._work.peakInFlight,
      this._terrainRequests.size,
    );
    this.load(data, promise)
      .catch((error) => {
        if (this.isCurrent(data)) {
          this.fail(data, error);
        }
      })
      .finally(() => {
        this._terrainRequests.delete(data);
        data.eligibleForUnloading = true;
        if (!this._destroyed) {
          this.requestRender();
        }
      });
  }
  fail(data, error) {
    if (!this.isCurrent(data)) {
      return;
    }
    this.report(error);
    if (data.fallback) {
      data.tile.state = QuadtreeTileLoadState.FAILED;
      return;
    }
    data.fallback = true;
    data.started = false;
    data.tile.state = QuadtreeTileLoadState.START;
  }
  async load(data, promise) {
    let terrain;
    try {
      terrain = await promise;
    } finally {
      this._work[data.phase]--;
    }
    if (!this.isCurrent(data)) {
      return;
    }
    const tile = data.tile;
    let mesh;
    this._work.meshes++;
    try {
      mesh = await terrain.createMesh({
        tilingScheme: data.tilingScheme,
        x: tile.x,
        y: tile.y,
        level: tile.level,
        throttle: false,
        exaggeration: data.exaggeration,
        exaggerationRelativeHeight: data.relativeHeight,
      });
    } finally {
      this._work.meshes--;
    }
    if (!this.isCurrent(data)) {
      return;
    }
    if (!mesh) {
      throw new Error(
        "Terrain provider did not produce a heightmap or quantized mesh.",
      );
    }
    data.terrainData = terrain;
    data.mesh = data.renderedMesh = mesh;
    const low =
      (mesh.minimumHeight - this.relativeHeight) * this.exaggeration +
      this.relativeHeight;
    const high =
      (mesh.maximumHeight - this.relativeHeight) * this.exaggeration +
      this.relativeHeight;
    data.tileBoundingRegion = new TileBoundingRegion({
      rectangle: tile.rectangle,
      ellipsoid: this.tilingScheme.ellipsoid,
      minimumHeight: low,
      maximumHeight: high,
    });
    this._uploads.push(data);
  }
  upload(data) {
    if (!this.isCurrent(data)) {
      return;
    }
    const { mesh, tile } = data,
      encoding = mesh.encoding,
      count = mesh.vertices.length / encoding.stride;
    const vertices = new Float32Array(count * 8),
      point = new Cartesian3(),
      uv = new Cartesian2(),
      normal = new Cartesian3(),
      oct = new Cartesian2();
    for (let i = 0; i < count; i++) {
      encoding.getExaggeratedPosition(mesh.vertices, i, point);
      if (encoding.hasVertexNormals && this.exaggeration === 1) {
        encoding.getOctEncodedNormal(mesh.vertices, i, oct);
        AttributeCompression.octDecode(oct.x, oct.y, normal);
      } else {
        this.tilingScheme.ellipsoid.geodeticSurfaceNormal(point, normal);
      }
      Cartesian3.subtract(point, mesh.center, point);
      encoding.decodeTextureCoordinates(mesh.vertices, i, uv);
      vertices.set(
        [point.x, point.y, point.z, uv.x, uv.y, normal.x, normal.y, normal.z],
        i * 8,
      );
    }
    if (!encoding.hasVertexNormals || this.exaggeration !== 1) {
      computeNormals(vertices, mesh.indices, mesh.indexCountWithoutSkirts);
    }
    data.gpuMesh = this.renderer.createMesh(
      vertices,
      mesh.indices,
      Matrix4.fromTranslation(mesh.center),
    );
    data.vertexArray = data.gpuMesh;
    tile.renderable = true;
    tile.state = QuadtreeTileLoadState.DONE;
    this._work.uploaded++;
  }
  draw(pass, camera) {
    for (const tile of this._selected) {
      const data = tile.data,
        mesh = data.gpuMesh,
        color = this.baseColor;
      for (const credit of data.terrainData.credits ?? []) {
        this.creditDisplay?.addCreditToNextFrame(credit);
      }
      mesh.color = [color.red, color.green, color.blue, 1];
      mesh.flags[1] = Number(this.globe.enableLighting);
      mesh.count = this.globe.showSkirts
        ? data.mesh.indices.length
        : data.mesh.indexCountWithoutSkirts;
      this.renderer.draw(pass, mesh, camera);
      for (const draw of this.imagery.prepare(data)) {
        draw.count = mesh.count;
        this.renderer.draw(pass, draw, camera);
      }
    }
    this.imagery.finishFrame();
  }
  finishFrame(frameState) {
    for (const data of this._terrainRequests) {
      if (
        this.isCurrent(data) &&
        data.lastNeeded < frameState.frameNumber - 2
      ) {
        this._work.cancelled++;
        data.freeResources();
        data.tile.renderable = false;
        data.tile.state = QuadtreeTileLoadState.START;
      }
    }
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    this._destroyed = true;
    this._generation++;
    for (const data of this._terrainRequests) {
      data.freeResources();
    }
    for (const data of this._uploads) {
      data.freeResources();
    }
    this.imagery.destroy();
    this._uploads.length = 0;
    return undefined;
  }
}
function computeNormals(vertices, indices, count) {
  const normals = new Float64Array((vertices.length / 8) * 3);
  for (let i = 0; i < count; i += 3) {
    const a = indices[i] * 8,
      b = indices[i + 1] * 8,
      c = indices[i + 2] * 8;
    const ux = vertices[b] - vertices[a],
      uy = vertices[b + 1] - vertices[a + 1],
      uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a],
      vy = vertices[c + 1] - vertices[a + 1],
      vz = vertices[c + 2] - vertices[a + 2];
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    for (const index of [indices[i], indices[i + 1], indices[i + 2]]) {
      normals[index * 3] += x;
      normals[index * 3 + 1] += y;
      normals[index * 3 + 2] += z;
    }
  }
  for (let i = 0; i < normals.length / 3; i++) {
    const x = normals[i * 3],
      y = normals[i * 3 + 1],
      z = normals[i * 3 + 2],
      length = Math.hypot(x, y, z);
    if (length > 0) {
      vertices.set([x / length, y / length, z / length], i * 8 + 5);
    }
  }
}
export default WebGPUGlobeTileProvider;
