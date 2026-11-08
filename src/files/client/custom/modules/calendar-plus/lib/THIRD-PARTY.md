# Calendar printing dependencies

These libraries are loaded only when printing a calendar. They run locally in the browser.

- pdf-lib 1.17.1: https://github.com/Hopding/pdf-lib (MIT; pdf-lib.LICENSE).
- html2canvas 1.4.1: https://github.com/niklasvh/html2canvas (MIT; html2canvas.LICENSE).

Versions are pinned in package.json and package-lock.json. npm install and the build
entry point generate these browser files and copy their licenses from node_modules.
Do not edit or commit the generated .min.js and .LICENSE files. jsLibs.json registers
their generated paths with Espo; it does not manage their dependencies.

The npm distributions are unchanged except for an outer wrapper that hides AMD's
`define` from their UMD detection, allowing Espo's library loader to read their browser exports.
Source-map directives are omitted because source maps are not included.
