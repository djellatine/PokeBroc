/**
 * eBay est la seule source dont le moteur de recherche impose sa forme à la
 * requête : `q` est un ET strict sur les mots, là où Vinted se contente d'une
 * correspondance partielle. `bestQuery` ayant été écrite pour Vinted, ses
 * numéros de carte — « Dracaufeu 4/102 » — ne trouvaient rien chez eBay dès
 * que le vendeur n'avait pas écrit le dénominateur.
 *
 * Le reste de `ebay.ts` parle au réseau et ne se teste pas ici ; cette
 * transformation-là est pure, et c'est elle qui décide si la moitié du fil
 * existe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looseQuery } from "../lib/ebay.ts";

describe("looseQuery", () => {
  it("retire le dénominateur d'un numéro imprimé", () => {
    assert.equal(looseQuery("Dracaufeu 4/102"), "Dracaufeu 4");
    assert.equal(looseQuery("Dracolosse 2/146"), "Dracolosse 2");
  });

  it("garde un numéro préfixé, que le dénominateur seul rendait introuvable", () => {
    // « Kyogre SL6/95 » rendait zéro annonce, « Kyogre SL6 » en rend sept.
    assert.equal(looseQuery("Kyogre SL6/95"), "Kyogre SL6");
  });

  it("laisse intact ce qui précède le numéro", () => {
    assert.equal(looseQuery("Kyogre EX de la Team Aqua 6/34"), "Kyogre EX de la Team Aqua 6");
    assert.equal(looseQuery("Metalosse gold star 113/113"), "Metalosse gold star 113");
  });

  it("ne touche pas aux requêtes sans barre oblique", () => {
    // Celles des lots, qui partent du mot « lot » et non d'une carte.
    assert.equal(looseQuery("lot cartes pokemon"), "lot cartes pokemon");
    assert.equal(looseQuery("Feunard 7"), "Feunard 7");
    assert.equal(looseQuery("Pikachu carte pokemon"), "Pikachu carte pokemon");
  });

  it("n'ampute que le dernier mot", () => {
    // Une barre oblique au milieu du titre n'est pas un numéro de carte, et la
    // couper laisserait une requête tronquée là où elle marchait.
    assert.equal(looseQuery("Sulfura Rainbow / Moltres carte"), "Sulfura Rainbow / Moltres carte");
  });

  it("ne rend pas une requête vide", () => {
    // Un numéro seul n'a pas de nom à protéger : sans espace devant, rien ne
    // correspond, et la requête part telle quelle plutôt que réduite à rien.
    assert.equal(looseQuery("4/102"), "4/102");
    assert.equal(looseQuery(""), "");
  });
});
