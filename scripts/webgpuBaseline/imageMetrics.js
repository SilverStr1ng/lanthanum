import { deflateSync } from "node:zlib";

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}

export function png(width, height, rgba, flip = false) {
  if (rgba.length !== width * height * 4) {
    throw new Error("RGBA dimensions do not match");
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const sourceY = flip ? height - y - 1 : y;
    rgba.copy(
      rows,
      y * (width * 4 + 1) + 1,
      sourceY * width * 4,
      (sourceY + 1) * width * 4,
    );
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// SSIM uses non-overlapping 8x8 luminance windows, population covariance,
// C1=(0.01*255)^2 and C2=(0.03*255)^2. Alpha is not a comparison channel.
export function compareImages(a, b, width, height) {
  if (a.length !== b.length || a.length !== width * height * 4) {
    throw new Error("Image dimensions do not match");
  }
  let significant = 0;
  let withinThree = 0;
  const diff = Buffer.alloc(a.length, 255);
  for (let i = 0; i < a.length; i += 4) {
    let maximum = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a[i + channel] - b[i + channel]);
      maximum = Math.max(maximum, delta);
      diff[i + channel] = delta;
    }
    significant += Number(maximum > 10);
    withinThree += Number(maximum <= 3);
  }
  let ssim = 0;
  let windows = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      let n = 0,
        sumA = 0,
        sumB = 0,
        squareA = 0,
        squareB = 0,
        product = 0;
      for (let yy = y; yy < Math.min(y + 8, height); yy++) {
        for (let xx = x; xx < Math.min(x + 8, width); xx++) {
          const i = (yy * width + xx) * 4;
          const av = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
          const bv = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
          n++;
          sumA += av;
          sumB += bv;
          squareA += av * av;
          squareB += bv * bv;
          product += av * bv;
        }
      }
      const meanA = sumA / n,
        meanB = sumB / n;
      const varianceA = squareA / n - meanA * meanA;
      const varianceB = squareB / n - meanB * meanB;
      const covariance = product / n - meanA * meanB;
      ssim +=
        ((2 * meanA * meanB + 6.5025) * (2 * covariance + 58.5225)) /
        ((meanA * meanA + meanB * meanB + 6.5025) *
          (varianceA + varianceB + 58.5225));
      windows++;
    }
  }
  return {
    ssim: ssim / windows,
    significantFraction: significant / (width * height),
    withinThreeFraction: withinThree / (width * height),
    diff,
  };
}

export function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const percentile = (p) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
  };
}
