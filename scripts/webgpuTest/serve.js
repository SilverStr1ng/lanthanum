import { serve } from "../webgpuBaseline/server.js";

const { url } = await serve();
console.log(`Lanthanum WebGPU: ${url}/Apps/WebGPU/index.html`);
