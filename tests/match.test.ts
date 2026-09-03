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
  searchName,
  suggestedQueries,
} from "../lib/match.ts";
import type { CardDetail } from "../lib/tcgdex.ts";
import {
  DRACAUFEU,
  DRACAUFEU_STAR,
  EOKO_DELTA,
  NANJAMO_JA,
  PHYLLALI_JA,
  PIKACHU_JA,
  SANS_COTE,
  makeItem,
} from "./helpers.ts";

const score = (title: string, extra = {}) =>
  scoreItem(makeItem({ title, ...extra }), DRACAUFEU).match;

describe("scoreItem — ce qui n'est ni une carte ni une vente", () => {
  /**
   * Ces annonces arrivaient en tête du tri « Meilleures affaires », et pas par
   * hasard : un objet à 3 € rapporté à la cote d'une carte à 1 000 € affiche
   * −100 %, un écart qu'aucune vraie occasion ne peut battre. Le bruit ne se
   * répartissait donc pas dans la liste, il se concentrait exactement là où le
   * regard se pose en premier. Mesuré le 29 août 2026 : les quinze premières
   * annonces de la page d'accueil, aucune n'était la carte cherchée.
   */
  const rejette = (title: string) => {
    const match = score(title);
    assert.equal(match.junk, true, `« ${title} » aurait dû être écartée`);
    assert.ok(match.score < WIDE_SCORE, `« ${title} » reste au-dessus du seuil`);
  };

  it("écarte les autocollants et vignettes des années 1990", () => {
    rejette("Sticker Dracaufeu n°4 - Sticker Pokémon Merlin 1999");
    rejette("Carte Pokémon Topps #4 Dracaufeu");
    rejette("Dunkin Boomer Sticker carte Dracaufeu 4");
    rejette("Vignette Panini Dracaufeu 4/102");
  });

  it("écarte ce qui n'est pas une carte du tout", () => {
    rejette("Peluche Pokémon Dracaufeu #4");
    rejette("Protection Illustrée Carte Gradée PSA - Dracaufeu 4/102");
    rejette("Dracaufeu 4/102 - Vitrine de présentation");
  });

  it("écarte les annonces d'achat, qui portent un prix symbolique", () => {
    // Un euro rapporté à une cote de cent affiche −99 % et coiffe le
    // classement, alors que personne ne vend quoi que ce soit.
    rejette("RECHERCHE Dracaufeu 4/102");
    rejette("ECHANGE/VENDS Dracaufeu 4/102");
  });

  it("laisse passer une carte dont le titre dit qu'elle est recherchée", () => {
    // `recherche` et `recherchee` sont deux mots distincts après `normalize` :
    // le vocabulaire est étroit à dessein, sans quoi la moitié des annonces
    // légitimes tomberait avec.
    const match = score("Dracaufeu 4/102 carte très recherchée");
    assert.equal(match.junk, false);
    assert.ok(match.score >= STRONG_SCORE);
  });
});

describe("scoreItem — une autre impression du même Pokémon", () => {
  /**
   * « Salamèche 98/165 » n'est pas « Salamèche 98/97 » : le dénominateur le dit
   * explicitement. Sept annonces de ce genre affichaient jusqu'à −85 % de la
   * cote d'une carte qu'elles ne vendaient pas.
   *
   * On ne les écarte pas — tomber sur une autre impression de son Pokémon est
   * un hasard qui vaut d'être vu. On leur retire l'écart, comme le fil le fait
   * déjà d'une enchère eBay en cours : mieux vaut un écart vide qu'un faux.
   */
  // `makeItem` pose un prix de 50 € et la cote du gabarit vaut 100 € : l'écart
  // attendu est donc de −50 % quand il doit être calculé.
  const juge = (title: string) => scoreItem(makeItem({ title }), DRACAUFEU);

  it("garde l'annonce mais lui retire son écart à la cote", () => {
    const other = juge("Dracaufeu 4/165 Expédition Wizards");
    assert.equal(other.match.otherPrint, true);
    assert.ok(other.match.score >= STRONG_SCORE, "l'annonce doit rester visible");
    assert.equal(other.vsMarket, null);
  });

  it("laisse son écart à la bonne impression", () => {
    const right = juge("Carte Pokémon Dracaufeu 4/102 Set de Base");
    assert.equal(right.match.otherPrint, false);
    assert.equal(right.vsMarket, -50);
  });

  it("accepte le décompte avec les cartes secrètes", () => {
    // TCGdex publie « 102 » et « 102 » ici, mais bien souvent deux valeurs
    // différentes — « 102 » et « 103 ». Les vendeurs emploient l'une ou
    // l'autre, et n'en retenir qu'une ferait passer les annonces légitimes
    // pour une autre impression.
    const secret: CardDetail = {
      ...DRACAUFEU,
      set: { ...DRACAUFEU.set!, cardCount: { official: 102, total: 110 } },
    };
    const scored = scoreItem(makeItem({ title: "Dracaufeu 4/110 holo" }), secret);
    assert.equal(scored.match.otherPrint, false);
  });
});

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

/**
 * Les cartes dont le nom officiel porte un symbole étaient cassées aux deux
 * bouts : la requête cherchait une graphie que personne n'écrit, et le titre
 * qui revenait quand même — trouvé par son numéro — était recalé faute de nom
 * reconnu. Les deux extrémités partagent désormais `searchName`, et ces tests
 * vérifient surtout qu'elles ne redivergent pas.
 */
describe("searchName — symboles du nom officiel", () => {
  it("traduit l'étoile en « gold star », comme l'écrivent les vendeurs", () => {
    assert.equal(searchName(DRACAUFEU_STAR), "Dracaufeu gold star");
  });

  /** Mesuré : « Eoko delta 1/17 » ne ramène rien, « Eoko 1/17 » ramène la carte. */
  it("retire le delta au lieu de le traduire", () => {
    assert.equal(searchName(EOKO_DELTA), "Eoko");
  });

  it("traduit le losange des Prism Star", () => {
    assert.equal(searchName({ id: "x", localId: "1", name: "Victini ◇" }), "Victini prism star");
  });

  it("ramène le trait d'union à une espace, sans coller les mots", () => {
    assert.equal(searchName({ id: "x", localId: "1", name: "Latias-ex" }), "Latias ex");
  });

  it("laisse intact un nom sans symbole", () => {
    assert.equal(searchName(DRACAUFEU), "Dracaufeu");
  });
});

describe("scoreItem — noms à symboles", () => {
  it("reconnaît le nom dans un titre écrit comme les vendeurs l'écrivent", () => {
    const match = scoreItem(
      makeItem({ title: "Dracaufeu Gold star 100/101 Îles des dragons" }),
      DRACAUFEU_STAR,
    ).match;
    assert.equal(match.name, true);
    assert.equal(match.number, true);
    assert.ok(match.score >= STRONG_SCORE);
  });

  /** Le cas qui motivait tout : « dracaufeu ☆ δ » ne se trouve dans aucun titre. */
  it("ne cherche plus le symbole dans le titre", () => {
    const match = scoreItem(makeItem({ title: "Dracaufeu gold star 100/101" }), DRACAUFEU_STAR)
      .match;
    assert.equal(match.name, true);
  });

  it("reconnaît une carte delta par son nom nu", () => {
    const match = scoreItem(makeItem({ title: "Carte Eoko pop 4 1/17" }), EOKO_DELTA).match;
    assert.equal(match.name, true);
    assert.equal(match.number, true);
  });
});

describe("bestQuery", () => {
  it("préfère le numéro imprimé complet — c'est lui qui classe la page 1", () => {
    assert.equal(bestQuery(DRACAUFEU), "Dracaufeu 4/102");
  });

  it("compose « nom traduit + numéro » sur une carte à étoile", () => {
    assert.equal(bestQuery(DRACAUFEU_STAR), "Dracaufeu gold star 100/101");
  });

  it("compose la requête d'une carte delta sans le symbole", () => {
    assert.equal(bestQuery(EOKO_DELTA), "Eoko 1/17");
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

/* -------------------------------------------------------------- japonais */

describe("scoreItem — cartes japonaises", () => {
  const ja = (title: string, card = PIKACHU_JA) => scoreItem(makeItem({ title }), card).match;

  /**
   * Relevé Vinted du 3 septembre 2026, requête « Pikachu 001/SV-P » : la
   * première page entière porte le numéro avec le code de l'extension, sous
   * toutes ces graphies.
   */
  it("lit le code de l'extension comme dénominateur d'une promo", () => {
    for (const title of [
      "Pikachu Promo 001/SV-P",
      "Pikachu 001 sv-p jp promo bgs 10",
      "Pikachu SV-P 001 Pokémon Karte – Japanisch – Promo",
      "Pikachu Promo Japonais (SV-P 001)",
      "Pikachu 001|sv-p",
    ]) {
      const match = ja(title);
      assert.equal(match.number, true, `numéro non lu dans « ${title} »`);
      assert.equal(match.name, true);
      assert.ok(match.score >= STRONG_SCORE, `« ${title} » devrait être forte`);
    }
  });

  it("compte le code de l'extension comme signal d'extension, en mot entier", () => {
    assert.equal(ja("Pikachu 001/SV-P").set, true);
    assert.equal(ja("Pikachu SVP 001").set, true);

    // « film pokemon » finit par « m p » : pas l'extension M-P.
    const mcdo: CardDetail = {
      ...PIKACHU_JA,
      id: "ja:M-P-020",
      localId: "020",
      set: { ...PIKACHU_JA.set!, id: "M-P" },
    };
    assert.equal(ja("Pikachu du film pokemon", mcdo).set, false);
    assert.equal(ja("Pikachu McDo 020/M-P", mcdo).number, true);
  });

  it("lit une extension numérotée comme une carte française, total compris", () => {
    const match = ja("Phyllali ex 003/187 SV8a Terastal Festival JPN", PHYLLALI_JA);
    assert.equal(match.number, true);
    assert.equal(match.set, true);
    assert.ok(match.score >= STRONG_SCORE);
  });

  it("reconnaît le nom anglais, que certains vendeurs préfèrent", () => {
    assert.equal(ja("Leafeon ex 003/187", PHYLLALI_JA).name, true);
  });

  it("ne cherche pas le nom de l'extension japonaise dans les titres", () => {
    // « テラスタルフェス » n'apparaît dans aucun titre français, et ses mots
    // ne doivent pas compter : sans le code, pas d'extension.
    assert.equal(ja("Phyllali ex 003/187", PHYLLALI_JA).set, false);
  });

  it("ajoute deux points quand le titre dit la langue, sans faire une forte du nom seul", () => {
    const match = ja("Pikachu japonaise");
    assert.equal(match.language, true);
    assert.equal(match.score, 4 + 2);
    assert.ok(match.score < STRONG_SCORE);
  });

  it("fait une forte du numéro, du code et de la langue — sans nom, cas des Dresseurs", () => {
    const match = ja("Carte Pokémon japonaise 121/SV-P", NANJAMO_JA);
    assert.equal(match.name, false);
    assert.equal(match.number, true);
    assert.equal(match.set, true);
    assert.equal(match.language, true);
    assert.ok(match.score >= STRONG_SCORE);
  });

  it("ramène une chinoise à la même numérotation sous le seuil strict, sans écart", () => {
    const scored = scoreItem(makeItem({ title: "Pikachu 001/SV-P Chinese Sealed" }), PIKACHU_JA);
    assert.equal(scored.match.otherLanguage, true);
    assert.equal(scored.match.number, true);
    assert.ok(scored.match.score < STRONG_SCORE);
    assert.ok(scored.match.score >= WIDE_SCORE, "reste visible en élargissant");
    assert.equal(scored.vsMarket, null);
  });

  it("ne touche pas à la notation d'une carte française", () => {
    // Les signaux de langue n'existent que pour les japonaises : sur une
    // française, un titre qui dit « japonaise » ne change rien au score.
    const match = score("Dracaufeu 4/102 japonaise");
    assert.equal(match.language, false);
    assert.equal(match.otherLanguage, false);
    assert.equal(match.score, 8);
  });
});

describe("bestQuery — cartes japonaises", () => {
  it("compose « nom + numéro/code » pour une promo", () => {
    assert.equal(bestQuery(PIKACHU_JA), "Pikachu 001/SV-P");
  });

  it("compose « nom + numéro/total » pour une extension", () => {
    assert.equal(bestQuery(PHYLLALI_JA), "Phyllali ex 003/187");
  });

  it("cherche par le numéro seul une carte dont le nom n'a pas de traduction", () => {
    assert.equal(bestQuery(NANJAMO_JA), "carte pokemon japonaise 121/SV-P");
  });
});

describe("suggestedQueries — cartes japonaises", () => {
  it("dit la langue dans la requête large, et l'extension par son code", () => {
    const queries = suggestedQueries(PIKACHU_JA).map((entry) => entry.query);
    assert.deepEqual(queries, [
      "Pikachu carte pokemon japonaise",
      "Pikachu 001/SV-P",
      "Pikachu SV-P",
    ]);
  });

  it("ne propose que le numéro pour une carte sans nom traduit", () => {
    const queries = suggestedQueries(NANJAMO_JA).map((entry) => entry.query);
    assert.deepEqual(queries, ["carte pokemon japonaise 121/SV-P"]);
  });
});
