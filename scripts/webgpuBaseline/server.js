import http from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
};

export async function serve(directory = root) {
  const base = await realpath(directory);
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (
        ![
          "/Specs/Baseline/",
          "/Specs/WebGPU/",
          "/Apps/WebGPU/",
          "/Specs/Data/",
          "/Build/CesiumUnminified/",
          "/fixtures/generated/",
        ].some((prefix) => pathname.startsWith(prefix))
      ) {
        response.writeHead(403).end();
        return;
      }
      const filename = await realpath(path.resolve(base, `.${pathname}`));
      const relative = path.relative(base, filename);
      if (
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        !(await stat(filename)).isFile()
      ) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      createReadStream(filename).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { url } = await serve();
  console.log(`${url}/Specs/Baseline/index.html?scene=T01`);
}
