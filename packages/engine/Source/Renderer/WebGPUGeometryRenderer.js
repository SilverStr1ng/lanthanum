import { Matrix4 } from "@cesium/core";

const shader = `
struct Parameters { transform: mat4x4<f32>, color: vec4<f32>, uv: vec4<f32>, objectId: vec4<u32> }
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var image: texture_2d<f32>;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertexMain(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
  var output: VertexOutput;
  let clip = parameters.transform * vec4<f32>(position, 1.0);
  output.position = vec4<f32>(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
  output.uv = parameters.uv.xy + uv * parameters.uv.zw;
  return output;
}
struct FragmentOutput { @location(0) color: vec4<f32>, @location(1) objectId: u32 }
@fragment fn fragmentMain(input: VertexOutput) -> FragmentOutput {
  var output: FragmentOutput;
  output.color = textureSample(image, imageSampler, vec2<f32>(input.uv.x, 1.0 - input.uv.y)) * parameters.color;
  output.objectId = parameters.objectId.x;
  return output;
}`;

/** Shared native color/texture renderer. Positions are local to each mesh's double precision origin. */
class WebGPUGeometryRenderer {
  constructor(context) {
    this.context = context;
    const device = context.device;
    const module = device.createShaderModule({
      label: "local-origin geometry WGSL",
      code: shader,
    });
    this.pipeline = device.createRenderPipeline({
      label: "opaque geometry",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format: context.format }, { format: "r32uint" }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back",
        frontFace: "ccw",
      },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });
    this.sampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.whiteTexture = context.createTexture({
      label: "default white",
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.whiteTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
  }
  createMesh(vertices, indices, modelMatrix, texture = this.whiteTexture) {
    const context = this.context;
    const vertexBuffer = context.createBuffer(
      vertices,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      "mesh vertices",
    );
    const indexBuffer = context.createBuffer(
      new Uint32Array(indices),
      GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      "mesh indices",
    );
    const uniformBuffer = context.createBuffer(
      112,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "mesh parameters",
    );
    const bindGroup = context.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });
    return {
      vertexBuffer,
      indexBuffer,
      uniformBuffer,
      bindGroup,
      count: indices.length,
      modelMatrix,
      parameters: new Float32Array(28),
      matrix: new Matrix4(),
      color: [1, 1, 1, 1],
      uv: [0, 0, 1, 1],
      objectId: 1,
    };
  }
  draw(pass, mesh, camera) {
    // Cancellation in double precision occurs before uploading the local transform.
    Matrix4.multiply(camera.viewMatrix, mesh.modelMatrix, mesh.matrix);
    Matrix4.multiply(camera.frustum.projectionMatrix, mesh.matrix, mesh.matrix);
    Matrix4.toArray(mesh.matrix, mesh.parameters);
    mesh.parameters.set(mesh.color, 16);
    mesh.parameters.set(mesh.uv, 20);
    new Uint32Array(mesh.parameters.buffer)[24] = mesh.objectId;
    this.context.device.queue.writeBuffer(
      mesh.uniformBuffer,
      0,
      mesh.parameters,
    );
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, mesh.bindGroup);
    pass.setVertexBuffer(0, mesh.vertexBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, "uint32");
    pass.drawIndexed(mesh.count);
  }
  destroyMesh(mesh) {
    this.context.release(mesh?.vertexBuffer);
    this.context.release(mesh?.indexBuffer);
    this.context.release(mesh?.uniformBuffer);
  }
  destroy() {
    this.context.release(this.whiteTexture);
  }
}
export default WebGPUGeometryRenderer;
