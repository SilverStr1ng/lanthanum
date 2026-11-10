import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export async function prepareOutputDirectory(output, comparison) {
  if (comparison) {
    const relative = path.relative(
      path.resolve(comparison),
      path.resolve(output),
    );
    const reverse = path.relative(
      path.resolve(output),
      path.resolve(comparison),
    );
    const inside = (value) =>
      value === "" ||
      (!value.startsWith(`..${path.sep}`) &&
        value !== ".." &&
        !path.isAbsolute(value));
    if (inside(relative) || inside(reverse)) {
      throw new Error("Output and comparison directories must not overlap");
    }
  }
  try {
    if ((await readdir(output)).length > 0) {
      throw new Error(
        "Evidence output directory is not empty; choose a new directory",
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(output, { recursive: true });
}
