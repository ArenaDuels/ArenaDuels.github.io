# three.js (local copy)

`three.module.min.js` is the unmodified `build/three.module.min.js` from the **three@0.160.0** npm
package (MIT licence, see `LICENSE`). The game loads it from here instead of from a CDN, so it
works without unpkg.com being reachable and can't change underneath you.

Only the core library is used (nothing from `three/examples`).

## Updating to another version

```
npm pack three@<version>
tar -xzf three-<version>.tgz
cp package/build/three.module.min.js vendor/three/
cp package/LICENSE vendor/three/
```

Then check the game still runs: three.js changes things between versions (r171 and later also
split the library into two files, `three.module.js` plus `three.core.js`, which both have to be
copied). The version being used is whatever `REVISION` says in that file.
