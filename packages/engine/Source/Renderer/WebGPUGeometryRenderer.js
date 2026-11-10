import { Matrix4 } from "@cesium/core";

const shader = `
struct Parameters {
  transform: mat4x4<f32>, color: vec4<f32>, uv: vec4<f32>, objectId: vec4<u32>,
  clip: vec4<f32>, geographic: vec4<f32>, adjustments: vec4<f32>, effects: vec4<f32>,
  flags: vec4<u32>, colorToAlpha: vec4<f32>, view: mat4x4<f32>, normal: mat4x4<f32>
}
@group(0) @binding(0) var<uniform> p: Parameters;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var image: texture_2d<f32>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>, @location(2) view: vec3<f32>
}
@vertex fn vertexMain(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>, @location(2) normal: vec3<f32>) -> VertexOutput {
  var output: VertexOutput;
  let clip = p.transform * vec4<f32>(position, 1.0);
  output.position = clip;
  output.uv = uv;
  output.normal = (p.normal * vec4<f32>(normal, 0.0)).xyz;
  output.view = (p.view * vec4<f32>(position, 1.0)).xyz;
  return output;
}
struct FragmentOutput { @location(0) color: vec4<f32>, @location(1) objectId: u32 }
@fragment fn fragmentMain(input: VertexOutput) -> FragmentOutput {
  var uv = p.uv.xy + input.uv * p.uv.zw;
  if (p.flags.x == 1u) {
    let latitude = clamp(p.geographic.x + input.uv.y * p.geographic.y, -1.48442223, 1.48442223);
    let mercator = log(tan(latitude * 0.5 + 0.78539816339));
    uv.y = (mercator - p.geographic.z) * p.geographic.w;
  }
  var sampled = textureSample(image, imageSampler, vec2<f32>(uv.x, 1.0 - uv.y));
  let faceNormal = normalize(cross(dpdy(input.view), dpdx(input.view)));
  if (p.objectId.y != 0u && (input.uv.x < p.clip.x || input.uv.y < p.clip.y || input.uv.x >= p.clip.z || input.uv.y >= p.clip.w)) { discard; }
  if ((p.effects.z < 0.0 && input.position.x > p.effects.w) || (p.effects.z > 0.0 && input.position.x < p.effects.w)) { discard; }
  if (p.colorToAlpha.w >= 0.0 && distance(sampled.rgb, p.colorToAlpha.rgb) < p.colorToAlpha.w) { sampled.a = 0.0; }
  var rgb = pow(sampled.rgb, vec3<f32>(1.0 / p.adjustments.w));
  rgb = (rgb - vec3<f32>(0.5)) * p.adjustments.z + vec3<f32>(0.5);
  rgb *= p.adjustments.y;
  let luminance = dot(rgb, vec3<f32>(0.2125, 0.7154, 0.0721));
  rgb = mix(vec3<f32>(luminance), rgb, p.effects.y);
  // Cesium's YIQ hue rotation, in radians.
  let yiq = vec3<f32>(dot(rgb, vec3<f32>(0.299,0.587,0.114)), dot(rgb, vec3<f32>(0.596,-0.275,-0.321)), dot(rgb, vec3<f32>(0.212,-0.523,0.311)));
  let angle = atan2(yiq.z, yiq.y) + p.effects.x;
  let chroma = length(yiq.yz);
  let rotated = vec3<f32>(yiq.x, chroma * cos(angle), chroma * sin(angle));
  rgb = vec3<f32>(dot(rotated,vec3<f32>(1.0,0.956,0.621)),dot(rotated,vec3<f32>(1.0,-0.272,-0.647)),dot(rotated,vec3<f32>(1.0,-1.107,1.704)));
  var output: FragmentOutput;
  output.color = vec4<f32>(rgb, sampled.a * p.adjustments.x) * p.color;
  if (p.flags.y != 0u) {
    var normal = select(normalize(input.normal), faceNormal, p.flags.z != 0u);
    if (p.flags.w != 0u && dot(normal, -input.view) < 0.0) { normal = -normal; }
    output.color = vec4<f32>(output.color.rgb * (0.3 + 0.7 * max(0.0, dot(normal, normalize(vec3<f32>(0.3,0.5,1.0))))), output.color.a);
  }
  if (output.color.a < 0.0039215686) { discard; }
  output.objectId = p.objectId.x;
  return output;
}`;

/** Native mesh resources and material draws. Each draw owns its uniform storage. */
class WebGPUGeometryRenderer {
  constructor(context) {
    this.context = context;
    this.projection = new Matrix4();
    const device = context.device;
    this.module = device.createShaderModule({
      label: "native geometry and imagery",
      code: shader,
    });
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });
    this.layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.pipelines = new Map();
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
  getPipeline(draw, cull = draw.cull ?? "back") {
    const topology = draw.topology ?? "triangle-list";
    const blend = draw.blend ?? false,
      depthWrite = draw.depthWrite ?? !blend;
    const key = `${topology}/${cull}/${blend}/${depthWrite}`;
    if (!this.pipelines.has(key)) {
      this.pipelines.set(
        key,
        this.context.device.createRenderPipeline({
          label: key,
          layout: this.layout,
          vertex: {
            module: this.module,
            entryPoint: "vertexMain",
            buffers: [
              {
                arrayStride: 32,
                attributes: [
                  { shaderLocation: 0, offset: 0, format: "float32x3" },
                  { shaderLocation: 1, offset: 12, format: "float32x2" },
                  { shaderLocation: 2, offset: 20, format: "float32x3" },
                ],
              },
            ],
          },
          fragment: {
            module: this.module,
            entryPoint: "fragmentMain",
            targets: [
              {
                format: this.context.format,
                blend: blend
                  ? {
                      color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                      },
                      alpha: {
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                      },
                    }
                  : undefined,
              },
              { format: "r32uint" },
            ],
          },
          primitive: {
            topology,
            cullMode: topology === "triangle-list" ? cull : "none",
            frontFace: "ccw",
          },
          depthStencil: {
            format: "depth32float",
            depthWriteEnabled: depthWrite,
            depthCompare: "greater-equal",
          },
        }),
      );
    }
    return this.pipelines.get(key);
  }
  createMesh(vertices, indices, modelMatrix, texture = this.whiteTexture) {
    const context = this.context;
    const mesh = {
      vertexBuffer: context.createBuffer(
        vertices,
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        "mesh vertices",
      ),
      indexBuffer: context.createBuffer(
        new Uint32Array(indices),
        GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        "mesh indices",
      ),
      count: indices.length,
      modelMatrix,
    };
    Object.assign(mesh, this.createDraw(mesh, texture));
    return mesh;
  }
  createDraw(mesh, texture = this.whiteTexture) {
    const uniformBuffer = this.context.createBuffer(
      336,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "draw parameters",
    );
    const bindGroup = this.context.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });
    return {
      vertexBuffer: mesh.vertexBuffer,
      indexBuffer: mesh.indexBuffer,
      count: mesh.count,
      modelMatrix: mesh.modelMatrix,
      uniformBuffer,
      bindGroup,
      parameters: new Float32Array(84),
      matrix: new Matrix4(),
      view: new Matrix4(),
      normalMatrix: new Matrix4(),
      color: [1, 1, 1, 1],
      uv: [0, 0, 1, 1],
      clip: [0, 0, 1.000001, 1.000001],
      geographic: [0, 0, 0, 1],
      adjustments: [1, 1, 1, 1],
      effects: [0, 1, 0, 0],
      flags: [0, 0, 0, 0],
      colorToAlpha: [0, 0, 0, -1],
      objectId: 1,
      clipEnabled: false,
    };
  }
  draw(pass, mesh, camera) {
    Matrix4.multiply(camera.viewMatrix, mesh.modelMatrix, mesh.view);
    // Convert in double precision before f32 upload. Do not subtract clip.z
    // from clip.w in WGSL: those terms can both be millions of metres.
    const projection = Matrix4.clone(
      camera.frustum.projectionMatrix,
      this.projection,
    );
    for (let column = 0; column < 4; column++) {
      const index = column * 4;
      projection[index + 2] =
        (projection[index + 3] - projection[index + 2]) * 0.5;
    }
    Matrix4.multiply(projection, mesh.view, mesh.matrix);
    Matrix4.inverseTranspose(mesh.view, mesh.normalMatrix);
    Matrix4.toArray(mesh.matrix, mesh.parameters);
    mesh.parameters.set(mesh.color, 16);
    mesh.parameters.set(mesh.uv, 20);
    new Uint32Array(mesh.parameters.buffer)[24] = mesh.objectId;
    new Uint32Array(mesh.parameters.buffer)[25] = Number(mesh.clipEnabled);
    mesh.parameters.set(mesh.clip, 28);
    mesh.parameters.set(mesh.geographic, 32);
    mesh.parameters.set(mesh.adjustments, 36);
    mesh.parameters.set(mesh.effects, 40);
    new Uint32Array(mesh.parameters.buffer).set(mesh.flags, 44);
    mesh.parameters.set(mesh.colorToAlpha, 48);
    for (let i = 0; i < 16; i++) {
      mesh.parameters[52 + i] = mesh.view[i];
      mesh.parameters[68 + i] = mesh.normalMatrix[i];
    }
    this.context.device.queue.writeBuffer(
      mesh.uniformBuffer,
      0,
      mesh.parameters,
    );
    pass.setBindGroup(0, mesh.bindGroup);
    pass.setVertexBuffer(0, mesh.vertexBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, "uint32");
    if (mesh.twoPasses) {
      pass.setPipeline(this.getPipeline(mesh, "front"));
      pass.drawIndexed(mesh.count);
    }
    pass.setPipeline(this.getPipeline(mesh));
    pass.drawIndexed(mesh.count);
  }
  destroyDraw(draw) {
    this.context.release(draw?.uniformBuffer);
  }
  destroyMesh(mesh) {
    this.context.release(mesh?.vertexBuffer);
    this.context.release(mesh?.indexBuffer);
    this.destroyDraw(mesh);
  }
  destroy() {
    this.context.release(this.whiteTexture);
    this.pipelines.clear();
  }
}
export default WebGPUGeometryRenderer;
