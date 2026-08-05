/**
 * La notation des lots est l'exact miroir de celle des cartes à l'unité : ce
 * que `scoreItem` pénalise, `scoreLot` exige. Deux règles inverses dans le même
 * fichier se contredisent vite — d'où cette suite, qui vérifie surtout qu'elles
 * ne se marchent pas dessus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOT_SCORE,
  isPokemonLot,
  lotQueries,
  lotSize,
  scoreLot,
  scoreItem,
} from "../lib/match.ts";
import type { CardDetail } from "../lib/tcgdex.ts";
import { DRACAUFEU, SANS_COTE, makeItem } from "./helpers.ts";

const lot = (title: string, extra = {}) => scoreLot(makeItem({ title, ...extra }), DRACAUFEU).match;

const retained = (title: string, extra = {}) => lot(title, extra).score >= LOT_SCORE;

describe("lotSize", () => {
  it("lit la quantité collée au mot « cartes »", () => {
    assert.equal(lotSize("Lot de 200 cartes Pokémon"), 200);
  });

  it("lit « lot de N » quand « cartes » ne suit pas", () => {
    assert.equal(lotSize("Lot de 50 Pokémon rares"), 50);
  });

  it("lit la forme « x N »", () => {
    assert.equal(lotSize("Gros lot Pokémon x150"), 150);
  });

  /**
   * Le piège central : sans retrait préalable des numéros imprimés, « 4/102 »
   * livrerait un lot de 102 cartes — et un prix par carte inventé de toutes
   * pièces, affiché avec le même aplomb qu'un vrai.
   */
  it("ne prend pas le numéro imprimé pour une quantité", () => {
    assert.equal(lotSize("Lot Dracaufeu 4/102 Set de Base"), null);
  });

  it("lit la quantité malgré un numéro imprimé dans le même titre", () => {
    assert.equal(lotSize("Lot de 12 cartes dont Dracaufeu 4/102"), 12);
  });

  it("rend null quand le titre n'annonce rien", () => {
    assert.equal(lotSize("Lot de cartes Pokémon en vrac"), null);
  });

  /**
   * Observé sur le flux réel. La référence interne du vendeur précède le mot
   * « Carte », et sans borne à gauche le moteur attrapait ses chiffres avant
   * d'atteindre le vrai décompte — un prix par carte divisé par dix.
   */
  it("ne confond pas la référence du vendeur avec une quantité", () => {
    assert.equal(
      lotSize("B1090 Carte Pokemon Vénusaure Claw Catcher Pokemon GO Vente en vrac 100 cartes"),
      100,
    );
    assert.equal(lotSize("REF42 cartes Pokémon lot de 8 cartes"), 8);
  });

  it("écarte une carte seule et les nombres invraisemblables", () => {
    assert.equal(lotSize("1 carte Pokémon"), null);
    assert.equal(lotSize("Lot de 9999 cartes"), null);
  });
});

describe("scoreLot — le lot devient éliminatoire", () => {
  it("écarte une annonce à l'unité, même parfaitement décrite", () => {
    const match = lot("Dracaufeu 4/102 Set de Base");
    assert.equal(match.bulk, false);
    assert.equal(match.score, 0);
    assert.equal(retained("Dracaufeu 4/102 Set de Base"), false);
  });

  /**
   * Le cas qui justifie tout le module : ce titre vaut 2 pour `scoreItem`,
   * sous le seuil large — il n'atteint donc jamais le disque par le fil.
   */
  it("retient un lot que la notation du fil jetterait", () => {
    const title = "Lot de 200 cartes Pokémon dont Dracaufeu";
    assert.ok(scoreItem(makeItem({ title }), DRACAUFEU).match.score < 4);
    assert.equal(retained(title), true);
  });

  it("retient un lot qui ne cite que l'extension", () => {
    assert.equal(retained("Lot cartes Pokémon Set de Base complet"), true);
  });

  it("écarte un lot générique, sans lien avec la carte suivie", () => {
    const match = lot("Lot de 300 cartes Pokémon en vrac");
    assert.equal(match.bulk, true);
    assert.ok(match.score < LOT_SCORE);
  });

  it("écarte un lot de reproductions malgré nom, numéro et extension", () => {
    assert.equal(retained("Lot de 10 cartes custom Dracaufeu 4/102 Set de Base"), false);
  });

  it("classe un lot complet au-dessus d'un lot qui ne cite que le nom", () => {
    const complete = lot("Lot Dracaufeu 4/102 Set de Base").score;
    const named = lot("Lot de 40 cartes Dracaufeu").score;
    assert.ok(complete > named);
  });

  it("laisse les signaux de titre intacts : seule la pondération change", () => {
    const title = "Lot de 200 cartes Pokémon dont Dracaufeu";
    const asItem = scoreItem(makeItem({ title }), DRACAUFEU).match;
    const asLot = lot(title);
    assert.deepEqual(
      { name: asLot.name, number: asLot.number, set: asLot.set, bulk: asLot.bulk },
      { name: asItem.name, number: asItem.number, set: asItem.set, bulk: asItem.bulk },
    );
    assert.notEqual(asLot.score, asItem.score);
  });
});

/**
 * Le flux des lots récents n'a aucune carte à laquelle se comparer : il juge le
 * titre nu. L'ancrage « pokemon » n'est pas une précaution théorique — sans
 * lui, une recherche « lot cartes pokemon » sur Vinted rend des vêtements dans
 * ses premiers résultats.
 */
describe("isPokemonLot", () => {
  it("retient un lot de cartes Pokémon", () => {
    assert.equal(isPokemonLot("Lot de 200 cartes Pokémon en vrac"), true);
  });

  it("retient malgré l'accent, que la normalisation efface", () => {
    assert.equal(isPokemonLot("LOT POKÉMON classeur complet"), true);
  });

  it("écarte une annonce sans rapport avec Pokémon", () => {
    assert.equal(isPokemonLot("Lot de 3 maillots de football"), false);
  });

  it("écarte une carte Pokémon vendue à l'unité", () => {
    assert.equal(isPokemonLot("Carte Pokémon Dracaufeu 4/102"), false);
  });

  it("écarte un lot de reproductions", () => {
    assert.equal(isPokemonLot("Lot de 50 cartes Pokémon custom"), false);
  });

  /** « pokemon » doit être un mot entier, pas une sous-chaîne. */
  it("ne se déclenche pas sur un mot qui contient le nom", () => {
    assert.equal(isPokemonLot("Lot de cartes pokemonster"), false);
  });

  /**
   * Observé sur le flux réel : à 0,03 €/carte, un lot de cartes-code coiffait
   * 451 vraies cartes à 0,06 €. Sans valeur pour un collectionneur, et
   * mécaniquement premier de tout classement au prix par carte.
   */
  it("écarte les lots de cartes-code, qui fausseraient le prix par carte", () => {
    assert.equal(isPokemonLot("Lot 270 Cartes Code Pokémon"), false);
    assert.equal(isPokemonLot("Lot de 50 codes Pokémon TCG Live"), false);
  });
});

describe("lotQueries", () => {
  it("part du mot « lot », pas du numéro imprimé", () => {
    const queries = lotQueries(DRACAUFEU);
    assert.ok(queries.every((query) => query.startsWith("lot ")));
    assert.ok(queries.some((query) => query.includes("Dracaufeu")));
    assert.ok(queries.some((query) => query.includes("Set de Base")));
  });

  it("se limite au nom quand la carte n'a pas d'extension nommée", () => {
    const sansSet: CardDetail = { ...SANS_COTE, set: undefined };
    assert.deepEqual(lotQueries(sansSet), ["lot Feunard"]);
  });

  /** « Latias-ex » ne se cherche pas ainsi : aucune annonce n'écrit le trait d'union. */
  it("cherche le nom tel qu'il s'écrit dans les annonces", () => {
    const latias: CardDetail = { ...SANS_COTE, name: "Latias-ex", set: undefined };
    assert.deepEqual(lotQueries(latias), ["lot Latias ex"]);
  });
});
