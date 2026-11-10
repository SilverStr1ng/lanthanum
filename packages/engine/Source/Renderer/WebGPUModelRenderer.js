import { Matrix4 } from "@cesium/core";
import WebGPUAsyncCache from "./WebGPUAsyncCache.js";
import { reverseProjection, affineDeterminant } from "./WebGPUTransforms.js";

const source = (color) => `
struct Parameters { transform:mat4x4<f32>, factor:vec4<f32>, object:vec4<u32> }
@group(0) @binding(0) var<uniform> p: Parameters;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var imageSampler: sampler;
struct Varyings { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32>, @location(1) color:vec4<f32> }
@vertex fn vertexMain(@location(0) position:vec3<f32>, @location(1) uv:vec2<f32>${color ? ", @location(2) color:vec4<f32>" : ""}) -> Varyings {
  var output:Varyings;
  output.position=p.transform*vec4<f32>(position,1.0);
  output.uv=uv;
  output.color=${color ? "color" : "vec4<f32>(1.0)"};
  return output;
}
struct Fragment { @location(0) color:vec4<f32>, @location(1) object:u32 }
@fragment fn fragmentMain(input:Varyings) -> Fragment {
  let linear=clamp(textureSample(image,imageSampler,input.uv).rgb*p.factor.rgb*input.color.rgb,vec3<f32>(0.0),vec3<f32>(1.0));
  let encoded=select(1.055*pow(linear,vec3<f32>(1.0/2.4))-vec3<f32>(0.055),12.92*linear,linear<=vec3<f32>(0.0031308));
  var result:Fragment;
  result.color=vec4<f32>(encoded,1.0);
  result.object=p.object.x;
  return result;
}`;

export function modelVertexLayout(stride) {
  return {
    arrayStride: stride,
    stepMode: "vertex",
    attributes: [
      { shaderLocation: 0, format: "float32x3", offset: 0 },
      { shaderLocation: 1, format: "float32x2", offset: 12 },
      ...(stride === 36
        ? [{ shaderLocation: 2, format: "float32x4", offset: 20 }]
        : []),
    ],
  };
}
/** Canonical complete identity for the model pipeline's current shader/layout contract. @private */
export function modelPipelineKey(format, stride, doubleSided, mirrored) {
  return JSON.stringify({
    shader: "unlit-srgb-v1",
    vertexEntry: "vertexMain",
    fragmentEntry: "fragmentMain",
    variant: stride === 36 ? "color" : "white",
    bindings: "uniform96-texture2d-float-sampler-v1",
    vertices: [modelVertexLayout(stride)],
    topology: "triangle-list",
    frontFace: mirrored ? "cw" : "ccw",
    cullMode: doubleSided ? "none" : "back",
    targets: [format, "r32uint"],
    depthFormat: "depth32float",
    depthCompare: "greater-equal",
    depthWrite: true,
    blend: null,
    sampleCount: 1,
  });
}
/** Independent packets share geometry/material resources, never their mutable uniforms. @private */
class WebGPUModelRenderer {
  constructor(context) {
    this.context = context;
    const device = context.device;
    this.bindLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: 96 },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindLayout],
    });
    this.pipelines = new WebGPUAsyncCache({
      label: "model pipeline",
      concurrency: 2,
      maximumEntries: 64,
    });
  }
  acquirePipeline(stride, doubleSided, mirrored, asset, signal) {
    const key = modelPipelineKey(
        this.context.format,
        stride,
        doubleSided,
        mirrored,
      ),
      definition = JSON.parse(key);
    return this.pipelines.acquire(
      key,
      async (signal) => {
        try {
          this.context.assertReady();
          const module = this.context.device.createShaderModule({
            label: `unlit ${definition.variant}`,
            code: source(stride === 36),
          });
          const diagnostics = await module.getCompilationInfo();
          const failures = diagnostics.messages.filter(
            (m) => m.type === "error",
          );
          if (failures.length) {
            throw new Error(
              failures
                .map((m) => `${m.lineNum}:${m.linePos} ${m.message}`)
                .join("\n"),
            );
          }
          this.context.assertReady();
          if (signal.aborted) {
            throw new DOMException(
              "Pipeline preparation cancelled",
              "AbortError",
            );
          }
          return await this.context.device.createRenderPipelineAsync({
            label: `unlit ${definition.variant} ${definition.frontFace}`,
            layout: this.pipelineLayout,
            vertex: {
              module,
              entryPoint: definition.vertexEntry,
              buffers: definition.vertices,
            },
            fragment: {
              module,
              entryPoint: definition.fragmentEntry,
              targets: definition.targets.map((format) => ({ format })),
            },
            primitive: {
              topology: definition.topology,
              frontFace: definition.frontFace,
              cullMode: definition.cullMode,
            },
            depthStencil: {
              format: definition.depthFormat,
              depthCompare: definition.depthCompare,
              depthWriteEnabled: true,
            },
            multisample: { count: definition.sampleCount },
          });
        } catch (error) {
          throw new Error(
            `${asset}: shader unlit; variant ${key}: ${error.message}`,
            { cause: error },
          );
        }
      },
      signal,
    );
  }
  createPacket(
    geometry,
    material,
    texture,
    sampler,
    pipelines,
    transform,
    objectId,
  ) {
    const uniform = this.context.createBuffer(
      96,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "model draw parameters",
    );
    try {
      return {
        pass: "opaque",
        geometry,
        material,
        pipelines,
        transform,
        objectId,
        uniform,
        parameters: new Float32Array(24),
        bindGroup: this.context.device.createBindGroup({
          layout: this.bindLayout,
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: sampler },
          ],
        }),
      };
    } catch (error) {
      this.context.release(uniform);
      throw error;
    }
  }
  draw(pass, packet, camera, modelMatrix) {
    const world = Matrix4.multiply(
        modelMatrix,
        packet.transform,
        new Matrix4(),
      ),
      mirrored = affineDeterminant(world) < 0;
    const view = Matrix4.multiply(camera.viewMatrix, world, new Matrix4()),
      matrix = Matrix4.multiply(reverseProjection(camera), view, new Matrix4());
    Matrix4.toArray(matrix, packet.parameters);
    packet.parameters.set(packet.material.factor, 16);
    new Uint32Array(packet.parameters.buffer)[20] = packet.objectId;
    this.context.device.queue.writeBuffer(packet.uniform, 0, packet.parameters);
    pass.setPipeline(packet.pipelines[Number(mirrored)]);
    pass.setBindGroup(0, packet.bindGroup);
    pass.setVertexBuffer(0, packet.geometry.vertex);
    if (packet.geometry.index) {
      pass.setIndexBuffer(packet.geometry.index, packet.geometry.indexFormat);
      pass.drawIndexed(packet.geometry.count);
    } else {
      pass.draw(packet.geometry.count);
    }
  }
  destroyPacket(packet) {
    this.context.release(packet.uniform);
  }
  destroy() {
    this.pipelines.destroy();
    this.bindLayout = this.pipelineLayout = undefined;
  }
}
export default WebGPUModelRenderer;
