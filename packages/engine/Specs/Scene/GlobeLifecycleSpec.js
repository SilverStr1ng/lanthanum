import { Cartesian2, Cartesian3, defined } from "@cesium/core";
import { Globe, TerrainFillMesh } from "../../index.js";
import createCanvas from "../../../../Specs/createCanvas.js";
import createScene from "../../../../Specs/createScene.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";
import instrumentWebGL from "../../../../Specs/Baseline/instrumentWebGL.js";

describe(
  "Scene/GlobeLifecycle",
  function () {
    let scene;

    afterEach(function () {
      if (defined(scene) && !scene.isDestroyed()) {
        scene.destroyForSpecs();
      }
    });

    it("destroys a globe before its first frame", function () {
      scene = createScene();
      scene.globe = new Globe();
      const surface = scene.globe._surface;
      scene.destroyForSpecs();
      scene = undefined;
      expect(surface.isDestroyed()).toBe(true);
    });

    function expectGlobeResourcesReleased(beforeDestroy) {
      if (window.webglStub) {
        pending("The GPU resource ledger requires a real WebGL2 context.");
      }
      const canvas = createCanvas(64, 64);
      const gl = canvas.getContext("webgl2", { antialias: false });
      const ledger = instrumentWebGL(gl);
      scene = createScene({ canvas: canvas });
      scene.msaaSamples = 1;
      scene.globe = new Globe();
      scene.globe.showGroundAtmosphere = false;
      scene.camera.setView({
        destination: Cartesian3.fromDegrees(-75, 40, 18000000),
      });
      const ray = scene.camera.getPickRay(new Cartesian2(32, 32));

      return pollToPromise(function () {
        scene.renderForSpecs();
        return scene.globe.tilesLoaded && defined(scene.globe.pick(ray, scene));
      }).then(function () {
        expect(ledger.snapshot().live.Buffer).toBeGreaterThan(0);
        if (defined(beforeDestroy)) {
          beforeDestroy(scene.globe._surface.tileProvider);
        }
        scene.destroyForSpecs();
        scene = undefined;
        const resources = ledger.snapshot();
        for (const [kind, count] of Object.entries(resources.live)) {
          expect(count).withContext(kind).toBe(0);
        }
        expect(resources.bufferBytes).toBe(0);
      });
    }

    it("releases terrain GPU objects when a rendered globe is destroyed", function () {
      return expectGlobeResourcesReleased();
    });

    it("releases retired fill meshes before the next frame", function () {
      return expectGlobeResourcesReleased(function (provider) {
        const tile = scene.globe._surface._tilesToRender[0];
        const fill = (tile.data.fill = new TerrainFillMesh(tile));
        fill.update(provider, scene.frameState);
        const vertexArray = fill.vertexArray;
        // Match replacement by real terrain: retire the fill and drop its reference.
        tile.data.fill = fill.destroy(provider._vertexArraysToDestroy);
        expect(provider._vertexArraysToDestroy).toContain(vertexArray);
        expect(vertexArray.isDestroyed()).toBe(false);
        // Destroy immediately, without a further provider.initialize() drain.
      });
    });
  },
  "WebGL",
);
