// Only the baseline harness uses this instrumentation. No production wrappers.
export default function instrumentWebGL(gl) {
  const live = {};
  const created = {};
  const deleted = {};
  const buffers = new Map();
  const bindings = new Map();
  const frame = { draws: 0, triangles: 0, instances: 0 };
  for (const kind of [
    "Buffer",
    "Texture",
    "Framebuffer",
    "Renderbuffer",
    "Program",
    "Shader",
    "VertexArray",
    "Sampler",
    "Query",
    "TransformFeedback",
  ]) {
    const resources = new Set();
    live[kind] = resources;
    created[kind] = 0;
    deleted[kind] = 0;
    const create = gl[`create${kind}`].bind(gl),
      remove = gl[`delete${kind}`].bind(gl);
    gl[`create${kind}`] = (...args) => {
      const resource = create(...args);
      if (resource) {
        resources.add(resource);
        created[kind]++;
      }
      return resource;
    };
    gl[`delete${kind}`] = (resource) => {
      if (resources.delete(resource)) {
        deleted[kind]++;
      }
      if (kind === "Buffer") {
        buffers.delete(resource);
      }
      return remove(resource);
    };
  }
  const bind = gl.bindBuffer.bind(gl),
    allocate = gl.bufferData.bind(gl);
  gl.bindBuffer = (target, buffer) => {
    bindings.set(target, buffer);
    return bind(target, buffer);
  };
  gl.bufferData = (...args) => {
    const [target, data, , sourceOffset = 0, length] = args;
    const bytes =
      typeof data === "number"
        ? data
        : length !== undefined
          ? length * data.BYTES_PER_ELEMENT
          : (data?.byteLength ?? 0) -
            sourceOffset * (data?.BYTES_PER_ELEMENT ?? 1);
    buffers.set(bindings.get(target), bytes);
    return allocate(...args);
  };
  for (const name of [
    "drawArrays",
    "drawElements",
    "drawArraysInstanced",
    "drawElementsInstanced",
  ]) {
    const draw = gl[name].bind(gl);
    gl[name] = (...args) => {
      const count = name.startsWith("drawArrays") ? args[2] : args[1];
      const instances = name.endsWith("Instanced") ? args.at(-1) : 1;
      frame.draws++;
      frame.instances += instances;
      if (args[0] === gl.TRIANGLES) {
        frame.triangles += (count / 3) * instances;
      }
      if (args[0] === gl.TRIANGLE_STRIP || args[0] === gl.TRIANGLE_FAN) {
        frame.triangles += Math.max(0, count - 2) * instances;
      }
      return draw(...args);
    };
  }
  return {
    frame,
    resetFrame() {
      frame.draws = 0;
      frame.triangles = 0;
      frame.instances = 0;
    },
    snapshot() {
      return {
        live: Object.fromEntries(
          Object.entries(live).map(([kind, set]) => [kind, set.size]),
        ),
        created: { ...created },
        deleted: { ...deleted },
        bufferBytes: [...buffers.values()].reduce((a, b) => a + b, 0),
        textureBytes: null,
        textureBytesReason:
          "Not measured; format/mipmap accounting belongs to S04",
        frame: { ...frame },
      };
    },
  };
}
