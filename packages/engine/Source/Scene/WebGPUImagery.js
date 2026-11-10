import { Cartographic, Ellipsoid, Rectangle } from "@cesium/core";
import GeographicTilingScheme from "../Core/GeographicTilingScheme.js";
import WebMercatorTilingScheme from "../Core/WebMercatorTilingScheme.js";
import Request from "../Core/Request.js";
import RequestType from "../Core/RequestType.js";

const mercator = (latitude) =>
  Math.log(
    Math.tan(
      Math.PI / 4 +
        Math.max(-1.4844222297453324, Math.min(1.4844222297453324, latitude)) /
          2,
    ),
  );
const split = (rectangle) =>
  rectangle.west <= rectangle.east
    ? [rectangle]
    : [
        new Rectangle(
          rectangle.west,
          rectangle.south,
          Math.PI,
          rectangle.north,
        ),
        new Rectangle(
          -Math.PI,
          rectangle.south,
          rectangle.east,
          rectangle.north,
        ),
      ];
let nextRecordId = 1;

function normalizedRectangle(scheme, x, y, level) {
  const rectangle = scheme.tileXYToRectangle(x, y, level);
  if (rectangle.west >= Math.PI) {
    rectangle.west -= Math.PI * 2;
  }
  if (rectangle.east > Math.PI) {
    rectangle.east -= Math.PI * 2;
  }
  return rectangle;
}
function positionToTile(scheme, position, level) {
  const rectangle = scheme.rectangle;
  if (
    scheme instanceof GeographicTilingScheme &&
    rectangle.east < rectangle.west
  ) {
    if (!Rectangle.contains(rectangle, position)) {
      return undefined;
    }
    const longitude =
      position.longitude < rectangle.west
        ? position.longitude + Math.PI * 2
        : position.longitude;
    const width = scheme.getNumberOfXTilesAtLevel(level),
      height = scheme.getNumberOfYTilesAtLevel(level);
    return {
      x: Math.min(
        width - 1,
        Math.floor(((longitude - rectangle.west) / rectangle.width) * width),
      ),
      y: Math.min(
        height - 1,
        Math.floor(
          ((rectangle.north - position.latitude) / rectangle.height) * height,
        ),
      ),
    };
  }
  return scheme.positionToTileXY(position, level);
}

/** Image requests, ancestor fallback and bounded GPU texture residency for native globe draws. */
class WebGPUImagery {
  constructor(context, renderer, reportError, options = {}) {
    this.context = context;
    this.renderer = renderer;
    this.reportError = reportError;
    this.maximumLayers = 8;
    this.maximumTextures = options.maximumImageryTextures ?? 256;
    this.maximumBytes = options.maximumImageryBytes ?? 128 * 1024 * 1024;
    if (
      !Number.isInteger(this.maximumTextures) ||
      this.maximumTextures < 1 ||
      !Number.isSafeInteger(this.maximumBytes) ||
      this.maximumBytes < 1024
    ) {
      throw new Error("Invalid native imagery cache budget.");
    }
    this.records = new Map();
    this.layers = [];
    this.tiles = new Set();
    this.frame = 0;
    this.activeRequests = 0;
    this.bytes = 0;
    this.textureCount = 0;
    this.uploads = [];
    this._destroyed = false;
  }
  get pending() {
    let pending = this.unreadyLayers ?? 0;
    for (const record of this.records.values()) {
      if (
        !record.cancelled &&
        record.lastUsed >= this.frame - 1 &&
        !record.texture &&
        !record.failed
      ) {
        pending++;
      }
    }
    return pending;
  }
  update(collection, frameState) {
    this.frame = frameState.frameNumber;
    collection._update();
    const layers = [];
    this.unreadyLayers = 0;
    for (let i = 0; i < collection.length; i++) {
      const layer = collection.get(i);
      if (!layer.show) {
        continue;
      }
      if (!layer.ready) {
        this.unreadyLayers++;
        continue;
      }
      const provider = layer.imageryProvider,
        scheme = provider.tilingScheme;
      if (
        !(
          scheme instanceof GeographicTilingScheme ||
          scheme instanceof WebMercatorTilingScheme
        ) ||
        !Ellipsoid.WGS84.equals(scheme.ellipsoid)
      ) {
        throw new Error(
          "Native imagery requires WGS84 geographic or Web Mercator tiling.",
        );
      }
      for (const [name, minimum, maximum] of [
        ["alpha", 0, 1],
        ["brightness", 0, 100],
        ["contrast", 0, 100],
        ["gamma", 0.001, 100],
        ["hue", -Math.PI * 2, Math.PI * 2],
        ["saturation", 0, 100],
      ]) {
        if (
          !Number.isFinite(layer[name]) ||
          layer[name] < minimum ||
          layer[name] > maximum
        ) {
          throw new Error(`Invalid native imagery ${name}.`);
        }
      }
      if (layer.cutoutRectangle) {
        throw new Error("Native imagery cutoutRectangle is not supported.");
      }
      if (![-1, 0, 1].includes(layer.splitDirection)) {
        throw new Error("Invalid imagery splitDirection.");
      }
      layers.push(layer);
      if (provider.credit) {
        frameState.creditDisplay?.addCreditToNextFrame(provider.credit);
      }
    }
    if (layers.length > this.maximumLayers) {
      throw new Error(
        `Native imagery supports at most ${this.maximumLayers} visible layers.`,
      );
    }
    const providers = new Set(layers.map((layer) => layer.imageryProvider));
    for (const record of this.records.values()) {
      if (!providers.has(record.provider)) {
        this.evict(record);
      }
    }
    for (const tile of this.tiles) {
      for (const [key, binding] of tile.imageryDraws) {
        if (!layers.includes(binding.layer)) {
          this.renderer.destroyDraw(binding.draw);
          tile.imageryDraws.delete(key);
        }
      }
    }
    this.layers = layers;
    this.creditDisplay = frameState.creditDisplay;
    this.splitPosition = frameState.imagerySplitPosition ?? 0.5;
    // Limit decoded image uploads to four per rendered frame.
    let examined = this.uploads.length,
      uploaded = 0;
    while (examined-- > 0 && uploaded < 4) {
      const { record, image } = this.uploads.shift();
      if (record.cancelled || this._destroyed) {
        continue;
      }
      try {
        const discard = record.provider.tileDiscardPolicy;
        if (discard && !discard.isReady()) {
          this.uploads.push({ record, image });
          continue;
        }
        if (discard?.shouldDiscardImage(image)) {
          throw new Error(
            "Imagery tile was discarded; retaining ancestor imagery.",
          );
        }
        uploaded++;
        const size = image.width * image.height * 4;
        this.trim(size);
        if (
          size > this.maximumBytes ||
          this.bytes + size > this.maximumBytes ||
          this.textureCount >= this.maximumTextures
        ) {
          throw new Error(
            "Native imagery texture budget exhausted; retaining ancestor imagery.",
          );
        }
        record.texture = this.context.createTexture({
          label: `imagery ${record.level}/${record.x}/${record.y}`,
          size: [image.width, image.height],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.context.device.queue.copyExternalImageToTexture(
          { source: image, flipY: image instanceof ImageBitmap },
          { texture: record.texture },
          [image.width, image.height],
        );
        record.bytes = size;
        this.bytes += size;
        this.textureCount++;
        // requestImage results belong to the provider (SingleTile may reuse the same bitmap).
      } catch (error) {
        this.context.release(record.texture);
        record.texture = undefined;
        record.failed = true;
        this.reportError(error);
      }
    }
  }
  record(provider, x, y, level) {
    let providerId = this.providerIds?.get(provider);
    if (!this.providerIds) {
      this.providerIds = new WeakMap();
      this.nextProviderId = 1;
    }
    if (!providerId) {
      providerId = this.nextProviderId++;
      this.providerIds.set(provider, providerId);
    }
    const key = `${providerId}/${level}/${x}/${y}`;
    let record = this.records.get(key);
    if (!record) {
      record = {
        id: nextRecordId++,
        key,
        provider,
        x,
        y,
        level,
        lastUsed: this.frame,
        bytes: 0,
      };
      this.records.set(key, record);
    }
    record.lastUsed = this.frame;
    if (
      !record.texture &&
      !record.started &&
      !record.failed &&
      this.activeRequests + this.uploads.length < 8
    ) {
      const request = new Request({
        throttle: true,
        throttleByServer: true,
        type: RequestType.IMAGERY,
      });
      let promise;
      try {
        promise = provider.requestImage(x, y, level, request);
      } catch (error) {
        record.failed = true;
        this.reportError(error);
      }
      if (promise) {
        record.started = true;
        record.request = request;
        this.activeRequests++;
        Promise.resolve(promise)
          .then((image) => {
            if (record.cancelled || this._destroyed) {
              return;
            }
            if (!image) {
              throw new Error("Imagery tile was empty.");
            }
            this.uploads.push({ record, image });
          })
          .catch((error) => {
            if (!record.cancelled && !this._destroyed) {
              record.failed = true;
              this.reportError(error);
            }
          })
          .finally(() => {
            this.activeRequests--;
          });
      }
    }
    return record;
  }
  regions(layer, tile, base) {
    const provider = layer.imageryProvider,
      scheme = provider.tilingScheme;
    const polarBase =
      base &&
      scheme instanceof WebMercatorTilingScheme &&
      Rectangle.equals(provider.rectangle, scheme.rectangle) &&
      Rectangle.equals(layer.rectangle, Rectangle.MAX_VALUE);
    const bounds = polarBase ? Rectangle.MAX_VALUE : provider.rectangle;
    const regions = [];
    for (const coverage of split(bounds)) {
      for (const limit of split(layer.rectangle)) {
        const first = Rectangle.intersection(coverage, limit, new Rectangle());
        const region =
          first &&
          Rectangle.intersection(first, tile.rectangle, new Rectangle());
        if (region && region.width > 1e-12 && region.height > 1e-12) {
          regions.push({ rectangle: region, polarBase });
        }
      }
    }
    return regions;
  }
  prepare(data) {
    this.tiles.add(data);
    data.imageryDraws ??= new Map();
    const selected = [],
      used = new Set(),
      tile = data.tile;
    for (const layer of this.layers) {
      const provider = layer.imageryProvider,
        scheme = provider.tilingScheme;
      const isMercator = scheme instanceof WebMercatorTilingScheme;
      const minimum = provider.minimumLevel ?? 0;
      for (const region of this.regions(
        layer,
        tile,
        layer === this.layers[0],
      )) {
        let level = Math.max(
          minimum,
          Math.min(tile.level, provider.maximumLevel ?? tile.level),
        );
        let nw, se;
        while (true) {
          const r = region.rectangle,
            s = scheme.rectangle;
          nw = positionToTile(
            scheme,
            new Cartographic(
              r.west + 1e-10,
              Math.max(
                s.south + 1e-10,
                Math.min(s.north - 1e-10, r.north - 1e-10),
              ),
            ),
            level,
          );
          se = positionToTile(
            scheme,
            new Cartographic(
              r.east - 1e-10,
              Math.max(
                s.south + 1e-10,
                Math.min(s.north - 1e-10, r.south + 1e-10),
              ),
            ),
            level,
          );
          if (!nw || !se) {
            break;
          }
          if ((se.x - nw.x + 1) * (se.y - nw.y + 1) <= 64) {
            break;
          }
          if (level === minimum) {
            throw new Error(
              "Imagery minimumLevel requires more than 64 intersections per terrain tile.",
            );
          }
          level--;
        }
        if (!nw || !se) {
          continue;
        }
        for (let y = nw.y; y <= se.y; y++) {
          for (let x = nw.x; x <= se.x; x++) {
            let chosen;
            for (let parent = minimum; parent <= level; parent++) {
              const factor = 2 ** (level - parent);
              const candidate = this.record(
                provider,
                Math.floor(x / factor),
                Math.floor(y / factor),
                parent,
              );
              if (candidate.texture) {
                chosen = candidate;
              }
            }
            if (!chosen) {
              continue;
            }
            for (const credit of provider.getTileCredits?.(
              chosen.x,
              chosen.y,
              chosen.level,
            ) ?? []) {
              this.creditDisplay?.addCreditToNextFrame(credit);
            }
            const imageRectangle = normalizedRectangle(
              scheme,
              chosen.x,
              chosen.y,
              chosen.level,
            );
            const targetRectangle = normalizedRectangle(scheme, x, y, level);
            if (region.polarBase) {
              if (y === 0) {
                targetRectangle.north = Math.PI / 2;
              }
              if (y === scheme.getNumberOfYTilesAtLevel(level) - 1) {
                targetRectangle.south = -Math.PI / 2;
              }
            }
            const clip = Rectangle.intersection(
              region.rectangle,
              targetRectangle,
              new Rectangle(),
            );
            if (!clip) {
              continue;
            }
            const key = `${this.layers.indexOf(layer)}/${chosen.id}/${x}/${y}/${level}`;
            let binding = data.imageryDraws.get(key);
            if (!binding || binding.layer !== layer) {
              if (binding) {
                this.renderer.destroyDraw(binding.draw);
              }
              binding = {
                layer,
                draw: this.renderer.createDraw(data.gpuMesh, chosen.texture),
              };
              data.imageryDraws.set(key, binding);
            }
            used.add(key);
            const draw = binding.draw,
              r = tile.rectangle;
            draw.blend = true;
            draw.depthWrite = false;
            const west =
              imageRectangle.east < imageRectangle.west &&
              clip.west < imageRectangle.west
                ? r.west + Math.PI * 2
                : r.west;
            draw.uv = [
              (west - imageRectangle.west) / imageRectangle.width,
              (r.south - imageRectangle.south) / imageRectangle.height,
              r.width / imageRectangle.width,
              r.height / imageRectangle.height,
            ];
            draw.clip = [
              (clip.west - r.west) / r.width,
              (clip.south - r.south) / r.height,
              (clip.east - r.west) / r.width,
              (clip.north - r.south) / r.height,
            ];
            draw.geographic = [
              r.south,
              r.height,
              mercator(imageRectangle.south),
              1 /
                (mercator(imageRectangle.north) -
                  mercator(imageRectangle.south)),
            ];
            draw.flags = [
              Number(isMercator),
              Number(data.provider.globe.enableLighting),
              0,
              0,
            ];
            draw.adjustments = [
              layer.alpha,
              layer.brightness,
              layer.contrast,
              layer.gamma,
            ];
            draw.effects = [
              layer.hue,
              layer.saturation,
              layer.splitDirection,
              this.splitPosition * this.context.canvas.width,
            ];
            const alpha = layer.colorToAlpha;
            draw.colorToAlpha = alpha
              ? [
                  alpha.red,
                  alpha.green,
                  alpha.blue,
                  layer.colorToAlphaThreshold,
                ]
              : [0, 0, 0, -1];
            selected.push(draw);
          }
        }
      }
    }
    for (const [key, binding] of data.imageryDraws) {
      if (!used.has(key)) {
        this.renderer.destroyDraw(binding.draw);
        data.imageryDraws.delete(key);
      }
    }
    return selected;
  }
  finishFrame() {
    for (const record of this.records.values()) {
      if (!record.texture && record.lastUsed < this.frame - 2) {
        this.evict(record);
      }
    }
    this.trim(0);
  }
  trim(incoming) {
    const unused = [...this.records.values()]
      .filter((record) => record.lastUsed < this.frame - 1)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (
      unused.length &&
      (this.records.size > this.maximumTextures ||
        this.textureCount + (incoming > 0 ? 1 : 0) > this.maximumTextures ||
        this.bytes + incoming > this.maximumBytes)
    ) {
      this.evict(unused.shift());
    }
  }
  evict(record) {
    if (record.cancelled) {
      return;
    }
    record.cancelled = true;
    record.request?.cancel();
    if (record.texture) {
      this.textureCount--;
    }
    this.context.release(record.texture);
    this.bytes -= record.bytes;
    record.texture = undefined;
    this.records.delete(record.key);
  }
  releaseTile(data) {
    if (data.imageryDraws) {
      for (const binding of data.imageryDraws.values()) {
        this.renderer.destroyDraw(binding.draw);
      }
      data.imageryDraws.clear();
    }
    this.tiles.delete(data);
  }
  destroy() {
    this._destroyed = true;
    for (const tile of [...this.tiles]) {
      this.releaseTile(tile);
    }
    for (const record of [...this.records.values()]) {
      this.evict(record);
    }
    this.uploads.length = 0;
  }
}
export default WebGPUImagery;
