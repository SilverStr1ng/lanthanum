import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./server.js";

export const sceneIds = [
  "T00",
  "T01",
  "T01-mercator",
  "T01-layers",
  "T01-dateline",
  "T02",
  "T03",
  "T04",
  "T04-i3dm",
  "T04-pnts",
  "T04-cmpt",
  "T05",
  "T05-entity",
  "T05-entity-box",
  "T05-geojson",
  "T05-czml",
  "T05-kml",
  "T06",
  "T07",
  "T08",
];
const sources = [
  "fixtures/generated",
  "Specs/Baseline",
  "Specs/Data/CesiumTerrainTileJson/QuantizedMesh",
  "Specs/Data/Cesium3DTiles/Batched/BatchedWithBatchTable",
  "Specs/Data/Cesium3DTiles/Instanced/InstancedWithBatchTable",
  "Specs/Data/Cesium3DTiles/PointCloud/PointCloudRGB",
  "Specs/Data/Cesium3DTiles/Composite/CompositeOfInstanced",
  "Specs/Data/test.geojson",
  "Specs/Data/Fonts/OpenSansNormal400.woff",
  "scripts/webgpuBaseline/generateFixtures.js",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function files(name) {
  try {
    const entries = await readdir(path.join(root, name), {
      withFileTypes: true,
    });
    const children = await Promise.all(
      entries.map((entry) => files(`${name}/${entry.name}`)),
    );
    return children.flat();
  } catch (error) {
    if (error.code !== "ENOTDIR") {
      throw error;
    }
    return [name];
  }
}

export async function verifyManifest() {
  const manifest = JSON.parse(
    await readFile(path.join(root, "fixtures/manifest.json"), "utf8"),
  );
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(root, asset.path));
    if (hash(bytes) !== asset.sha256 || bytes.length !== asset.bytes) {
      throw new Error(
        `Fixture changed: ${asset.path}. Review before freezing new hashes.`,
      );
    }
  }
  return {
    manifest,
    sha256: hash(await readFile(path.join(root, "fixtures/manifest.json"))),
  };
}

if (process.argv.includes("--freeze")) {
  const names = (await Promise.all(sources.map(files))).flat().sort();
  const assets = await Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(path.join(root, name));
      return {
        path: name,
        sha256: hash(bytes),
        bytes: bytes.length,
        license: "Apache-2.0",
        provenance: name.startsWith("Specs/Data/")
          ? "CesiumGS/cesium@2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87; LICENSE.md"
          : "Lanthanum procedural fixture or harness; LICENSE.md",
      };
    }),
  );
  const manifest = {
    schemaVersion: 1,
    baseline: "2aaf1daa6b9be58fb087fdc9f05f2f4d7ee37a87",
    assets,
    settings: {
      width: 1920,
      height: 1080,
      dpr: 1,
      time: "2026-11-09T12:00:00Z",
      antialias: false,
      hdr: false,
      shadows: false,
      oit: false,
      sse: 16,
      globeSse: 8,
      externalNetwork: "blocked",
      trajectory:
        "T08: heading 2*pi*t/30, pitch -1.3, range 6000m; origin -75deg,40deg,0m",
      expectedCityTriangles: 1228800,
      expectedCityTiles: 16,
    },
    scenes: sceneIds.map((id) => ({
      id,
      status: "baseline-subcase",
      implementation: [
        "T01-layers",
        "T01-dateline",
        "T05-entity",
        "T05-entity-box",
        "T05-geojson",
        "T05-czml",
        "T05-kml",
      ].includes(id)
        ? "Specs/Baseline/extendedScenarios.js"
        : "Specs/Baseline/baseline.js",
      expected:
        "No JS/GL errors; nonempty pixels; named numerical assertions; repeat image thresholds",
      coverage:
        "See compatibility-matrix.md; this subcase does not imply full family coverage",
    })),
    deferred: [
      {
        id: "T09",
        status: "deferred-S22",
        reason: "2D, Columbus View and morph excluded from production v1",
      },
    ],
  };
  await writeFile(
    path.join(root, "fixtures/manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Frozen ${assets.length} assets. Commit manifest changes only after review.`,
  );
} else if (process.argv.includes("--verify")) {
  const result = await verifyManifest();
  console.log(
    `Verified ${result.manifest.assets.length} assets: ${result.sha256}`,
  );
}
