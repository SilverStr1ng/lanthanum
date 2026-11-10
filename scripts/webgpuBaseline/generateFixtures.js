import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./server.js";
import { png } from "./imageMetrics.js";

const output = path.join(root, "fixtures/generated");
await mkdir(output, { recursive: true });
const write = (name, data) => writeFile(path.join(output, name), data);

function numberedTile(scheme, z, x, y) {
  const rgba = Buffer.alloc(256 * 256 * 4);
  const hue = (x * 37 + y * 61 + z * 29) % 160;
  const pixel = (xx, yy, color) =>
    rgba.set([...color, 255], (yy * 256 + xx) * 4);
  for (let yy = 0; yy < 256; yy++) {
    for (let xx = 0; xx < 256; xx++) {
      pixel(
        xx,
        yy,
        xx < 2 || yy < 2 || xx > 253 || yy > 253 || xx === 128 || yy === 128
          ? [255, 255, 255]
          : [40 + hue, 80 + (hue % 100), 120 + (hue % 100)],
      );
    }
  }
  const glyphs = [
    "111101101101111",
    "010110010010111",
    "111001111100111",
    "111001111001111",
    "101101111001001",
    "111100111001111",
    "111100111101111",
    "111001001001001",
    "111101111101111",
    "111101111001111",
  ];
  for (const [digitIndex, digit] of `${z}${x}${y}`.split("").entries()) {
    const glyph = glyphs[Number(digit)];
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 3; column++) {
        if (glyph[row * 3 + column] !== "1") {
          continue;
        }
        for (let dy = 0; dy < 8; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            pixel(
              20 + digitIndex * 40 + column * 8 + dx,
              40 + row * 8 + dy,
              [0, 0, 0],
            );
          }
        }
      }
    }
  }
  for (let yy = 190; yy < 220; yy++) {
    for (let xx = 20; xx < 50; xx++) {
      pixel(xx, yy, scheme === "geographic" ? [255, 0, 0] : [0, 0, 255]);
    }
  }
  return png(256, 256, rgba);
}

// Entirely procedural fixtures, Apache-2.0, no third-party asset dependencies.
function boxes(count, columns, spacing, startX = 0, startY = 0) {
  const positions = new Float32Array(count * 24 * 3);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(count * 36);
  const faces = [
    [
      [1, 0, 0],
      [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [0, 1, 0],
        [0, 0, 0],
        [0, 0, 1],
        [0, 1, 1],
      ],
    ],
    [
      [0, 1, 0],
      [
        [1, 1, 0],
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
      ],
    ],
    [
      [0, -1, 0],
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
    ],
    [
      [0, 0, 1],
      [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
    ],
    [
      [0, 0, -1],
      [
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
      ],
    ],
  ];
  const minimum = [Infinity, Infinity, Infinity],
    maximum = [-Infinity, -Infinity, -Infinity];
  for (let box = 0; box < count; box++) {
    const x = startX + (box % columns) * spacing;
    const y = startY + Math.floor(box / columns) * spacing;
    const height = count === 1 ? 2 : 15 + ((box * 37) % 130);
    for (let face = 0; face < 6; face++) {
      for (let vertex = 0; vertex < 4; vertex++) {
        const offset = (box * 24 + face * 4 + vertex) * 3;
        const corner = faces[face][1][vertex];
        const value = [
          x + corner[0] * spacing * 0.65,
          y + corner[1] * spacing * 0.65,
          corner[2] * height,
        ];
        positions.set(value, offset);
        normals.set(faces[face][0], offset);
        for (let axis = 0; axis < 3; axis++) {
          minimum[axis] = Math.min(minimum[axis], value[axis]);
          maximum[axis] = Math.max(maximum[axis], value[axis]);
        }
      }
      indices.set(
        [0, 1, 2, 0, 2, 3].map((v) => box * 24 + face * 4 + v),
        box * 36 + face * 6,
      );
    }
  }
  const binary = Buffer.concat([
    Buffer.from(positions.buffer),
    Buffer.from(normals.buffer),
    Buffer.from(indices.buffer),
  ]);
  const json = {
    asset: { version: "2.0", generator: "Lanthanum deterministic fixtures v1" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { mesh: 0, matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1] },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.3, 0.7, 0.9, 1],
          metallicFactor: 0,
          roughnessFactor: 0.8,
        },
      },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: normals.byteLength,
      },
      {
        buffer: 0,
        byteOffset: positions.byteLength + normals.byteLength,
        byteLength: indices.byteLength,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: minimum,
        max: maximum,
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: normals.length / 3,
        type: "VEC3",
      },
      {
        bufferView: 2,
        componentType: 5125,
        count: indices.length,
        type: "SCALAR",
      },
    ],
  };
  const jsonText = JSON.stringify(json);
  const jsonBytes = Buffer.from(
    jsonText.padEnd(Math.ceil(Buffer.byteLength(jsonText) / 4) * 4, " "),
  );
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonBytes.length + binary.length, 8);
  header.writeUInt32LE(jsonBytes.length, 12);
  header.write("JSON", 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length);
  binaryHeader.write("BIN\0", 4);
  return Buffer.concat([header, jsonBytes, binaryHeader, binary]);
}

await write("box.glb", boxes(1, 1, 2));
const colorPixels = Buffer.alloc(32 * 32 * 4);
const colors = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
];
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    colorPixels.set(
      colors[Number(x >= 16) + Number(y >= 16) * 2],
      (y * 32 + x) * 4,
    );
  }
}
await write("four-colors.png", png(32, 32, colorPixels));
const children = [];
for (let tile = 0; tile < 16; tile++) {
  const x = (tile % 4) * 800 - 1600,
    y = Math.floor(tile / 4) * 800 - 1600;
  await write(`city-${tile}.glb`, boxes(6400, 80, 10, x, y));
  children.push({
    boundingVolume: {
      box: [x + 400, y + 400, 80, 400, 0, 0, 0, 400, 0, 0, 0, 80],
    },
    geometricError: 0,
    content: { uri: `city-${tile}.glb` },
  });
}
await write(
  "city.json",
  JSON.stringify(
    {
      asset: { version: "1.1" },
      geometricError: 1000,
      root: {
        boundingVolume: { box: [0, 0, 80, 1600, 0, 0, 0, 1600, 0, 0, 0, 80] },
        geometricError: 1000,
        refine: "ADD",
        children,
      },
    },
    null,
    2,
  ),
);
for (const scheme of ["geographic", "mercator"]) {
  for (let z = 0; z <= 2; z++) {
    const columns = 2 ** z * (scheme === "geographic" ? 2 : 1),
      rows = 2 ** z;
    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        await write(
          `${scheme}-${z}-${x}-${y}.png`,
          numberedTile(scheme, z, x, y),
        );
        const value = (x * 37 + y * 61 + z * 29) % 160;
        await write(
          `${scheme}-${z}-${x}-${y}.svg`,
          `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="rgb(${40 + value},${80 + (value % 100)},${120 + (value % 100)})"/><path d="M0 0H255V255H0Z M128 0V256 M0 128H256" fill="none" stroke="white" stroke-width="2"/><text x="15" y="65" font-family="monospace" font-size="26" fill="black">${scheme}</text><text x="15" y="110" font-family="monospace" font-size="32" fill="black">${z}/${x}/${y}</text><circle cx="35" cy="210" r="15" fill="red"/></svg>`,
        );
      }
    }
  }
}
console.log(
  "Generated local imagery, model and 1,228,800-triangle city fixtures.",
);
