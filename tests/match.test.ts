/**
 * `lib/match.ts` porte la valeur du site : c'est lui qui décide qu'une annonce
 * parle bien de *cette* carte. C'est aussi de la logique pure, sans réseau ni
 * disque — donc exactement ce qui se teste.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STRONG_SCORE,
  WIDE_SCORE,
  bestQuery,
  condition,
  normalize,
  scoreItem,
  suggestedQueries,
} from "../lib/match.ts";
import type { CardDetail } from "../lib/tcgdex.ts";
import { DRACAUFEU, SANS_COTE, makeItem } from "./helpers.ts";

const score = (title: string, extra = {}) =>
  scoreItem(makeItem({ title, ...extra }), DRACAUFEU).match;

describe("normalize", () => {
  it("efface la casse, les accents et les espaces multiples", () => {
    assert.equal(normalize("  Léviator   HOLO "), "leviator holo");
  });
});

describe("scoreItem — signaux", () => {
  it("reconnaît le nom seul, sans atteindre le seuil strict", () => {
    const match = score("Carte pokemon Dracaufeu rare");
    assert.equal(match.name, true);
    assert.equal(match.number, false);
    assert.equal(match.score, WIDE_SCORE);
    assert.ok(match.score < STRONG_SCORE);
  });

  it("atteint le seuil strict avec le nom et le numéro imprimé", () => {
    const match = score("Dracaufeu 4/102 set de base");
    assert.equal(match.number, true);
    assert.equal(match.set, true);
    assert.ok(match.score >= STRONG_SCORE);
  });

  it("accepte les autres écritures du numéro", () => {
    for (const title of ["Dracaufeu n°4", "Dracaufeu #4", "Dracaufeu (4) holo"]) {
      assert.equal(score(title).number, true, title);
    }
  });

  it("ne confond pas le numéro avec un nombre quelconque collé", () => {
    assert.equal(score("Dracaufeu 44/102").number, false);
    assert.equal(score("Dracaufeu 104 cartes").number, false);
  });

  it("ignore une carte homonyme d'une autre extension", () => {
    const match = score("Dracaufeu VMAX 020/189");
    assert.equal(match.name, true);
    assert.equal(match.number, false);
    assert.ok(match.score < STRONG_SCORE);
  });
});

describe("scoreItem — mots entiers", () => {
  // La recherche par sous-chaîne se trompait dans les deux sens ; c'est la
  // régression que ces deux cas verrouillent.
  it("détecte « lot » en fin de titre", () => {
    assert.equal(score("Dracaufeu 4/102 vendu en lot").bulk, true);
  });

  it("ne déclenche pas « psa » sur un mot qui le contient", () => {
    assert.equal(score("Dracaufeu 4/102 psaume collection").graded, false);
    assert.equal(score("Dracaufeu 4/102 PSA 10").graded, true);
  });
});

describe("scoreItem — nom à trait d'union", () => {
  // Depuis Écarlate & Violet, la carte s'imprime « Latias-ex ». Aucune annonce
  // ne l'écrit ainsi : sans cette équivalence, le fil de ces cartes est vide.
  const LATIAS: CardDetail = {
    id: "sv08-239",
    localId: "239",
    name: "Latias-ex",
    set: { id: "sv08", name: "Étincelles Déferlantes", cardCount: { official: 191, total: 252 } },
    pricing: { cardmarket: { trend: 194 } },
  };

  const latias = (title: string) => scoreItem(makeItem({ title }), LATIAS).match;

  it("reconnaît le nom écrit avec une espace, comme les vendeurs l'écrivent", () => {
    const match = latias("Carte Pokémon Latias Ex 239/191 Étincelles Déferlantes");
    assert.equal(match.name, true);
    assert.ok(
      match.score >= STRONG_SCORE,
      `noté ${match.score}, la carte resterait invisible sous le seuil strict`,
    );
  });

  it("reconnaît encore le nom écrit avec son trait d'union", () => {
    assert.equal(latias("Latias-ex 239/191 Étincelles Déferlantes").name, true);
  });

  it("reconnaît le tiret long, dont les titres d'annonces sont friands", () => {
    assert.equal(latias("Latias — ex 239/191 Étincelles Déferlantes").name, true);
  });

  it("continue de lire un numéro imprimé séparé par un trait d'union", () => {
    // Régression : le trait d'union devenant une espace, le motif du numéro
    // doit l'admettre comme séparateur.
    assert.equal(score("Dracaufeu 4-102 set de base").number, true);
    assert.equal(score("Dracaufeu 4/102 set de base").number, true);
  });
});

describe("scoreItem — gradation déclarée par la source", () => {
  // eBay tient la gradation de la catégorie de l'annonce, pas du titre. C'est
  // une information de meilleure qualité : elle doit primer dans les deux sens.
  it("croit la source quand elle annonce une gradée que le titre tait", () => {
    assert.equal(score("Dracaufeu 4/102 set de base", { graded: true }).graded, true);
  });

  it("croit la source quand elle dément un titre qui parle de PSA", () => {
    // « PSA 10 » dans le titre d'une annonce déclarée non gradée décrit souvent
    // la carte de référence, pas celle qui est vendue.
    assert.equal(score("Dracaufeu 4/102 comme la PSA 10", { graded: false }).graded, false);
  });

  it("retombe sur le titre quand la source ne dit rien, comme Vinted", () => {
    assert.equal(score("Dracaufeu 4/102 PSA 10", { graded: undefined }).graded, true);
  });
});

describe("scoreItem — reproductions", () => {
  it("fait passer une reproduction sous le seuil strict malgré un titre parfait", () => {
    const match = score("Dracaufeu 4/102 set de base custom");
    assert.equal(match.fake, true);
    assert.equal(match.name, true);
    assert.equal(match.number, true);
    assert.ok(
      match.score < STRONG_SCORE,
      `un proxy noté ${match.score} passerait pour une bonne affaire`,
    );
  });
});

describe("scoreItem — écart à la cote", () => {
  it("compare le prix total, frais inclus", () => {
    const item = scoreItem(
      makeItem({ title: "Dracaufeu 4/102", price: 50, totalPrice: 62 }),
      DRACAUFEU,
    );
    assert.equal(item.trend, 100);
    assert.equal(item.vsMarket, -38);
  });

  it("reste nul sans cote connue", () => {
    const item = scoreItem(makeItem({ title: "Feunard 7" }), SANS_COTE);
    assert.equal(item.trend, null);
    assert.equal(item.vsMarket, null);
  });

  it("reste nul sans prix", () => {
    const item = scoreItem(
      makeItem({ title: "Dracaufeu 4/102", price: null, totalPrice: null }),
      DRACAUFEU,
    );
    assert.equal(item.vsMarket, null);
  });

  it("pénalise une annonce sponsorisée", () => {
    const plain = score("Dracaufeu 4/102");
    const promoted = score("Dracaufeu 4/102", { promoted: true });
    assert.equal(promoted.score, plain.score - 1);
  });
});

describe("bestQuery", () => {
  it("préfère le numéro imprimé complet — c'est lui qui classe la page 1", () => {
    assert.equal(bestQuery(DRACAUFEU), "Dracaufeu 4/102");
  });

  it("se rabat sur le numéro local quand le total est inconnu", () => {
    assert.equal(bestQuery(SANS_COTE), "Feunard 7");
  });

  it("se rabat sur le nom quand la carte n'a aucun numéro", () => {
    assert.equal(bestQuery({ id: "x", localId: "", name: "Pikachu" }), "Pikachu carte pokemon");
  });
});

describe("suggestedQueries", () => {
  it("ne propose jamais deux fois la même requête", () => {
    const queries = suggestedQueries(DRACAUFEU).map((entry) => entry.query);
    assert.equal(new Set(queries).size, queries.length);
  });

  it("va du plus large au plus ciblé", () => {
    const [first] = suggestedQueries(DRACAUFEU);
    assert.equal(first.query, "Dracaufeu carte pokemon");
  });
});

describe("condition", () => {
  it("ramène les libellés Vinted à quatre niveaux", () => {
    assert.equal(condition("Neuf avec étiquette"), "neuf");
    assert.equal(condition("Très bon état"), "excellent");
    assert.equal(condition("Bon état"), "bon");
    assert.equal(condition("Satisfaisant"), "correct");
    assert.equal(condition(null), null);
    assert.equal(condition("Inconnu"), null);
  });

  it("classe « très bon » avant « bon », malgré le mot commun", () => {
    assert.equal(condition("tres bon etat"), "excellent");
  });
});
