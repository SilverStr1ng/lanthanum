import test from "node:test";
import assert from "node:assert/strict";
import instrumentWebGL from "../../Specs/Baseline/instrumentWebGL.js";

test("buffer ledger respects WebGL2 remainder and byte-view overloads without changing arguments", () => {
  const forwarded = [];
  const gl = new Proxy(
    { bufferData: (...args) => forwarded.push(args) },
    {
      get(target, name) {
        return target[name] ?? (() => ({}));
      },
    },
  );
  const ledger = instrumentWebGL(gl);
  const buffer = gl.createBuffer();
  gl.bindBuffer(34962, buffer);
  const typed = new Float32Array(10);
  gl.bufferData(34962, typed, 35044, 6, 0);
  assert.equal(ledger.snapshot().bufferBytes, 16);
  assert.deepEqual(forwarded.at(-1), [34962, typed, 35044, 6, 0]);
  const bytes = new DataView(new ArrayBuffer(10));
  gl.bufferData(34962, bytes, 35044, 2, 3);
  assert.equal(ledger.snapshot().bufferBytes, 3);
  gl.bufferData(34962, bytes, 35044, 2);
  assert.equal(ledger.snapshot().bufferBytes, 8);
  gl.bufferData(34962, 64, 35044);
  assert.equal(ledger.snapshot().bufferBytes, 64);
  assert.equal(forwarded.at(-1).length, 3);
  gl.deleteBuffer(buffer);
  assert.equal(ledger.snapshot().bufferBytes, 0);
});
