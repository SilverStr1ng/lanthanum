import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Create missing parents while keeping an existing evidence leaf immutable. */
export async function createOutputDirectory(output) {
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
}
