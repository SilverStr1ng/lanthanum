import { BoundingSphere, Cartesian3, Matrix4, Quaternion } from "@cesium/core";
import { parseGlb, readAccessorPacked, getNodeTransform } from "@cesium/gltf";
import { affineHandedness } from "../Renderer/WebGPUTransforms.js";

const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
function requireValue(valid, location, message) {
  if (!valid) {
    throw new Error(`${location}: ${message}`);
  }
}
function extensions(object, location) {
  for (const name of Object.keys(object.extensions ?? {})) {
    requireValue(
      name === "KHR_materials_unlit",
      location,
      `unsupported extension payload ${name}`,
    );
  }
}
/** Content identity includes bytes, not just the resource URL. @private */
export async function modelContentHash(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function parse(bytes, url) {
  if (
    bytes.length >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) ===
      0x46546c67
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    requireValue(
      bytes.length >= 20 &&
        view.getUint32(4, true) === 2 &&
        view.getUint32(8, true) === bytes.length,
      url,
      "invalid GLB2 header/length",
    );
    let offset = 12;
    while (offset < bytes.length) {
      requireValue(offset + 8 <= bytes.length, url, "invalid GLB chunk header");
      const length = view.getUint32(offset, true);
      requireValue(
        length % 4 === 0 && offset + 8 + length <= bytes.length,
        url,
        "invalid GLB chunk length",
      );
      offset += 8 + length;
    }
    return parseGlb(bytes);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function readAccessor(gltf, id, semantic) {
  const a = gltf.accessors?.[id],
    location = `accessor ${id} ${semantic}`;
  requireValue(
    a && !a.sparse,
    location,
    "missing accessor or unsupported sparse accessor",
  );
  const n = components[a.type],
    size = sizes[a.componentType];
  const allowed =
    semantic === "indices"
      ? [5121, 5123, 5125]
      : semantic === "POSITION" ||
          semantic === "NORMAL" ||
          semantic === "TANGENT"
        ? [5126]
        : [5126, 5121, 5123];
  requireValue(
    n && size && allowed.includes(a.componentType),
    location,
    "unsupported component type",
  );
  const shape =
    semantic === "indices"
      ? ["SCALAR"]
      : semantic === "TEXCOORD_0"
        ? ["VEC2"]
        : semantic === "COLOR_0"
          ? ["VEC3", "VEC4"]
          : semantic === "TANGENT"
            ? ["VEC4"]
            : ["VEC3"];
  requireValue(shape.includes(a.type), location, "invalid vector shape");
  requireValue(
    semantic === "indices"
      ? !a.normalized
      : a.componentType === 5126
        ? !a.normalized
        : a.normalized === true,
    location,
    "invalid normalized input",
  );
  const v = gltf.bufferViews?.[a.bufferView];
  requireValue(
    v && Number.isInteger(a.count) && a.count > 0,
    location,
    "missing bufferView or invalid count",
  );
  const stride = v.byteStride ?? n * size,
    offset = a.byteOffset ?? 0;
  requireValue(
    Number.isInteger(offset) &&
      offset >= 0 &&
      offset % size === 0 &&
      (offset + v.byteOffset) % size === 0,
    location,
    "invalid byteOffset alignment",
  );
  requireValue(
    Number.isInteger(stride) &&
      stride >= n * size &&
      stride % size === 0 &&
      (!v.byteStride || (stride >= 4 && stride <= 252 && stride % 4 === 0)) &&
      (semantic !== "indices" || !v.byteStride),
    location,
    "invalid byteStride",
  );
  requireValue(
    offset + (a.count - 1) * stride + n * size <= v.byteLength,
    location,
    "accessor exceeds bufferView",
  );
  a.byteOffset = offset;
  const values = readAccessorPacked(gltf, a);
  requireValue(values.every(Number.isFinite), location, "non-finite component");
  if (a.normalized) {
    const maximum = a.componentType === 5121 ? 255 : 65535;
    for (let i = 0; i < values.length; i++) {
      values[i] /= maximum;
    }
  }
  if (semantic === "COLOR_0") {
    requireValue(
      values.every((n) => n >= 0 && n <= 1),
      location,
      "color outside [0,1]",
    );
  }
  return {
    values,
    components: n,
    count: a.count,
    componentType: a.componentType,
  };
}
function material(gltf, id) {
  const m = gltf.materials?.[id],
    location = `material ${id}`;
  requireValue(
    m?.extensions?.KHR_materials_unlit !== undefined,
    location,
    "only explicit KHR_materials_unlit is supported; PBR requires N07",
  );
  extensions(m, location);
  requireValue(
    (m.alphaMode ?? "OPAQUE") === "OPAQUE",
    location,
    "only OPAQUE is supported",
  );
  requireValue(
    !m.normalTexture &&
      !m.occlusionTexture &&
      !m.emissiveTexture &&
      !m.emissiveFactor?.some((n) => n !== 0),
    location,
    "unsupported material channels",
  );
  const p = m.pbrMetallicRoughness ?? {},
    factor = p.baseColorFactor ?? [1, 1, 1, 1];
  requireValue(
    !p.metallicRoughnessTexture,
    location,
    "metallic-roughness texture requires N07",
  );
  requireValue(
    factor.length === 4 &&
      factor.every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
    location,
    "invalid baseColorFactor",
  );
  const info = p.baseColorTexture;
  if (!info) {
    return { factor, doubleSided: !!m.doubleSided };
  }
  extensions(info, `${location} texture`);
  requireValue(
    (info.texCoord ?? 0) === 0,
    location,
    "only TEXCOORD_0 is supported",
  );
  const texture = gltf.textures?.[info.index];
  requireValue(
    texture && gltf.images?.[texture.source],
    location,
    "invalid texture/image index",
  );
  extensions(texture, `texture ${info.index}`);
  const s =
    texture.sampler === undefined ? {} : gltf.samplers?.[texture.sampler];
  requireValue(s, location, "invalid sampler index");
  const minFilter = s.minFilter ?? 9729,
    magFilter = s.magFilter ?? 9729,
    wrapS = s.wrapS ?? 10497,
    wrapT = s.wrapT ?? 10497;
  requireValue(
    [9728, 9729].includes(minFilter) && [9728, 9729].includes(magFilter),
    location,
    "mip or invalid sampler filter is not supported",
  );
  requireValue(
    [33071, 10497, 33648].includes(wrapS) &&
      [33071, 10497, 33648].includes(wrapT),
    location,
    "invalid sampler wrap",
  );
  return {
    factor,
    doubleSided: !!m.doubleSided,
    image: texture.source,
    sampler: { minFilter, magFilter, wrapS, wrapT },
  };
}
/** Parse/validate using existing CPU glTF helpers; never imports WebGL Buffer or Texture. @private */
async function loadWebGPUModel(
  url,
  read,
  sceneIndex,
  intern = async (key, value) => value,
) {
  try {
    const gltf = parse(await read(url), url);
    requireValue(
      gltf?.asset?.version === "2.0",
      url,
      "only glTF 2.0 is supported",
    );
    requireValue(
      !gltf.animations?.length && !gltf.skins?.length,
      url,
      "animation/skin is not supported",
    );
    for (const name of gltf.extensionsRequired ?? []) {
      requireValue(
        name === "KHR_materials_unlit",
        url,
        `unsupported required extension ${name}`,
      );
    }
    // An unknown Used-only name without payload is harmless; actual payload is rejected.
    function inspect(value) {
      if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) {
        return;
      }
      if (value.extensions) {
        extensions(value, url);
      }
      for (const [key, child] of Object.entries(value)) {
        if (key !== "extras" && key !== "extensions") {
          inspect(child);
        }
      }
    }
    inspect(gltf);
    for (let i = 0; i < (gltf.buffers?.length ?? 0); i++) {
      const buffer = gltf.buffers[i],
        data = buffer.uri
          ? await read(new URL(buffer.uri, url).href)
          : buffer.extras?._pipeline?.source;
      requireValue(
        data &&
          Number.isInteger(buffer.byteLength) &&
          buffer.byteLength >= 0 &&
          data.length >= buffer.byteLength,
        `buffer ${i}`,
        "missing/truncated buffer",
      );
      buffer.extras = { _pipeline: { source: data } };
    }
    for (const [i, v] of (gltf.bufferViews ?? []).entries()) {
      v.byteOffset ??= 0;
      requireValue(
        gltf.buffers?.[v.buffer] &&
          Number.isInteger(v.byteOffset) &&
          v.byteOffset >= 0 &&
          Number.isInteger(v.byteLength) &&
          v.byteLength > 0 &&
          v.byteOffset + v.byteLength <= gltf.buffers[v.buffer].byteLength,
        `bufferView ${i}`,
        "out of bounds",
      );
    }
    const meshes = [];
    for (const [meshId, mesh] of (gltf.meshes ?? []).entries()) {
      requireValue(
        !mesh.weights,
        `mesh ${meshId}`,
        "morph weights are not supported",
      );
      const primitives = [];
      for (const [primitiveId, p] of mesh.primitives.entries()) {
        const location = `mesh ${meshId} primitive ${primitiveId}`;
        requireValue(
          (p.mode ?? 4) === 4 && !p.targets,
          location,
          "only static TRIANGLES without morph targets is supported",
        );
        for (const name of Object.keys(p.attributes)) {
          requireValue(
            ["POSITION", "TEXCOORD_0", "COLOR_0", "NORMAL", "TANGENT"].includes(
              name,
            ),
            location,
            `unsupported attribute ${name}`,
          );
        }
        const attributes = {};
        for (const [semantic, id] of Object.entries(p.attributes)) {
          attributes[semantic] = readAccessor(gltf, id, semantic);
        }
        const position = attributes.POSITION,
          uv = attributes.TEXCOORD_0,
          color = attributes.COLOR_0,
          m = material(gltf, p.material);
        requireValue(
          position && ((!m.image && m.image !== 0) || uv),
          location,
          "POSITION and textured TEXCOORD_0 are required",
        );
        requireValue(
          Object.values(attributes).every((a) => a.count === position.count),
          location,
          "attribute counts differ",
        );
        const points = [];
        for (let i = 0; i < position.count; i++) {
          points.push(Cartesian3.fromArray(position.values, i * 3));
        }
        const sphere = BoundingSphere.fromPoints(points),
          origin = Cartesian3.clone(sphere.center),
          stride = color ? 9 : 5,
          vertices = new Float32Array(position.count * stride);
        for (let i = 0; i < position.count; i++) {
          vertices.set(
            [
              points[i].x - origin.x,
              points[i].y - origin.y,
              points[i].z - origin.z,
              uv?.values[i * 2] ?? 0,
              uv?.values[i * 2 + 1] ?? 0,
            ],
            i * stride,
          );
          if (color) {
            vertices.set(
              [
                color.values[i * color.components],
                color.values[i * color.components + 1],
                color.values[i * color.components + 2],
                color.components === 4 ? color.values[i * 4 + 3] : 1,
              ],
              i * stride + 5,
            );
          }
        }
        let indices,
          count = position.count;
        if (p.indices !== undefined) {
          const input = readAccessor(gltf, p.indices, "indices");
          requireValue(
            input.values.every((index) => index < position.count),
            location,
            "index out of vertex range",
          );
          indices =
            input.componentType === 5125
              ? Uint32Array.from(input.values)
              : Uint16Array.from(input.values);
          count = indices.length;
        }
        requireValue(
          count % 3 === 0,
          location,
          "triangle count must be a multiple of three",
        );
        const indexFormat =
          indices instanceof Uint32Array
            ? "uint32"
            : indices
              ? "uint16"
              : "none";
        const hash = `${await modelContentHash(vertices)}:${indices ? await modelContentHash(indices) : "none"}:${stride}:${indexFormat}:${count}`;
        const payload = await intern(`geometry/${hash}`, { vertices, indices });
        primitives.push({
          vertices: payload.vertices,
          indices: payload.indices,
          count,
          stride: stride * 4,
          origin,
          sphere,
          material: m,
          hash,
        });
      }
      meshes.push(primitives);
    }
    const nodes = [],
      visited = new Set(),
      roots = gltf.scenes?.[sceneIndex ?? gltf.scene ?? 0]?.nodes;
    requireValue(roots?.length, url, "missing selected scene");
    function visit(id, parent) {
      const node = gltf.nodes?.[id];
      requireValue(
        node && !visited.has(id),
        `node ${id}`,
        "invalid node, cycle or multiple parents",
      );
      visited.add(id);
      requireValue(
        node.skin === undefined && !node.weights,
        `node ${id}`,
        "skin/morph is not supported",
      );
      requireValue(
        !node.matrix || (!node.translation && !node.rotation && !node.scale),
        `node ${id}`,
        "matrix and TRS are mutually exclusive",
      );
      for (const [key, length] of [
        ["matrix", 16],
        ["translation", 3],
        ["rotation", 4],
        ["scale", 3],
      ]) {
        if (node[key]) {
          requireValue(
            node[key].length === length && node[key].every(Number.isFinite),
            `node ${id}`,
            `invalid ${key}`,
          );
        }
      }
      if (node.rotation) {
        requireValue(
          Math.abs(Quaternion.magnitude(Quaternion.unpack(node.rotation)) - 1) <
            0.0001,
          `node ${id}`,
          "rotation is not normalized",
        );
      }
      const matrix = Matrix4.fromArray(
        getNodeTransform(node) ?? Matrix4.toArray(Matrix4.IDENTITY),
      );
      try {
        affineHandedness(matrix);
      } catch (error) {
        throw new Error(`node ${id}: ${error.message}`, { cause: error });
      }
      const transform = Matrix4.multiply(parent, matrix, new Matrix4());
      if (node.mesh !== undefined) {
        requireValue(meshes[node.mesh], `node ${id}`, "invalid mesh");
        nodes.push({ transform, primitives: meshes[node.mesh] });
      }
      for (const child of node.children ?? []) {
        visit(child, transform);
      }
    }
    for (const root of roots) {
      visit(root, Matrix4.IDENTITY);
    }
    const usedImages = new Set(
        nodes
          .flatMap((n) => n.primitives.map((p) => p.material.image))
          .filter((i) => i !== undefined),
      ),
      images = [];
    for (const id of usedImages) {
      const image = gltf.images[id],
        v = gltf.bufferViews?.[image.bufferView];
      requireValue(
        !!image.uri !== (image.bufferView !== undefined),
        `image ${id}`,
        "must declare exactly one uri or bufferView",
      );
      const bytes = image.uri
        ? await read(new URL(image.uri, url).href)
        : gltf.buffers[v.buffer].extras._pipeline.source.subarray(
            v.byteOffset,
            v.byteOffset + v.byteLength,
          );
      const mime =
        bytes[0] === 137 && bytes[1] === 80
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216
            ? "image/jpeg"
            : undefined;
      requireValue(
        mime && (!image.mimeType || image.mimeType === mime),
        `image ${id}`,
        "invalid PNG/JPEG image or MIME",
      );
      const hash = await modelContentHash(bytes);
      images[id] = await intern(`image/${mime}/${hash}`, { bytes, mime, hash });
    }
    return { nodes, images, url };
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new Error(`${url}: ${error.message}`, { cause: error });
  }
}
export default loadWebGPUModel;
