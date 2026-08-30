import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_HIDDEN, pruneHidden } from "../lib/store.ts";

const NOW = 1_700_000_000_000;

/** `count` masquages datés, du plus ancien au plus récent. */
function hidden(count: number): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`vinted:${index}`, NOW + index]),
  );
}

describe("pruneHidden", () => {
  it("laisse tel quel ce qui tient sous le plafond", () => {
    const kept = hidden(3);
    assert.equal(pruneHidden(kept), kept);
  });

  it("garde les masquages les plus récents", () => {
    const pruned = pruneHidden(hidden(MAX_HIDDEN + 2));
    assert.equal(Object.keys(pruned).length, MAX_HIDDEN);
    // Les deux premiers, les plus anciens, sont ceux qui sautent.
    assert.equal("vinted:0" in pruned, false);
    assert.equal("vinted:1" in pruned, false);
    assert.equal(`vinted:${MAX_HIDDEN + 1}` in pruned, true);
  });
});
