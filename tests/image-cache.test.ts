/**
 * Le proxy d'images ne doit relayer que les hôtes prévus : c'est la seule règle
 * de `lib/image-cache.ts` qui se teste sans disque ni réseau.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeImageUrl } from "../lib/image-cache.ts";

describe("safeImageUrl", () => {
  it("accepte TCGdex et les deux CDN de TCGplayer", () => {
    for (const url of [
      "https://assets.tcgdex.net/fr/base/base1/4/low.webp",
      "https://product-images.tcgplayer.com/fit-in/437x437/587758.jpg",
      "https://tcgplayer-cdn.tcgplayer.com/product/587758_in_1000x1000.jpg",
    ]) {
      assert.equal(safeImageUrl(url)?.href, url);
    }
  });

  it("refuse tout autre hôte, et le HTTP en clair", () => {
    assert.equal(safeImageUrl("https://example.com/carte.jpg"), null);
    assert.equal(safeImageUrl("http://assets.tcgdex.net/fr/base/base1/4/low.webp"), null);
    assert.equal(safeImageUrl("pas une url"), null);
  });
});
