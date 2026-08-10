/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  /*
   * Transformers.js ships an `onnxruntime-node` binding alongside the WASM one. Nothing
   * in this demo runs the encoder on the server — it only ever runs in the worker — so
   * the package is kept out of the server bundle rather than being resolved and traced.
   */
  serverExternalPackages: ['@huggingface/transformers']
}

export default config
