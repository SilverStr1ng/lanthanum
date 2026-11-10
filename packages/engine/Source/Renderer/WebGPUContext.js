import { Event } from "@cesium/core";

/** Native device, attachments and lifetime accounting for the experimental 3D scene. */
class WebGPUContext {
  static async create(canvas, options = {}) {
    if (!globalThis.isSecureContext || !navigator.gpu) {
      throw new Error("WebGPU requires a secure context and navigator.gpu.");
    }
    if (options.signal?.aborted) {
      throw new DOMException("Initialization cancelled", "AbortError");
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (options.signal?.aborted) {
      throw new DOMException("Initialization cancelled", "AbortError");
    }
    if (!adapter) {
      throw new Error("No WebGPU adapter is available.");
    }
    if (adapter.info?.isFallbackAdapter || adapter.isFallbackAdapter) {
      throw new Error(
        "Software WebGPU adapters are not supported by this hardware profile.",
      );
    }
    for (const feature of options.requiredFeatures ?? []) {
      if (!adapter.features.has(feature)) {
        throw new Error(`Missing WebGPU feature: ${feature}`);
      }
    }
    for (const [name, value] of Object.entries(options.requiredLimits ?? {})) {
      const alignment = name.startsWith("min");
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        !(name in adapter.limits) ||
        (alignment
          ? adapter.limits[name] > value
          : adapter.limits[name] < value)
      ) {
        throw new Error(`Insufficient WebGPU limit: ${name}=${value}`);
      }
    }
    const device = await adapter.requestDevice({
      label: "Lanthanum scene device",
      requiredFeatures: options.requiredFeatures ?? [],
      requiredLimits: options.requiredLimits ?? {},
    });
    let canvasAttempted = false;
    try {
      if (options.signal?.aborted) {
        throw new DOMException("Initialization cancelled", "AbortError");
      }
      canvasAttempted = true;
      const canvasContext = canvas.getContext("webgpu");
      if (!canvasContext) {
        throw new Error(
          "Canvas is already bound or WebGPU canvas context is unavailable.",
        );
      }
      return new WebGPUContext(canvas, canvasContext, adapter, device);
    } catch (error) {
      device.destroy();
      error.canvasBound = canvasAttempted;
      throw error;
    }
  }

  constructor(canvas, canvasContext, adapter, device) {
    this.canvas = canvas;
    this.device = device;
    this._canvasContext = canvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.errorEvent = new Event();
    this.errors = [];
    this._resources = new Map();
    this._destroyed = false;
    this.lost = false;
    const info = adapter.info;
    this.capabilities = {
      backend: "webgpu",
      vendor: info?.vendor,
      architecture: info?.architecture,
      device: info?.device,
      description: info?.description,
      features: [...device.features],
      maxTextureDimension2D: device.limits.maxTextureDimension2D,
      hardware: !(info?.isFallbackAdapter || adapter.isFallbackAdapter),
    };
    this._onError = (event) => {
      const message = event.error.message;
      this.errors.push(message);
      this.errorEvent.raiseEvent(new Error(message));
    };
    device.addEventListener("uncapturederror", this._onError);
    device.lost.then((info) => {
      if (!this._destroyed) {
        this.lost = true;
        this.errors.push(`Device lost: ${info.reason}: ${info.message}`);
        this.errorEvent.raiseEvent(new Error(this.errors.at(-1)));
      }
    });
    try {
      canvasContext.configure({
        device,
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        alphaMode: "opaque",
      });
      this.resize();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  get drawingBufferWidth() {
    return this.canvas.width;
  }
  get drawingBufferHeight() {
    return this.canvas.height;
  }
  get statistics() {
    let bytes = 0;
    const counts = { buffer: 0, texture: 0 };
    for (const value of this._resources.values()) {
      bytes += value.bytes;
      counts[value.type]++;
    }
    return { live: this._resources.size, bytes, ...counts };
  }
  assertReady() {
    if (this._destroyed || this.lost) {
      throw new Error("WebGPU context is destroyed or lost.");
    }
  }
  createBuffer(dataOrSize, usage, label) {
    this.assertReady();
    const size = Math.max(
      4,
      Math.ceil((dataOrSize.byteLength ?? dataOrSize) / 4) * 4,
    );
    const buffer = this.device.createBuffer({ size, usage, label });
    this._resources.set(buffer, { type: "buffer", bytes: size });
    if (ArrayBuffer.isView(dataOrSize)) {
      const bytes = new Uint8Array(size);
      bytes.set(
        new Uint8Array(
          dataOrSize.buffer,
          dataOrSize.byteOffset,
          dataOrSize.byteLength,
        ),
      );
      this.device.queue.writeBuffer(buffer, 0, bytes);
    }
    return buffer;
  }
  createTexture(descriptor) {
    this.assertReady();
    const texture = this.device.createTexture(descriptor);
    const size = descriptor.size;
    this._resources.set(texture, {
      type: "texture",
      bytes: size[0] * size[1] * 4,
    });
    return texture;
  }
  release(resource) {
    if (resource && this._resources.delete(resource)) {
      resource.destroy();
    }
  }
  resize() {
    this.assertReady();
    const width = this.canvas.width,
      height = this.canvas.height;
    if (
      width < 1 ||
      height < 1 ||
      Math.max(width, height) > this.device.limits.maxTextureDimension2D
    ) {
      throw new Error("Canvas dimensions exceed the WebGPU profile.");
    }
    if (width === this._width && height === this._height) {
      return;
    }
    this.release(this.colorTexture);
    this.release(this.depthTexture);
    this.release(this.pickTexture);
    this.colorTexture = this.createTexture({
      label: "scene color",
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.depthTexture = this.createTexture({
      label: "scene depth",
      size: [width, height],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.pickTexture = this.createTexture({
      label: "object IDs",
      size: [width, height],
      format: "r32uint",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this._width = width;
    this._height = height;
  }
  render(color, draw) {
    this.resize();
    const encoder = this.device.createCommandEncoder({ label: "scene frame" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.colorTexture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: {
            r: color.red,
            g: color.green,
            b: color.blue,
            a: color.alpha,
          },
        },
        {
          view: this.pickTexture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 0,
      },
    });
    draw?.(pass);
    pass.end();
    encoder.copyTextureToTexture(
      { texture: this.colorTexture },
      { texture: this._canvasContext.getCurrentTexture() },
      [this._width, this._height],
    );
    this.device.queue.submit([encoder.finish()]);
  }
  async captureAsync() {
    this.assertReady();
    if (this._reading) {
      throw new Error("Only one framebuffer capture may be in flight.");
    }
    this._reading = true;
    const width = this._width,
      height = this._height,
      pitch = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.createBuffer(
      pitch * height,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      "frame readback",
    );
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: this.colorTexture },
        { buffer, bytesPerRow: pitch },
        [width, height],
      );
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const source = new Uint8Array(buffer.getMappedRange());
      const result = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        result.set(
          source.subarray(y * pitch, y * pitch + width * 4),
          y * width * 4,
        );
      }
      if (this.format === "bgra8unorm") {
        for (let i = 0; i < result.length; i += 4) {
          [result[i], result[i + 2]] = [result[i + 2], result[i]];
        }
      }
      buffer.unmap();
      return result;
    } finally {
      this.release(buffer);
      this._reading = false;
    }
  }
  async readPickAsync(x, y) {
    this.assertReady();
    if ((this._pendingPicks ?? 0) >= 8) {
      throw new Error("At most eight native picks may be in flight.");
    }
    this._pendingPicks = (this._pendingPicks ?? 0) + 1;
    const buffer = this.createBuffer(
      256,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      "object ID readback",
    );
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: this.pickTexture, origin: [x, y] },
        { buffer, bytesPerRow: 256 },
        [1, 1],
      );
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const id = new Uint32Array(buffer.getMappedRange())[0];
      buffer.unmap();
      return id;
    } finally {
      this.release(buffer);
      this._pendingPicks--;
    }
  }
  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    for (const resource of [...this._resources.keys()]) {
      this.release(resource);
    }
    this.device.removeEventListener("uncapturederror", this._onError);
    this._canvasContext.unconfigure();
    this.device.destroy();
  }
}
export default WebGPUContext;
