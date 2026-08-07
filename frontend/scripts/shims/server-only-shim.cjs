/* eslint-disable @typescript-eslint/no-require-imports -- CJS preload shim, runs under plain node */
// Allows running server-only app modules under tsx outside Next (scripts only).
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'server-only') return require.resolve('./empty.cjs');
  return orig.call(this, request, ...args);
};
