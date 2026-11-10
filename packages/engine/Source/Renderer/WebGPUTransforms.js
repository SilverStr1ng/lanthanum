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
export function affineDeterminant(matrix) {
  if (
    !matrix ||
    !Array.from({ length: 16 }, (_, i) => matrix[i]).every(Number.isFinite) ||
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  ) {
    throw new Error("Model matrix must be finite and affine");
  }
  const determinant = Matrix3.determinant(
    Matrix4.getMatrix3(matrix, new Matrix3()),
  );
  if (Math.abs(determinant) < 1e-15) {
    throw new Error("Model matrix must be nonsingular");
  }
  return determinant;
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
export default { reverseProjection, affineDeterminant, transformModelBounds };
