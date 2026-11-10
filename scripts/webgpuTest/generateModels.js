// Deterministic synthetic assets, separate from both previous frozen corpora.
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { Cartesian3, BoxGeometry, VertexFormat } from "@cesium/core";
import { png } from "../webgpuBaseline/imageMetrics.js";

const directory = "Specs/WebGPU/fixtures/models";
await mkdir(directory, { recursive: true });
const save = (name, value) =>
  writeFile(
    `${directory}/${name}`,
    typeof value === "object" && !Buffer.isBuffer(value)
      ? `${JSON.stringify(value, null, 2)}\n`
      : value,
  );
for (const [name, alpha] of [
  ["quadrants", 255],
  ["transparent", 0],
  ["gray", 255],
]) {
  const pixels = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const rgb =
        name === "gray"
          ? [128, 128, 128]
          : [
              [255, 0, 0],
              [0, 255, 0],
              [0, 0, 255],
              [255, 255, 255],
            ][(y >= 4 ? 2 : 0) + (x >= 4 ? 1 : 0)];
      pixels.set([...rgb, alpha], (y * 8 + x) * 4);
    }
  }
  await save(`${name}.png`, png(8, 8, pixels));
}
const jpegSource =
  "Specs/Data/Cesium3DTiles/Tilesets/TilesetWithExternalResources/textured_box_separate/bricks.jpg";
await copyFile(jpegSource, `${directory}/bricks.jpg`);
function geometry(positions, uvs, options = {}) {
  const interleaved = options.interleaved ?? false,
    color = options.color;
  const chunks = [],
    views = [],
    accessors = [];
  let length = 0;
  function attribute(values, componentType, type, normalized = false, stride) {
    const bytes = Buffer.from(
        values.buffer,
        values.byteOffset,
        values.byteLength,
      ),
      offset = length;
    chunks.push(bytes);
    length += bytes.length;
    const padding = (4 - (length % 4)) % 4;
    chunks.push(Buffer.alloc(padding));
    length += padding;
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      ...(stride ? { byteStride: stride } : {}),
    });
    accessors.push({
      bufferView: views.length - 1,
      byteOffset: 0,
      componentType,
      count: positions.length / 3,
      type,
      ...(normalized ? { normalized: true } : {}),
    });
    return accessors.length - 1;
  }
  let position, uv;
  if (interleaved) {
    const data = new Float32Array((positions.length / 3) * 5);
    for (let i = 0; i < data.length / 5; i++) {
      data.set(positions.slice(i * 3, i * 3 + 3), i * 5);
      data.set(uvs.slice(i * 2, i * 2 + 2), i * 5 + 3);
    }
    position = attribute(data, 5126, "VEC3", false, 20);
    accessors.push({ ...accessors[position], byteOffset: 12, type: "VEC2" });
    uv = accessors.length - 1;
  } else {
    position = attribute(new Float32Array(positions), 5126, "VEC3");
    const T =
      options.normalized === 8
        ? Uint8Array
        : options.normalized === 16
          ? Uint16Array
          : Float32Array;
    uv = attribute(
      T.from(
        uvs,
        (v) =>
          v *
          (options.normalized === 8
            ? 255
            : options.normalized === 16
              ? 65535
              : 1),
      ),
      options.normalized === 8 ? 5121 : options.normalized === 16 ? 5123 : 5126,
      "VEC2",
      !!options.normalized,
    );
  }
  const attributes = { POSITION: position, TEXCOORD_0: uv };
  if (color) {
    const T =
      color === 8 ? Uint8Array : color === 16 ? Uint16Array : Float32Array;
    attributes.COLOR_0 = attribute(
      T.from(
        Array.from({ length: positions.length / 3 }, () =>
          (options.tint ?? [1, 1, 1, options.alpha ?? 1]).slice(
            0,
            options.colorComponents ?? 4,
          ),
        ).flat(),
        (v) => v * (color === 8 ? 255 : color === 16 ? 65535 : 1),
      ),
      color === 8 ? 5121 : color === 16 ? 5123 : 5126,
      options.colorComponents === 3 ? "VEC3" : "VEC4",
      color !== 32,
    );
  }
  let indices;
  if (options.indices) {
    const T =
      options.indexType === 8
        ? Uint8Array
        : options.indexType === 32
          ? Uint32Array
          : Uint16Array;
    indices = attribute(
      T.from(options.indices),
      options.indexType === 8 ? 5121 : options.indexType === 32 ? 5125 : 5123,
      "SCALAR",
    );
    accessors[indices].count = options.indices.length;
  }
  return {
    bytes: Buffer.concat(chunks),
    views,
    accessors,
    attributes,
    indices,
  };
}
const positions = [-1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, -1],
  uvs = [0, 1, 1, 1, 0, 0, 1, 0];
function asset(data, name) {
  return {
    asset: { version: "2.0", generator: "Lanthanum N06-A synthetic fixtures" },
    extensionsUsed: ["KHR_materials_unlit"],
    extensionsRequired: ["KHR_materials_unlit"],
    buffers: [{ uri: `${name}.bin`, byteLength: data.bytes.length }],
    bufferViews: data.views,
    accessors: data.accessors,
    images: [{ uri: "quadrants.png" }],
    samplers: [
      { magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 },
    ],
    textures: [{ source: 0, sampler: 0 }],
    materials: [
      {
        extensions: { KHR_materials_unlit: {} },
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: { index: 0 },
        },
        alphaMode: "OPAQUE",
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: data.attributes,
            ...(data.indices !== undefined ? { indices: data.indices } : {}),
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}
const baseData = geometry(positions, uvs, { indices: [0, 1, 2, 1, 3, 2] });
await save("plane.bin", baseData.bytes);
const base = asset(baseData, "plane");
await save("plane.gltf", base);
for (const [name, options] of [
  ["u8", { indexType: 8 }],
  ["u32", { indexType: 32 }],
  ["interleaved", { interleaved: true }],
  ["normalized8", { normalized: 8, color: 8 }],
  ["normalized16", { normalized: 16, color: 16 }],
  ["color-float", { color: 32 }],
  ["color3", { color: 8, colorComponents: 3 }],
  ["vertex-tint", { color: 32, tint: [0.5, 1, 0.25, 1] }],
  ["alpha-zero", { color: 8, alpha: 0 }],
]) {
  const data = geometry(positions, uvs, {
      indices: [0, 1, 2, 1, 3, 2],
      ...options,
    }),
    gltf = asset(data, name);
  if (name === "alpha-zero") {
    gltf.images[0].uri = "transparent.png";
    gltf.materials[0].pbrMetallicRoughness.baseColorFactor[3] = 0;
  }
  if (name === "vertex-tint") {
    gltf.images[0].uri = "gray.png";
    gltf.materials[0].pbrMetallicRoughness.baseColorFactor = [0.5, 0.5, 0.5, 1];
  }
  await save(`${name}.bin`, data.bytes);
  await save(`${name}.gltf`, gltf);
}
const non = geometry(
  [0, 1, 2, 1, 3, 2].flatMap((i) => positions.slice(i * 3, i * 3 + 3)),
  [0, 1, 2, 1, 3, 2].flatMap((i) => uvs.slice(i * 2, i * 2 + 2)),
);
await save("nonindexed.bin", non.bytes);
await save("nonindexed.gltf", asset(non, "nonindexed"));
for (const [name, edit] of [
  [
    "no-texture",
    (g) => {
      delete g.materials[0].pbrMetallicRoughness.baseColorTexture;
      g.materials[0].pbrMetallicRoughness.baseColorFactor = [0.5, 0.25, 1, 0];
      delete g.meshes[0].primitives[0].attributes.TEXCOORD_0;
    },
  ],
  [
    "rotation",
    (g) => {
      g.nodes[0].rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    },
  ],
  [
    "selected-scene",
    (g) => {
      g.nodes.push({ mesh: 0, translation: [2, 0, 0] });
      g.scenes.push({ nodes: [1] });
    },
  ],
  [
    "bad-optional",
    (g) => {
      g.extensionsUsed.push("VENDOR_payload");
      g.nodes[0].extensions = { VENDOR_payload: {} };
    },
  ],
  [
    "bad-normalized",
    (g) => {
      g.accessors[0].normalized = true;
    },
  ],
  [
    "bad-uv",
    (g) => {
      g.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1;
    },
  ],
  [
    "bad-topology",
    (g) => {
      g.meshes[0].primitives[0].mode = 1;
    },
  ],
  [
    "bad-singular",
    (g) => {
      g.nodes[0].scale = [0, 1, 1];
    },
  ],
  [
    "gray",
    (g) => {
      g.images[0].uri = "gray.png";
    },
  ],
  [
    "gray-factor",
    (g) => {
      g.images[0].uri = "gray.png";
      g.materials[0].pbrMetallicRoughness.baseColorFactor = [0.5, 0.5, 0.5, 1];
    },
  ],
  [
    "jpeg",
    (g) => {
      g.images[0].uri = "bricks.jpg";
    },
  ],
  [
    "linear",
    (g) => {
      g.samplers[0].minFilter = g.samplers[0].magFilter = 9729;
    },
  ],
  [
    "double-sided",
    (g) => {
      g.materials[0].doubleSided = true;
    },
  ],
  [
    "multi",
    (g) => {
      g.nodes = [
        { translation: [1, 0, 0], children: [1, 2] },
        { mesh: 0, translation: [-3, 0, 0], scale: [1, 2, 0.5] },
        { mesh: 0, matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] },
      ];
    },
  ],
  [
    "optional-fallback",
    (g) => {
      g.extensionsUsed.push("VENDOR_optional_name");
    },
  ],
  [
    "bad-required",
    (g) => {
      g.extensionsRequired.push("VENDOR_required");
    },
  ],
  [
    "bad-animation",
    (g) => {
      g.animations = [{}];
    },
  ],
  [
    "bad-skin",
    (g) => {
      g.nodes[0].skin = 0;
      g.skins = [{}];
    },
  ],
  [
    "bad-morph",
    (g) => {
      g.meshes[0].primitives[0].targets = [{}];
    },
  ],
  [
    "bad-pbr",
    (g) => {
      delete g.materials[0].extensions;
    },
  ],
  [
    "bad-mask",
    (g) => {
      g.materials[0].alphaMode = "MASK";
    },
  ],
  [
    "bad-blend",
    (g) => {
      g.materials[0].alphaMode = "BLEND";
    },
  ],
  [
    "bad-mip",
    (g) => {
      g.samplers[0].minFilter = 9987;
    },
  ],
  [
    "bad-sparse",
    (g) => {
      g.accessors[0].sparse = { count: 1 };
    },
  ],
  [
    "bad-stride",
    (g) => {
      g.bufferViews[0].byteStride = 8;
    },
  ],
  [
    "bad-bounds",
    (g) => {
      g.accessors[0].count = 99999;
    },
  ],
  [
    "bad-image",
    (g) => {
      g.images[0].uri = "bad.png";
    },
  ],
  [
    "bad-decode",
    (g) => {
      g.images[0].uri = "bad-decode.png";
    },
  ],
  [
    "missing-buffer",
    (g) => {
      g.buffers[0].uri = "missing.bin";
    },
  ],
  [
    "bad-cycle",
    (g) => {
      g.nodes[0].children = [0];
    },
  ],
]) {
  const gltf = structuredClone(base);
  edit(gltf);
  await save(`${name}.gltf`, gltf);
}
await save("bad.png", Buffer.from("not an image"));
await save("bad-decode.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
for (const [name, wrap] of [
  ["repeat", 10497],
  ["mirror", 33648],
  ["clamp", 33071],
]) {
  const d = geometry(
      positions,
      uvs.map((v) => v * 4 - 1.5),
      { indices: [0, 1, 2, 1, 3, 2] },
    ),
    g = asset(d, name);
  g.samplers[0].wrapS = g.samplers[0].wrapT = wrap;
  await save(`${name}.bin`, d.bytes);
  await save(`${name}.gltf`, g);
}
const box = BoxGeometry.createGeometry(
    BoxGeometry.fromDimensions({
      dimensions: new Cartesian3(2, 2, 2),
      vertexFormat: VertexFormat.POSITION_AND_ST,
    }),
  ),
  data = geometry(
    [...box.attributes.position.values],
    [...box.attributes.st.values],
    { indices: [...box.indices] },
  ),
  gltf = asset(data, "box");
await save("box.bin", data.bytes);
await save("box.gltf", gltf);
const embedded = structuredClone(gltf),
  picture = await readFile(`${directory}/quadrants.png`);
delete embedded.buffers[0].uri;
embedded.buffers[0].byteLength += picture.length;
embedded.bufferViews.push({
  buffer: 0,
  byteOffset: data.bytes.length,
  byteLength: picture.length,
});
embedded.images = [
  { bufferView: embedded.bufferViews.length - 1, mimeType: "image/png" },
];
const raw = Buffer.from(JSON.stringify(embedded)),
  json = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 32)]),
  rawBin = Buffer.concat([data.bytes, picture]),
  bin = Buffer.concat([rawBin, Buffer.alloc((4 - (rawBin.length % 4)) % 4)]),
  glb = Buffer.alloc(28 + json.length + bin.length);
glb.write("glTF");
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(json.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
json.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + json.length);
glb.writeUInt32LE(0x004e4942, 24 + json.length);
bin.copy(glb, 28 + json.length);
await save("box.glb", glb);
const manifest = {
  version: 2,
  source:
    "Synthetic assets generated by Lanthanum (Apache-2.0); bricks.jpg copied unchanged from Cesium test corpus",
  jpegSource,
  expectations: {
    quadrants: [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ],
    gray: [128, 128, 128],
    grayFactor: [92, 92, 92],
    rgbTolerance: 3,
    jpegTolerance: 5,
    opaqueAlpha: 255,
    modelAxis: "glTF Y-up to ENU Z-up",
    lifecycleCycles: 20,
  },
  files: {},
};
for (const name of (await readdir(directory))
  .filter((n) => n !== "manifest.json")
  .sort()) {
  manifest.files[name] = createHash("sha256")
    .update(await readFile(`${directory}/${name}`))
    .digest("hex");
}
await save("manifest.json", manifest);
