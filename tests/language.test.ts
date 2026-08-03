import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isForeignListing, titleLanguage } from "../lib/language.ts";

describe("titleLanguage", () => {
  it("reconnaît un titre français ordinaire", () => {
    assert.equal(titleLanguage("Carte Pokémon Dracaufeu 4/102 très bon état"), "french");
    assert.equal(titleLanguage("Lot de 10 cartes Pokémon avec pochette"), "french");
  });

  it("reconnaît un titre anglais", () => {
    assert.equal(titleLanguage("Charizard Base Set 4/102 English cards good condition"), "foreign");
    assert.equal(titleLanguage("The best Pokemon cards with free shipping"), "foreign");
  });

  it("reconnaît les autres langues du catalogue", () => {
    assert.equal(titleLanguage("Pokémon Karte Glurak 4/102 sehr gut Zustand"), "foreign");
    assert.equal(titleLanguage("Pokemon kaart Pikachu zeer goede staat"), "foreign");
    assert.equal(titleLanguage("Carta Pokemon Pikachu nuevo estado"), "foreign");
  });

  it("ne prend pas le jargon du TCG pour de l'anglais", () => {
    // Ces mots-là sont écrits tels quels par les vendeurs français : les
    // compter comme étrangers viderait le fil de ses meilleures annonces.
    assert.equal(titleLanguage("Carte Pokémon Pikachu holo reverse full art mint"), "french");
    assert.equal(titleLanguage("Carte Dracaufeu PSA 10 graded sealed booster"), "french");
  });

  it("laisse passer un titre sans indice de langue", () => {
    assert.equal(titleLanguage("Pikachu 58/102"), "unknown");
    assert.equal(titleLanguage("Mewtwo ex 150/165"), "unknown");
  });

  it("garde un titre mixte, où le français n'est pas dominé", () => {
    assert.equal(titleLanguage("Carte Pokémon Charizard mint condition"), "french");
  });

  it("ne tient pas l'accent de « Pokémon » pour un signal français", () => {
    // Les vendeurs anglophones écrivent « Pokémon » avec son accent : sans
    // cette précaution, presque aucun titre anglais ne serait détecté.
    assert.equal(titleLanguage("Pokémon Charizard card from my collection, very good"), "foreign");
  });
});

describe("isForeignListing", () => {
  it("croit le pays déclaré plutôt que le titre", () => {
    // Un vendeur madrilène qui rédige en français reste un envoi depuis
    // l'Espagne : c'est précisément ce que la lecture du titre ne peut pas voir.
    assert.equal(
      isForeignListing({ country: "ES", title: "Carte Pokémon Dracaufeu très bon état" }),
      true,
    );
    // Et l'inverse : un vendeur français qui rédige en anglais expédie de France.
    assert.equal(
      isForeignListing({ country: "FR", title: "Charizard Base Set with free shipping" }),
      false,
    );
  });

  it("accepte le pays quelle qu'en soit la casse", () => {
    assert.equal(isForeignListing({ country: "fr", title: "The best cards" }), false);
  });

  it("se rabat sur le titre quand la source ne déclare pas de pays", () => {
    // C'est le cas de Vinted, dont le catalogue ne dit rien de la provenance.
    assert.equal(
      isForeignListing({ country: null, title: "Pokemon Karte Glurak sehr gut Zustand" }),
      true,
    );
    assert.equal(
      isForeignListing({ country: null, title: "Carte Pokémon Dracaufeu très bon état" }),
      false,
    );
  });

  it("garde une annonce dont ni le pays ni le titre ne disent rien", () => {
    assert.equal(isForeignListing({ country: null, title: "Pikachu 58/102" }), false);
  });
});
