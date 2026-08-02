/**
 * Fait résoudre à Node les imports sans extension, comme le fait le bundler.
 *
 * Node 24 exécute le TypeScript nativement, mais applique la résolution ESM
 * stricte : `import "./tcgdex"` échoue là où `tsc` et Next acceptent. Réécrire
 * tout `lib/` en `./tcgdex.ts` pour satisfaire le lanceur de tests aurait été
 * la queue qui remue le chien ; ce crochet de vingt lignes coûte moins cher, et
 * ne pèse que sur les tests.
 *
 * `module.registerHooks` est intégré à Node — la suite reste sans dépendance.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && path.extname(specifier) === "") {
      const from = context.parentURL
        ? path.dirname(fileURLToPath(context.parentURL))
        : process.cwd();

      for (const extension of EXTENSIONS) {
        if (existsSync(path.resolve(from, specifier + extension))) {
          return nextResolve(specifier + extension, context);
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
