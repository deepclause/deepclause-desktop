# swipl-wasm

SWI-Prolog WebAssembly build as a NPM package. Please see this page
for ongoing progress and information:
<https://swi-prolog.discourse.group/t/swi-prolog-in-the-browser-using-wasm/5650>

## Quickly Getting Started

The easiest way to get started is my importing swipl-wasm into your npm project.
It imported for both node and browser builds as follows:

script.mjs
```js
import SWIPL from "swipl-wasm";

async function main() {
  const swipl = await SWIPL({ arguments: ["-q"] });
  console.log(swipl.prolog.query("member(X, [a, b, c]).").once().X);
}

main();
```

For those who have not done this before you will first need to [install node and npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm).
After doing this you can make a new project as follows:

```bash
# Make the project directory
mkdir my-swipl-project && cd ./my-swipl-project
# Initialise the project
npm init
# Install swipl-wasm
npm i swipl-wasm
```

After this place the above code in `script.mjs` in the root of your directory and run `node script.mjs`
to run the script.

## Usage

In browser:

```html
<div id="solution"></div>
<script src="/dist/swipl/swipl-web.js"></script>
<script>
  (async () => {
    const swipl = await SWIPL({
      arguments: ["-q"],
      locateFile: (path) => {
        return `/dist/swipl/${path}`;
      },
    });
    const query = "member(X, [a, b, c]).";
    const solutionElement = document.getElementById("solution");
    const firstSolution = swipl.prolog.query(query).once().X;
    solutionElement.textContent = firstSolution;
  })();
</script>
```

The function `locateFile` will help the browser to find the necessary
files (`swipl-web.wasm` and `swipl-web.data`). In this case the files
should be served along with `swipl-web.js` under the `/dist/swipl`
directory in the web server.

You can run this example by executing `npm run test:serve-http` and
visiting <http://localhost:8080/examples/browser.html>.

In Nodejs:

```js
const SWIPL = require("swipl-wasm");

const swipl = await SWIPL({ arguments: ["-q"] });
console.log(swipl.prolog.query("member(X, [a, b, c]).").once().X);
```

You can run this example with `node examples/run-on-node.js`.

## Using single-file bundle

The `swipl-wasm` package comes also with the single-file bundle. This does not
require distributing the `.data` and `.wasm` files which are now embedded into
the `.js` file instead.

```html
<div id="solution"></div>
<script src="/dist/swipl/swipl-bundle.js"></script>
<script>
  (async () => {
    const swipl = await SWIPL({ arguments: ["-q"] });
    const query = "member(X, [a, b, c]).";
    const solutionElement = document.getElementById("solution");
    const firstSolution = swipl.prolog.query(query).once().X;
    solutionElement.textContent = firstSolution;
  })();
</script>
```

## Generating an image

Often you will want to bundle a pre-built image of your Prolog file. The easiest way to do this is using the `swipl-generate` command to generate the image. For example in `./examples/generation` the script: `swipl-generate ./max.pl ./dist/max.ts` will generate a file `./dist/max.ts` which contains the image of `./max.pl`. This file can then be imported into your project and used as follows:

```ts
import SWIPL from './max';

async function main() {
  const Module = await SWIPL();
  const res = Module.prolog.query('max(1, 2, 3).');
  console.log(res.next())
}

main();
```

Note that this procedure generates a file which imports directly from `swipl-wasm/dist/loadImageDefault`, so make sure that `swipl-wasm` is a direct dependency in your project rather than a dev dependency.

To generate the image data without it pre-loaded into `SWIPL` use the `--image-only` flag.

## Running JavaScript from Prolog

This uses `eval`:

```js
swipl.prolog
  .query("js_run_script(Script)", {
    Script: `console.log('hello')`,
  })
  .once();
```

## Using with Webpack

[Webpack](https://webpack.js.org/) is a JavaScript and resources
bundler for large-scale frontend projects.

There is an example Webpack project in `examples/webpack`. It uses
[Asset Modules](https://webpack.js.org/guides/asset-modules/) to "load"
necessary `.data` and `.wasm` files. The location of these files and then
fed to `locateFile` (see above).

The package `swipl-wasm` is linked into the example. In an actual project
you would declare `swipl-wasm` as a normal dependency.

To start the example:

```
cd examples/webpack
npm install
npm build
npm run server
```

and visit <http://127.0.0.1:8080>. You should see the message "Hello world from
Prolog".


## Browser Builds

For convenience we provide deploy bundled versions of the SWI-Prolog on github pages which can be directly used in an HTML document.

There is a bundled version for each release - which can be found at the url:
<p align=center>
https://SWI-Prolog.github.io/npm-swipl-wasm/vMajor/vMinor/vPatch/index.js

for instance v3.3.0 has the url https://SWI-Prolog.github.io/npm-swipl-wasm/3/3/0/index.js. We also have shortcuts for:
 - the latest version https://SWI-Prolog.github.io/npm-swipl-wasm/latest/index.js,
 - the latest of each major version https://SWI-Prolog.github.io/npm-swipl-wasm/vMajor/latest/index.js, and
 - the latest of each minor version https://SWI-Prolog.github.io/npm-swipl-wasm/vMajor/vMinor/latest/index.js

Available versions can be browsed at https://github.com/SWI-Prolog/npm-swipl-wasm/tree/pages.

With this approach the following script will work

```html
<div id="solution"></div>
<script src="https://SWI-Prolog.github.io/npm-swipl-wasm/3/3/0/index.js"></script>
<script>
  (async () => {
    const swipl = await SWIPL({ arguments: ["-q"] });
    const query = "member(X, [a, b, c]).";
    const solutionElement = document.getElementById("solution");
    const firstSolution = swipl.prolog.query(query).once().X;
    solutionElement.textContent = firstSolution;
  })();
</script>
```

Dynamic imports are also available with the `dynamic-import.js` import name and can be used as follows:

```html
<div id="solution"></div>
<script>
  (async () => {
    const { SWIPL } = await import("https://SWI-Prolog.github.io/npm-swipl-wasm/3/3/0/dynamic-import.js");
    const swipl = await SWIPL({ arguments: ["-q"] });
    const query = "member(X, [a, b, c]).";
    const solutionElement = document.getElementById("solution");
    const firstSolution = swipl.prolog.query(query).once().X;
    solutionElement.textContent = firstSolution;
  })();
</script>
```

## Build

The package can be built using npm. Please use npm to
add new dependencies and update package-lock.json file. SWI-Prolog WebAssembly
version is currently built inside Docker with Emscripten.

### Development

To develop with this package, clone the repository and run:

```
# Install dependencies
npm ci
# Build the WebAssembly
npm run build
# Run tests
npm t
```

*Note* You need Docker and Node 16 or higher to installed build the package.

## Versioning

The package uses its own versioning scheme using semver. It is
detached from the versioning of SWI-Prolog itself.

To get the underlying SWI-Prolog version:

```js
const swipl = await SWIPL({ arguments: ["-q"] });
const version = swipl.prolog
  .query("current_prolog_flag(version, Version)")
  .once().Version;
```

The version is returned as integer `10000 × Major + 100 × Minor + Patch`.

## TODO

- Integrate with SWI-Prolog CI
- TypeScript types for Prolog.js (and the Query interface)
- Use EcmaScript modules as output:
  <https://github.com/emscripten-core/emscripten/issues/11792>

## License

Same as SWI-Prolog license, BSD simplified:
<https://github.com/SWI-Prolog/swipl-devel/blob/master/LICENSE>
