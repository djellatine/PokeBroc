/**
 * La normalisation d'un article Vinted, telle que le catalogue de
 * septembre 2026 le rend : liens relatifs, marque et état dans la vignette,
 * vendeur sans page de profil. Sans réseau ni session.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapVintedItem, type RawVintedItem } from "../lib/vinted.ts";

/** Un article du catalogue `svc-catalogue/items`, relevé le 20 septembre 2026. */
function raw(overrides: Partial<RawVintedItem> = {}): RawVintedItem {
  return {
    id: 9982430131,
    title: "Dracaufeu 4/102 Base Set",
    url: "/items/9982430131-dracaufeu-4102-base-set",
    photo: {
      url: "https://images1.vinted.net/t/03_01443/f800/54bba004.webp",
      thumbnails: [
        { type: "thumb150x210", url: "https://images1.vinted.net/t/03_01443/150x210/54bba004.webp" },
        { type: "thumb310x430", url: "https://images1.vinted.net/t/03_01443/310x430/54bba004.webp" },
      ],
      high_resolution: { id: "03_01443" } as { timestamp?: number },
    },
    price: { amount: "45.00", currency_code: "EUR" },
    total_item_price: { amount: "47.95", currency_code: "EUR" },
    service_fee: { amount: "2.95", currency_code: "EUR" },
    item_box: { first_line: "Pokémon", second_line: "Très bon état" },
    favourite_count: 3,
    view_count: 41,
    promoted: false,
    user: { id: 309389028, login: "pokedan267", business: false },
    ...overrides,
  };
}

describe("mapVintedItem", () => {
  it("rend le lien absolu, la marque et l'état lus dans la vignette", () => {
    const item = mapVintedItem(raw());
    assert.equal(item.url, "https://www.vinted.fr/items/9982430131-dracaufeu-4102-base-set");
    assert.equal(item.brand, "Pokémon");
    assert.equal(item.status, "Très bon état");
    assert.equal(item.price, 45);
    assert.equal(item.totalPrice, 47.95);
    assert.equal(item.serviceFee, 2.95);
    assert.equal(item.thumbnail, "https://images1.vinted.net/t/03_01443/310x430/54bba004.webp");
    assert.equal(item.seller.login, "pokedan267");
    assert.equal(item.seller.url, "https://www.vinted.fr/member/309389028");
    assert.equal(item.seller.business, false);
  });

  it("n'invente pas de date : le catalogue n'en donne plus", () => {
    assert.equal(mapVintedItem(raw()).createdAt, null);
    const dated = raw({
      photo: { url: "x", thumbnails: [], high_resolution: { timestamp: 1_700_000_000 } },
    });
    assert.equal(mapVintedItem(dated).createdAt, 1_700_000_000_000);
  });

  it("préfère les anciens champs de marque et d'état s'ils reviennent", () => {
    const item = mapVintedItem(raw({ brand_title: "Pokemon Company", status: "Neuf" }));
    assert.equal(item.brand, "Pokemon Company");
    assert.equal(item.status, "Neuf");
  });

  it("tient debout sans photo, sans vendeur ni lien", () => {
    const item = mapVintedItem({ id: 7 });
    assert.equal(item.url, "https://www.vinted.fr/items/7");
    assert.equal(item.title, "Annonce sans titre");
    assert.equal(item.photo, null);
    assert.equal(item.thumbnail, null);
    assert.equal(item.price, null);
    assert.equal(item.brand, null);
    assert.equal(item.status, null);
    assert.deepEqual(item.seller, { login: null, url: null, business: false });
  });

  it("garde une URL déjà absolue, et une page de profil quand elle est donnée", () => {
    const item = mapVintedItem(
      raw({
        url: "https://www.vinted.fr/items/1-x",
        user: { id: 5, login: "a", profile_url: "https://www.vinted.fr/member/5-a", business: true },
      }),
    );
    assert.equal(item.url, "https://www.vinted.fr/items/1-x");
    assert.equal(item.seller.url, "https://www.vinted.fr/member/5-a");
    assert.equal(item.seller.business, true);
  });
});
