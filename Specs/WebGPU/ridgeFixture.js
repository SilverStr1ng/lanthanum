/*global Cesium*/
// N04 independent analytic fixture; the original frozen corpus is unchanged.
export const ridge = Object.freeze({
  longitude: 30.234375,
  latitude: 20.390625,
  width: 1.40625,
  base: 800,
  amplitude: 2500,
  size: 33,
  missing: [299, 99, 8],
  samples: [
    [30.234375, 20.390625, 3300],
    [29.8828125, 20.390625, 2675],
    [30.5859375, 20.390625, 2675],
  ],
});
export function height(longitude, latitude) {
  return (
    ridge.base +
    ridge.amplitude *
      Math.max(0, 1 - Math.abs(longitude - ridge.longitude) / ridge.width) +
    100 * Math.max(-1, Math.min(1, latitude - ridge.latitude))
  );
}
export function terrainProvider(requests) {
  const C = Cesium,
    scheme = new C.GeographicTilingScheme();
  const provider = new C.CustomHeightmapTerrainProvider({
    width: ridge.size,
    height: ridge.size,
    callback(x, y, level) {
      requests.push({ x, y, level });
      const rectangle = scheme.tileXYToRectangle(x, y, level),
        values = new Float32Array(ridge.size ** 2);
      for (let row = 0; row < ridge.size; row++) {
        for (let col = 0; col < ridge.size; col++) {
          values[row * ridge.size + col] = height(
            C.Math.toDegrees(
              rectangle.west + (rectangle.width * col) / (ridge.size - 1),
            ),
            C.Math.toDegrees(
              rectangle.north - (rectangle.height * row) / (ridge.size - 1),
            ),
          );
        }
      }
      return values;
    },
  });
  provider.getLevelMaximumGeometricError = (level) => 500000 / 2 ** level;
  provider.getTileDataAvailable = (x, y, level) =>
    !(
      level >= 8 &&
      x >> (level - 8) === ridge.missing[0] &&
      y >> (level - 8) === ridge.missing[1]
    );
  return provider;
}
