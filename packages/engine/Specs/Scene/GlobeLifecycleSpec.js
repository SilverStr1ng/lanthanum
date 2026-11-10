import { Cartesian2, Cartesian3, defined } from "@cesium/core";
import { Globe } from "../../index.js";
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

    it("releases terrain GPU objects when a rendered globe is destroyed", function () {
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
        scene.destroyForSpecs();
        scene = undefined;
        const resources = ledger.snapshot();
        for (const [kind, count] of Object.entries(resources.live)) {
          expect(count).withContext(kind).toBe(0);
        }
        expect(resources.bufferBytes).toBe(0);
      });
    });
  },
  "WebGL",
);
