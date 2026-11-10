// Additional S01 subcases use the same real scene, ledger, and failure gate.
async function frames(count = 3) {
  for (let i = 0; i < count; i++) {
    await new Promise(requestAnimationFrame);
  }
}

function readPixel(h, point) {
  h.render();
  const pixel = new Uint8Array(4);
  h.gl.readPixels(
    Math.floor(point.x),
    h.height - 1 - Math.floor(point.y),
    1,
    1,
    h.gl.RGBA,
    h.gl.UNSIGNED_BYTE,
    pixel,
  );
  h.record("pixel read has no GL error", h.gl.getError() === h.gl.NO_ERROR);
  return [...pixel];
}

async function imageryLayers(h) {
  const { C, scene, until, record } = h;
  h.globe();
  await until(h.imageryReady, "base imagery");
  const point = new C.Cartesian2(h.width / 2 + 31, h.height / 2 + 23);
  const base = readPixel(h, point);
  const layers = scene.globe.imageryLayers;
  const red = layers.addImageryProvider(
    await C.SingleTileImageryProvider.fromUrl("/fixtures/generated/red.png"),
  );
  const green = layers.addImageryProvider(
    await C.SingleTileImageryProvider.fromUrl("/fixtures/generated/green.png"),
  );
  async function settled() {
    await frames();
    await until(
      () =>
        h.imageryReady() &&
        scene.globe._surface._tilesToRender.every((tile) =>
          [red, green]
            .filter((layer) => layers.contains(layer) && layer.alpha > 0)
            .every((layer) =>
              tile.data.imagery.some(
                (item) =>
                  item.readyImagery?.state === 4 &&
                  item.readyImagery.imageryLayer === layer,
              ),
            ),
        ),
      "every visible imagery layer READY",
    );
  }
  function color(name, expected) {
    const actual = readPixel(h, point);
    record(
      name,
      expected.every((value, i) => Math.abs(actual[i] - value) <= 3),
      { actual, expected },
    );
  }
  await settled();
  color("top green layer", [0, 255, 0]);
  layers.lowerToBottom(green);
  await settled();
  color("lower green exposes red", [255, 0, 0]);
  layers.raiseToTop(green);
  green.alpha = 0.5;
  await settled();
  color("half green composites over red", [128, 128, 0]);
  green.alpha = 0;
  red.alpha = 0;
  await settled();
  color("zero alpha restores numbered imagery", base.slice(0, 3));
  record("remove green layer", layers.remove(green));
  red.alpha = 1;
  await settled();
  color("removed layer leaves red", [255, 0, 0]);
  record("remove red layer", layers.remove(red));
  await settled();
  color("remove restores numbered imagery", base.slice(0, 3));
}

async function dateline(h) {
  const { C, scene, until, record } = h;
  h.globe();
  await until(h.imageryReady, "initial imagery");
  const initialLevel = Math.max(
    ...scene.globe._surface._tilesToRender.map((tile) => tile.level),
  );
  for (const longitude of [179, -179]) {
    scene.camera.setView({
      destination: C.Cartesian3.fromDegrees(longitude, 20, 2000000),
    });
    await frames();
    await until(h.imageryReady, `dateline ${longitude} imagery`);
    const selected = scene.globe._surface._tilesToRender;
    const level = Math.max(...selected.map((tile) => tile.level));
    record(`dateline ${longitude} refines LOD`, level > initialLevel, {
      initialLevel,
      level,
    });
    record(
      `dateline ${longitude} selects both hemispheres`,
      selected.some((tile) => tile.rectangle.west > 0) &&
        selected.some((tile) => tile.rectangle.east < 0),
    );
    const actual = C.Math.toDegrees(
      scene.camera.positionCartographic.longitude,
    );
    record(
      `dateline ${longitude} camera`,
      Math.abs(actual - longitude) < 1e-8,
      { actual },
    );
    const pixel = readPixel(
      h,
      new C.Cartesian2(h.width / 2 + 31, h.height / 2 + 23),
    );
    record(
      `dateline ${longitude} visible imagery`,
      pixel.slice(0, 3).every((value) => value > 20),
      { pixel },
    );
  }
}

async function attachDataSource(h, source) {
  const { C, scene } = h;
  const collection = new C.DataSourceCollection();
  const display = new C.DataSourceDisplay({
    scene,
    dataSourceCollection: collection,
  });
  // Dispose visualizers before their Scene/context, including pending primitives.
  h.cleanup.push(() => {
    display.destroy();
    collection.destroy();
  });
  await collection.add(source);
  let updated = false;
  h.updates.push((time) => {
    updated = display.update(time);
  });
  return async () => {
    await frames();
    // display.ready is sticky; the update return value reflects the current work.
    await h.until(() => updated, "data source visualizers ready");
    h.render();
  };
}

function screenPoint(h, world) {
  return h.C.SceneTransforms.worldToWindowCoordinates(h.scene, world);
}

async function assertPick(h, name, point, expected) {
  const result = await h.scene.pickAsync(point);
  h.record(name, result?.id === expected, {
    actual: result?.id?.id,
    expected: expected?.id,
  });
}

async function dynamicEntity(h, geometry = "point") {
  const { C, scene, time, record } = h;
  h.view(600, 0, -Math.PI / 2);
  const start = C.JulianDate.clone(time);
  const end = C.JulianDate.addSeconds(start, 10, new C.JulianDate());
  const world = (x) =>
    C.Matrix4.multiplyByPoint(
      h.transform,
      new C.Cartesian3(x, 0, 60),
      new C.Cartesian3(),
    );
  const position = new C.SampledPositionProperty();
  position.addSample(start, world(-100));
  position.addSample(end, world(100));
  const source = new C.CustomDataSource("dynamic");
  const entity = source.entities.add({
    id: `moving-${geometry}`,
    position,
    ...(geometry === "box"
      ? {
          box: {
            dimensions: new C.Cartesian3(60, 60, 80),
            material: C.Color.RED,
          },
        }
      : {
          point: { pixelSize: 60, color: C.Color.RED },
        }),
  });
  const settle = await attachDataSource(h, source);
  await settle();
  const oldPoint = screenPoint(h, world(-100));
  const first = readPixel(h, oldPoint);
  record("Entity red material rendered", first[0] > 100 && first[1] < 5, {
    first,
  });
  if (geometry === "box") {
    record(
      "dynamic box synchronous pick control",
      scene.pick(oldPoint)?.id === entity,
    );
  }
  await assertPick(h, "Entity at first sample", oldPoint, entity);
  C.JulianDate.clone(end, time);
  if (geometry === "box") {
    entity.box.material = C.Color.LIME;
  } else {
    entity.point.color = C.Color.LIME;
  }
  await settle();
  const point = screenPoint(h, world(100));
  await assertPick(h, "Entity at second sample", point, entity);
  await assertPick(h, "Entity leaves first sample", oldPoint, undefined);
  const second = readPixel(h, point);
  record("Entity material update rendered", second[1] > 100 && second[0] < 5, {
    second,
  });
  entity.show = false;
  await settle();
  await assertPick(h, "hidden Entity not pickable", point, undefined);
  record(
    "hidden Entity pixels cleared",
    readPixel(h, point)
      .slice(0, 3)
      .every((value) => value === 0),
  );
  entity.show = true;
  await settle();
  await assertPick(h, "shown Entity pickable again", point, entity);
  record("one Entity throughout updates", source.entities.values.length === 1);
  // The final sample time (12:00:10Z) is intentionally retained in the report.
}

async function dataSource(h, kind) {
  const { C, scene, record } = h;
  h.view(700, 0, -Math.PI / 2);
  const sources = {
    geojson: () =>
      C.GeoJsonDataSource.load("/fixtures/generated/business.geojson", {
        fill: C.Color.CYAN,
        stroke: C.Color.YELLOW,
        strokeWidth: 6,
        markerColor: C.Color.ORANGE,
        clampToGround: false,
      }),
    czml: () => C.CzmlDataSource.load("/fixtures/generated/business.czml"),
    kml: () =>
      C.KmlDataSource.load("/fixtures/generated/business.kml", {
        camera: scene.camera,
        canvas: scene.canvas,
        clampToGround: false,
      }),
  };
  const source = await sources[kind]();
  const settle = await attachDataSource(h, source);
  await settle();
  const targets =
    kind === "geojson"
      ? [
          ["area", -75.001, 40, 40],
          ["route", -75, 40, 60],
          ["point", -74.999, 40, 60],
        ]
      : [["area", -75, 40, 40]];
  record(
    `${kind} entity count`,
    source.entities.values.length === targets.length,
    { count: source.entities.values.length },
  );
  for (const [id, lon, lat, altitude] of targets) {
    const entity = source.entities.getById(id);
    record(`${kind} ${id} loaded`, !!entity);
    const point = screenPoint(h, C.Cartesian3.fromDegrees(lon, lat, altitude));
    await assertPick(h, `${kind} ${id} rendered and pickable`, point, entity);
    const pixel = readPixel(h, point);
    record(
      `${kind} ${id} visible pixels`,
      pixel.slice(0, 3).some((value) => value > 100),
      { pixel },
    );
  }
  source.show = false;
  await settle();
  for (const [, lon, lat, altitude] of targets) {
    await assertPick(
      h,
      `${kind} source hidden`,
      screenPoint(h, C.Cartesian3.fromDegrees(lon, lat, altitude)),
      undefined,
    );
  }
  source.show = true;
  await settle();
  for (const [id, lon, lat, altitude] of targets) {
    await assertPick(
      h,
      `${kind} source shown`,
      screenPoint(h, C.Cartesian3.fromDegrees(lon, lat, altitude)),
      source.entities.getById(id),
    );
  }
}

export const extendedScenarios = {
  "T01-layers": imageryLayers,
  "T01-dateline": dateline,
  "T05-entity": dynamicEntity,
  "T05-entity-box": (h) => dynamicEntity(h, "box"),
  "T05-geojson": (h) => dataSource(h, "geojson"),
  "T05-czml": (h) => dataSource(h, "czml"),
  "T05-kml": (h) => dataSource(h, "kml"),
};
