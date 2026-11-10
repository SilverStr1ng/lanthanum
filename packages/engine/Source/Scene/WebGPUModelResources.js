import { Matrix3, Matrix4 } from "@cesium/core";
import WebGPUAsyncCache from "../Renderer/WebGPUAsyncCache.js";
import WebGPUModelRenderer, {
  modelVertexLayout,
} from "../Renderer/WebGPUModelRenderer.js";
import loadImageFromTypedArray from "../Core/loadImageFromTypedArray.js";
import loadWebGPUModel from "./WebGPUModelLoader.js";

const yUpToZUp = Matrix4.fromRotationTranslation(
  Matrix3.fromRotationX(Math.PI / 2),
);
const wrap = {
  33071: "clamp-to-edge",
  10497: "repeat",
  33648: "mirror-repeat",
};
/** All native model assets and tasks are owned by this one scene/device generation. @private */
class WebGPUModelResources {
  constructor(scene) {
    this.scene = scene;
    this.context = scene.context;
    this.instances = new Set();
    this.destroyed = false;
    this.generation = 1;
    this.renderer = new WebGPUModelRenderer(this.context);
    this.network = new WebGPUAsyncCache({
      label: "model downloads",
      concurrency: 4,
    });
    this.cpu = new WebGPUAsyncCache({
      label: "CPU model assets",
      concurrency: 4,
      maximumEntries: 32,
    });
    this.decoding = new WebGPUAsyncCache({
      label: "model image decoding",
      concurrency: 4,
      destroyValue: (image) => image.close?.(),
    });
    this.geometry = new WebGPUAsyncCache({
      label: "model geometry",
      destroyValue: (g) => {
        this.context.release(g.vertex);
        this.context.release(g.index);
      },
    });
    this.textures = new WebGPUAsyncCache({
      label: "model textures",
      destroyValue: (t) => this.context.release(t),
    });
    this.samplers = new WebGPUAsyncCache({ label: "model samplers" });
    this.removeError = this.context.errorEvent.addEventListener(() => {
      if (this.context.lost) {
        this.destroy();
      }
    });
  }
  get statistics() {
    return {
      generation: this.generation,
      instances: this.instances.size,
      ready: [...this.instances].filter((m) => m.ready).length,
      network: this.network.statistics,
      cpu: this.cpu.statistics,
      decoding: this.decoding.statistics,
      geometry: this.geometry.statistics,
      textures: this.textures.statistics,
      samplers: this.samplers.statistics,
      pipelines: this.renderer.pipelines.statistics,
    };
  }
  async read(url, signal) {
    const lease = this.network.acquire(
      url,
      async (physicalSignal) => {
        const response = await fetch(url, { signal: physicalSignal });
        if (!response.ok) {
          throw new Error(`${url}: HTTP ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      signal,
    );
    try {
      return await lease.promise;
    } finally {
      lease.release();
    }
  }
  texture(image, signal) {
    return this.textures.acquire(
      image ? `baseColor/srgb/${image.hash}` : "baseColor/white",
      async (physicalSignal) => {
        let decoded, lease, texture;
        try {
          if (image) {
            lease = this.decoding.acquire(
              image.hash,
              () =>
                loadImageFromTypedArray({
                  uint8Array: image.bytes,
                  format: image.mime,
                  flipY: false,
                  skipColorSpaceConversion: true,
                }),
              physicalSignal,
            );
            decoded = await lease.promise;
          }
          this.context.assertReady();
          if (physicalSignal.aborted) {
            throw new DOMException("Texture upload cancelled", "AbortError");
          }
          const width = decoded?.width ?? 1,
            height = decoded?.height ?? 1,
            limit = this.context.device.limits.maxTextureDimension2D;
          if (width < 1 || height < 1 || width > limit || height > limit) {
            throw new Error("Model image exceeds device texture limits");
          }
          texture = this.context.createTexture({
            label: "model baseColor sRGB",
            size: [width, height],
            format: "rgba8unorm-srgb",
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          });
          if (decoded) {
            this.context.device.queue.copyExternalImageToTexture(
              { source: decoded, flipY: false },
              { texture, premultipliedAlpha: false, colorSpace: "srgb" },
              [width, height],
            );
          } else {
            this.context.device.queue.writeTexture(
              { texture },
              new Uint8Array([255, 255, 255, 255]),
              { bytesPerRow: 4 },
              [1, 1],
            );
          }
          return texture;
        } catch (error) {
          this.context.release(texture);
          throw error;
        } finally {
          lease?.release();
        }
      },
      signal,
    );
  }
  async prepare(model) {
    const signal = model._controller.signal;
    const take = async (lease) => {
      model._leases.push(lease);
      return lease.promise;
    };
    const descriptor = await take(
      this.cpu.acquire(
        `${model.url}#scene=${model.sceneIndex ?? "default"}`,
        (physicalSignal) =>
          loadWebGPUModel(
            model.url,
            (url) => this.read(url, physicalSignal),
            model.sceneIndex,
          ),
        signal,
      ),
    );
    model._assertLive();
    model._state = "loaded";
    model.loadStatistics.cpuReadyMilliseconds =
      performance.now() - model._startedAt;
    model._descriptor = descriptor;
    for (const node of descriptor.nodes) {
      for (const primitive of node.primitives) {
        const geometry = await take(
          this.geometry.acquire(
            primitive.hash,
            () => {
              this.context.assertReady();
              let vertex, index;
              try {
                vertex = this.context.createBuffer(
                  primitive.vertices,
                  GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                  "model vertices",
                );
                if (primitive.indices) {
                  index = this.context.createBuffer(
                    primitive.indices,
                    GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                    "model indices",
                  );
                }
                return {
                  vertex,
                  index,
                  layout: modelVertexLayout(primitive.stride),
                  count: primitive.count,
                  indexFormat:
                    primitive.indices instanceof Uint32Array
                      ? "uint32"
                      : "uint16",
                };
              } catch (error) {
                this.context.release(vertex);
                this.context.release(index);
                throw error;
              }
            },
            signal,
          ),
        );
        const texture = await take(
          this.texture(descriptor.images[primitive.material.image], signal),
        );
        const s = primitive.material.sampler ?? {
          minFilter: 9729,
          magFilter: 9729,
          wrapS: 10497,
          wrapT: 10497,
        };
        const sampler = await take(
          this.samplers.acquire(
            JSON.stringify(s),
            () =>
              this.context.device.createSampler({
                addressModeU: wrap[s.wrapS],
                addressModeV: wrap[s.wrapT],
                magFilter: s.magFilter === 9728 ? "nearest" : "linear",
                minFilter: s.minFilter === 9728 ? "nearest" : "linear",
                mipmapFilter: "nearest",
                lodMinClamp: 0,
                lodMaxClamp: 0,
              }),
            signal,
          ),
        );
        const pipelines = await Promise.all(
          [false, true].map((mirrored) =>
            take(
              this.renderer.acquirePipeline(
                primitive.stride,
                primitive.material.doubleSided,
                mirrored,
                model.url,
                signal,
              ),
            ),
          ),
        );
        model._assertLive();
        const nodeTransform = Matrix4.multiply(
            yUpToZUp,
            node.transform,
            new Matrix4(),
          ),
          transform = Matrix4.multiply(
            nodeTransform,
            Matrix4.fromTranslation(primitive.origin),
            new Matrix4(),
          );
        const packet = this.renderer.createPacket(
          geometry,
          primitive.material,
          texture,
          sampler,
          pipelines,
          transform,
          model._objectId,
        );
        packet.bounds = primitive.sphere;
        packet.nodeTransform = nodeTransform;
        model._packets.push(packet);
      }
    }
    model._assertLive();
    model._state = "compiled";
    model.loadStatistics.drawableMilliseconds =
      performance.now() - model._startedAt;
    model.loadStatistics.pipelineCache = this.renderer.pipelines.statistics;
    model._state = "drawable";
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.generation++;
    this.removeError();
    for (const model of [...this.instances]) {
      model.destroy();
    }
    for (const cache of [
      this.cpu,
      this.network,
      this.decoding,
      this.geometry,
      this.textures,
      this.samplers,
    ]) {
      cache.destroy();
    }
    this.renderer.destroy();
  }
}
export default WebGPUModelResources;
