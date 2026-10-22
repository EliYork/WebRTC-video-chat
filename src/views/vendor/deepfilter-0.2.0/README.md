# Pinned DeepFilterNet3 browser processor

`processor.js` is copied without modification from
`@workadventure/noise-suppression@0.2.0`,
`dist/assets/deepfilternet-worklet-processor.js`.

- Upstream: https://github.com/workadventure/noise-suppression
- Source commit: `7e00a1b7522f044a31776fddc249a97a98de94ed`
- npm tarball integrity: `sha512-lNHmmOiMnWaLWK6hKBsYi/dC/L7lFspYMitWAhk2SXS7QFgHtizeT+4hTDvFDd3MHW+cvSb+Y4nhtQs7xQ5hrw==`
- The wrapper license is in `LICENSE` (MIT).
- The matching WASM and model are in `../../wasm/deepfilter-0.2.0/`.
  That directory includes the upstream libDF MIT and Apache license texts.
- libDF source: https://github.com/Rikorose/DeepFilterNet at
  `d375b2d8309e0935d165700c91da9de862a99c31`, patched and built by
  the wrapper's `scripts/build-deepfilternet-wasm.sh` and
  `scripts/deepfilternet-tract-0.23.patch` (tract 0.23.8, wasm SIMD).
- The model is the upstream `models/DeepFilterNet3_onnx.tar.gz`,
  supplied separately to `df_create`, rather than embedded in WASM.

`manifest.json` records source provenance and SHA256/size for all copied
runtime and license files. `tests/deepfilter_engine_test.mjs` verifies it
and runs the actual WASM through the shipped processor.

To reproduce: `npm pack @workadventure/noise-suppression@0.2.0 --ignore-scripts`
in a temporary directory, verify the tarball integrity above, and copy only
the three matching runtime files. The libDF license files come from
`forks/deepfilternet/` at the pinned wrapper commit. Do not install or copy
the entire 152 MB package, or overwrite the existing RNNoise vendor files.

The application adapter loads these local assets only when requested. It
uses one private AudioContext per model instance so closing it releases the
model's WASM memory; the call keeps its existing output track. Serving the
model must preserve the `.tar.gz` bytes (no `Content-Encoding: gzip` on the
already compressed archive). Content hashes are checked before compilation.
