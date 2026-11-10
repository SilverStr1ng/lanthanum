import {
  BoundingSphere,
  Cartesian3,
  DeveloperError,
  Intersect,
  Matrix4,
} from "@cesium/core";
import TaskProcessor from "../Core/TaskProcessor.js";
import Appearance from "./Appearance.js";
import Material from "./Material.js";
import MaterialAppearance from "./MaterialAppearance.js";
import PerInstanceColorAppearance from "./PerInstanceColorAppearance.js";
import PrimitivePipeline from "./PrimitivePipeline.js";

function equalState(a, b) {
  if (a === b) {
    return true;
  }
  return (
    !!a &&
    !!b &&
    typeof a === "object" &&
    typeof b === "object" &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => equalState(a[key], b[key]))
  );
}

function validateAppearance(appearance) {
  const options = {
    flat: appearance.flat,
    closed: appearance.closed,
    translucent: appearance.translucent,
    faceForward: appearance.faceForward,
  };
  let standard;
  if (appearance instanceof PerInstanceColorAppearance) {
    standard = new PerInstanceColorAppearance(options);
  } else if (
    appearance instanceof MaterialAppearance &&
    appearance.material?.type === "Color"
  ) {
    standard = new MaterialAppearance({
      ...options,
      materialSupport: appearance.materialSupport,
      material: appearance.material,
    });
    const colorMaterial = Material.fromType("Color");
    if (appearance.material.shaderSource !== colorMaterial.shaderSource) {
      throw new DeveloperError(
        "Native Primitive does not support custom material shaders.",
      );
    }
  } else {
    throw new DeveloperError(
      "Native Primitive supports PerInstanceColorAppearance and MaterialAppearance with Color material.",
    );
  }
  if (
    appearance.vertexShaderSource !== standard.vertexShaderSource ||
    appearance.fragmentShaderSource !== standard.fragmentShaderSource ||
    !equalState(
      appearance.renderState,
      Appearance.getDefaultRenderState(
        appearance.translucent,
        appearance.closed,
      ),
    )
  ) {
    throw new DeveloperError(
      "Native Primitive does not support custom GLSL or renderState.",
    );
  }
}

function createSubTask(geometry) {
  const task = {
    geometry,
    moduleName: geometry._workerName,
    modulePath: geometry._workerPath,
  };
  if (geometry.constructor.pack) {
    task.geometry = new Float64Array(
      geometry.constructor.packedLength ?? geometry.packedLength,
    );
    geometry.constructor.pack(geometry, task.geometry, 0);
    task.offset = 0;
  } else if (!geometry.attributes?.position) {
    throw new DeveloperError(
      "Geometry must provide a worker or computed positions.",
    );
  }
  return task;
}

/** Per-instance native resources behind the standard Primitive API. */
class WebGPUPrimitive {
  constructor(primitive, scene) {
    if (primitive._va.length) {
      throw new DeveloperError(
        "A Primitive cannot be shared across rendering backends.",
      );
    }
    this.primitive = primitive;
    this.scene = scene;
    this.records = [];
    this.destroyed = false;
    this.instances = primitive.geometryInstances
      ? Array.isArray(primitive.geometryInstances)
        ? primitive.geometryInstances
        : [primitive.geometryInstances]
      : [];
    scene._nativePrimitives.add(this);
  }
  update(frameState) {
    const primitive = this.primitive,
      scene = this.scene;
    if (frameState.webgpuScene !== scene) {
      throw new DeveloperError(
        "A native Primitive cannot be shared between scenes.",
      );
    }
    if (this.error) {
      throw this.error;
    }
    if (!primitive.appearance) {
      return;
    }
    if (
      primitive.depthFailAppearance ||
      primitive.rtcCenter ||
      primitive.debugShowBoundingVolume
    ) {
      throw new DeveloperError(
        "Native Primitive does not support depthFailAppearance, rtcCenter or debug bounding volumes.",
      );
    }
    validateAppearance(primitive.appearance);
    if (!this.started) {
      if (primitive.asynchronous && this.instances.length) {
        scene._geometryTaskProcessor ??= new TaskProcessor("createGeometry", 2);
        const subTasks = this.instances.map((instance) =>
          createSubTask(instance.geometry),
        );
        const transferable = subTasks
          .filter((task) => task.offset !== undefined)
          .map((task) => task.geometry.buffer);
        const promise = scene._geometryTaskProcessor.scheduleTask(
          { subTasks },
          transferable,
        );
        if (!promise) {
          return;
        }
        this.started = true;
        promise
          .then((result) => {
            if (!this.destroyed) {
              this.geometries =
                PrimitivePipeline.unpackCreateGeometryResults(result);
            }
          })
          .catch((error) => {
            if (!this.destroyed) {
              this.error = error;
            }
          });
      } else {
        this.geometries = this.instances.map((instance) =>
          instance.geometry.attributes
            ? instance.geometry
            : instance.geometry.constructor.createGeometry(instance.geometry),
        );
        this.started = true;
      }
    }
    if (this.geometries) {
      try {
        this.geometries.forEach((geometry, index) => {
          if (geometry) {
            this.upload(geometry, this.instances[index]);
          }
        });
      } catch (error) {
        this.destroy();
        this.error = error;
        throw error;
      }
      this.geometries = undefined;
      this.instances = undefined;
      if (primitive.releaseGeometryInstances) {
        primitive.geometryInstances = undefined;
      }
      frameState.afterRender.push(() => {
        if (!this.destroyed) {
          primitive._ready = true;
        }
      });
    }
    if (!primitive.show) {
      return;
    }
    const appearance = primitive.appearance;
    for (const record of this.records) {
      if (record.attributes.show?.[0] === 0) {
        continue;
      }
      const mesh = record.mesh;
      const color = appearance.material?.uniforms.color;
      if (color) {
        mesh.color = [color.red, color.green, color.blue, color.alpha];
      } else {
        const value = record.attributes.color;
        if (!value) {
          throw new DeveloperError(
            "PerInstanceColorAppearance requires a color instance attribute.",
          );
        }
        mesh.color = Array.from(value, (v) => v / 255);
      }
      if (
        !mesh.color.every(Number.isFinite) ||
        mesh.color.some((v) => v < 0 || v > 1)
      ) {
        throw new DeveloperError(
          "Native Primitive color components must be in [0,1].",
        );
      }
      if (mesh.color[3] === 0) {
        continue;
      }
      if (!appearance.flat && !record.hasNormals) {
        throw new DeveloperError(
          "Lit native Primitive geometry requires normal attributes; use flat:true for points and lines.",
        );
      }
      mesh.flags = [
        0,
        Number(!appearance.flat),
        0,
        Number(appearance.faceForward),
      ];
      mesh.blend = appearance.isTranslucent();
      mesh.twoPasses =
        appearance.closed && mesh.blend && mesh.topology === "triangle-list";
      mesh.cull = appearance.closed ? "back" : "none";
      Matrix4.multiply(
        primitive.modelMatrix,
        record.instanceMatrix,
        record.worldMatrix,
      );
      BoundingSphere.transform(
        record.sphere,
        record.worldMatrix,
        record.worldSphere,
      );
      if (
        primitive.cull &&
        frameState.cullingVolume.computeVisibility(record.worldSphere) ===
          Intersect.OUTSIDE
      ) {
        continue;
      }
      Matrix4.multiply(record.worldMatrix, record.origin, mesh.modelMatrix);
      record.lastFrame = frameState.frameNumber;
      record.distance = Cartesian3.distanceSquared(
        record.worldSphere.center,
        frameState.camera.positionWC,
      );
      frameState.nativeCommands.push(record);
    }
  }
  upload(geometry, instance) {
    const positions = geometry.attributes.position?.values,
      normals = geometry.attributes.normal?.values,
      uv = geometry.attributes.st?.values;
    if (
      !positions?.length ||
      positions.length % 3 ||
      !positions.every(Number.isFinite)
    ) {
      throw new DeveloperError(
        "Native geometry requires finite xyz positions.",
      );
    }
    const topology = { 0: "point-list", 1: "line-list", 4: "triangle-list" }[
      geometry.primitiveType
    ];
    if (!topology) {
      throw new DeveloperError(
        "Native Primitive supports POINTS, LINES and TRIANGLES; expand strip/fan geometry first.",
      );
    }
    const count = positions.length / 3,
      indices =
        geometry.indices ?? Uint32Array.from({ length: count }, (_, i) => i);
    const group =
      geometry.primitiveType === 4 ? 3 : geometry.primitiveType === 1 ? 2 : 1;
    if (
      indices.length === 0 ||
      indices.length % group ||
      !indices.every((i) => Number.isInteger(i) && i >= 0 && i < count)
    ) {
      throw new DeveloperError("Invalid native geometry indices.");
    }
    for (const name of Object.keys(instance.attributes ?? {})) {
      if (!["color", "show"].includes(name)) {
        throw new DeveloperError(
          `Native Primitive instance attribute ${name} is not supported.`,
        );
      }
    }
    const origin = Cartesian3.fromArray(positions),
      vertices = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) {
      vertices.set(
        [
          positions[i * 3] - origin.x,
          positions[i * 3 + 1] - origin.y,
          positions[i * 3 + 2] - origin.z,
          uv?.[i * 2] ?? 0,
          uv?.[i * 2 + 1] ?? 0,
          normals?.[i * 3] ?? 0,
          normals?.[i * 3 + 1] ?? 0,
          normals?.[i * 3 + 2] ?? 1,
        ],
        i * 8,
      );
    }
    const scene = this.scene;
    if (scene._nextObjectId > 0xffffffff) {
      throw new DeveloperError("Native object ID capacity exceeded.");
    }
    const mesh = scene._renderer.createMesh(vertices, indices, new Matrix4());
    mesh.topology = topology;
    mesh.objectId = this.primitive.allowPicking ? scene._nextObjectId++ : 0;
    const attributes = {};
    for (const [name, attribute] of Object.entries(instance.attributes ?? {})) {
      let value = new Uint8Array(attribute.value);
      Object.defineProperty(attributes, name, {
        enumerable: true,
        get: () => value,
        set: (next) => {
          if (
            !next ||
            next.length !== value.length ||
            !Array.from(next).every(
              (n) => Number.isFinite(n) && n >= 0 && n <= 255,
            )
          ) {
            throw new DeveloperError(`Invalid instance ${name}.`);
          }
          value = new Uint8Array(next);
        },
      });
    }
    const record = {
      adapter: this,
      mesh,
      attributes,
      id: instance.id,
      hasNormals: !!normals,
      origin: Matrix4.fromTranslation(origin),
      instanceMatrix: Matrix4.clone(instance.modelMatrix),
      worldMatrix: new Matrix4(),
      sphere: geometry.boundingSphere ?? BoundingSphere.fromVertices(positions),
      worldSphere: new BoundingSphere(),
    };
    Object.defineProperty(attributes, "boundingSphere", {
      get: () => BoundingSphere.clone(record.worldSphere),
    });
    this.records.push(record);
    if (mesh.objectId !== 0) {
      scene._pickObjects.set(mesh.objectId, record);
    }
  }
  getAttributes(id) {
    if (id === undefined) {
      throw new DeveloperError("id is required");
    }
    if (!this.primitive.ready) {
      throw new DeveloperError(
        "Primitive must be ready before accessing instance attributes.",
      );
    }
    return this.records.find((record) => record.id === id)?.attributes;
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const record of this.records) {
      this.scene._renderer.destroyMesh(record.mesh);
      this.scene._pickObjects.delete(record.mesh.objectId);
    }
    this.records.length = 0;
    this.instances = this.geometries = undefined;
    this.scene._nativePrimitives.delete(this);
  }
}
export default WebGPUPrimitive;
