// Independent offline quantized-mesh fixture; does not modify the frozen WebGL corpus.
import { mkdir, writeFile } from "node:fs/promises";
import {
  AttributeCompression,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Ellipsoid,
  EllipsoidalOccluder,
} from "@cesium/core";
import GeographicTilingScheme from "../../packages/engine/Source/Core/GeographicTilingScheme.js";

const scheme = new GeographicTilingScheme();
const directory = "Specs/WebGPU/fixtures/terrain";
const available = [];
for (let level = 0; level <= 8; level++) {
  const x = Math.floor((210 / 360) * (2 << level)),
    y = Math.floor((70 / 180) * (1 << level));
  const tiles =
    level === 0
      ? [
          [0, 0],
          [1, 0],
        ]
      : [[x, y]];
  available.push(
    tiles.map(([tx, ty]) => ({
      startX: tx,
      endX: tx,
      startY: (1 << level) - ty - 1,
      endY: (1 << level) - ty - 1,
    })),
  );
  for (const [tx, ty] of tiles) {
    const rectangle = scheme.tileXYToRectangle(tx, ty, level),
      size = 33;
    const points = [],
      us = [],
      vs = [],
      triangles = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const u = Math.round((col / (size - 1)) * 32767),
          v = Math.round((row / (size - 1)) * 32767);
        us.push(u);
        vs.push(v);
        points.push(
          Cartesian3.fromRadians(
            rectangle.west + (rectangle.width * u) / 32767,
            rectangle.south + (rectangle.height * v) / 32767,
            1500,
          ),
        );
      }
    }
    for (let row = 0; row < size - 1; row++) {
      for (let col = 0; col < size - 1; col++) {
        const a = row * size + col;
        triangles.push(a, a + 1, a + size, a + 1, a + size + 1, a + size);
      }
    }
    // First-use ordering makes high-water-mark index encoding valid.
    const order = [...new Set(triangles)],
      remap = new Map(order.map((old, index) => [old, index]));
    const steps = [...Array(size).keys()];
    const edges = [
      steps.map((i) => i * size),
      steps,
      steps.map((i) => i * size + size - 1),
      steps.map((i) => (size - 1) * size + i),
    ];
    const sphere = BoundingSphere.fromPoints(points);
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84);
    const horizon =
      occluder.computeHorizonCullingPoint(sphere.center, points) ??
      Cartesian3.ZERO;
    const buffer = Buffer.alloc(
      92 +
        order.length * 6 +
        4 +
        triangles.length * 2 +
        16 +
        size * 8 +
        5 +
        order.length * 2,
    );
    let offset = 0;
    const f64 = (value) => {
      buffer.writeDoubleLE(value, offset);
      offset += 8;
    };
    const f32 = (value) => {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    };
    const u32 = (value) => {
      buffer.writeUInt32LE(value, offset);
      offset += 4;
    };
    const u16 = (value) => {
      buffer.writeUInt16LE(value, offset);
      offset += 2;
    };
    for (const p of [sphere.center]) {
      f64(p.x);
      f64(p.y);
      f64(p.z);
    }
    f32(1500);
    f32(1500);
    f64(sphere.center.x);
    f64(sphere.center.y);
    f64(sphere.center.z);
    f64(sphere.radius);
    f64(horizon.x);
    f64(horizon.y);
    f64(horizon.z);
    u32(order.length);
    for (const values of [us, vs, new Array(points.length).fill(0)]) {
      let previous = 0;
      for (const old of order) {
        const delta = values[old] - previous;
        u16((delta << 1) ^ (delta >> 31));
        previous = values[old];
      }
    }
    u32(triangles.length / 3);
    let highest = 0;
    for (const old of triangles) {
      const index = remap.get(old),
        code = highest - index;
      u16(code);
      if (code === 0) {
        highest++;
      }
    }
    for (const edge of edges) {
      u32(edge.length);
      for (const old of edge) {
        u16(remap.get(old));
      }
    }
    buffer.writeUInt8(1, offset++);
    u32(order.length * 2);
    for (const old of order) {
      const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(points[old]),
        oct = AttributeCompression.octEncode(normal, new Cartesian2());
      buffer.writeUInt8(oct.x, offset++);
      buffer.writeUInt8(oct.y, offset++);
    }
    if (offset !== buffer.length) {
      throw new Error("Quantized fixture length mismatch");
    }
    const target = `${directory}/${level}/${tx}`;
    await mkdir(target, { recursive: true });
    await writeFile(`${target}/${(1 << level) - ty - 1}.terrain`, buffer);
  }
}
await writeFile(
  `${directory}/layer.json`,
  `${JSON.stringify({ tilejson: "2.1.0", format: "quantized-mesh-1.0", version: "1.0.0", scheme: "tms", tiles: ["{z}/{x}/{y}.terrain"], available, extensions: ["octvertexnormals"], attribution: "Lanthanum synthetic 1500 m terrain" }, null, 2)}\n`,
);
