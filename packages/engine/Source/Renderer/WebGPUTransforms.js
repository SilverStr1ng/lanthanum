import { Matrix4, Matrix3, BoundingSphere } from "@cesium/core";

/** Shared CPU-double precision reverse-depth transform. @private */
export function reverseProjection(camera, result = new Matrix4()) {
  Matrix4.clone(camera.frustum.projectionMatrix, result);
  for (let column = 0; column < 4; column++) {
    const index = column * 4;
    result[index + 2] = (result[index + 3] - result[index + 2]) * 0.5;
  }
  return result;
}
export function affineHandedness(matrix) {
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(matrix?.[i])) {
      throw new Error("Model matrix must be finite and affine");
    }
  }
  if (
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  ) {
    throw new Error("Model matrix must be finite and affine");
  }
  // Normalize each column before testing orientation. An absolute determinant
  // threshold rejects valid small units and can underflow for nested scales.
  const x = Math.max(
      Math.abs(matrix[0]),
      Math.abs(matrix[1]),
      Math.abs(matrix[2]),
    ),
    y = Math.max(Math.abs(matrix[4]), Math.abs(matrix[5]), Math.abs(matrix[6])),
    z = Math.max(
      Math.abs(matrix[8]),
      Math.abs(matrix[9]),
      Math.abs(matrix[10]),
    );
  if (x === 0 || y === 0 || z === 0) {
    throw new Error("Model matrix must be nonsingular");
  }
  const a = matrix[0] / x,
    b = matrix[1] / x,
    c = matrix[2] / x,
    d = matrix[4] / y,
    e = matrix[5] / y,
    f = matrix[6] / y,
    g = matrix[8] / z,
    h = matrix[9] / z,
    i = matrix[10] / z;
  const determinant =
    a * (e * i - h * f) - d * (b * i - h * c) + g * (b * f - e * c);
  if (determinant === 0) {
    throw new Error("Model matrix must be nonsingular");
  }
  return Math.sign(determinant);
}
// A rotated child of a nonuniformly scaled parent may contain shear. The largest
// singular value bounds every direction; maximum column length does not.
export function transformModelBounds(
  sphere,
  matrix,
  result = new BoundingSphere(),
) {
  Matrix4.multiplyByPoint(matrix, sphere.center, result.center);
  const linear = Matrix4.getMatrix3(matrix, new Matrix3());
  const gram = Matrix3.multiply(
    Matrix3.transpose(linear, new Matrix3()),
    linear,
    new Matrix3(),
  );
  const diagonal = Matrix3.computeEigenDecomposition(gram).diagonal;
  result.radius =
    sphere.radius *
    Math.sqrt(Math.max(diagonal[0], diagonal[4], diagonal[8], 0)) *
    (1 + 1e-14);
  return result;
}
export default { reverseProjection, affineHandedness, transformModelBounds };
