import test from "node:test";
import assert from "node:assert/strict";
import { compareImages, percentiles, png } from "./imageMetrics.js";

test("image gates accept exact pixels and reject a completely different scene", () => {
  const black = Buffer.alloc(16 * 16 * 4),
    white = Buffer.alloc(black.length, 255);
  const same = compareImages(black, black, 16, 16);
  assert.equal(same.ssim, 1);
  assert.equal(same.withinThreeFraction, 1);
  const different = compareImages(black, white, 16, 16);
  assert.equal(different.significantFraction, 1);
  assert.ok(different.ssim < 0.01);
});
test("channel error thresholds have inclusive boundaries and ignore alpha", () => {
  const a = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
  const b = Buffer.from([3, 0, 0, 255, 0, 10, 0, 255]);
  const result = compareImages(a, b, 2, 1);
  assert.equal(result.significantFraction, 0);
  assert.equal(result.withinThreeFraction, 0.5);
  b[5] = 11;
  assert.equal(compareImages(a, b, 2, 1).significantFraction, 0.5);
});
test("invalid image dimensions fail closed", () => {
  assert.throws(() => compareImages(Buffer.alloc(4), Buffer.alloc(4), 2, 1));
  assert.throws(() => png(2, 1, Buffer.alloc(4)));
});
test("percentiles use nearest rank, preserve inputs and do not invent missing samples", () => {
  const samples = [3, 1, 2];
  assert.deepEqual(percentiles(samples), {
    count: 3,
    p50: 2,
    p95: 3,
    p99: 3,
    max: 3,
  });
  assert.deepEqual(samples, [3, 1, 2]);
  assert.equal(percentiles([]), null);
});
