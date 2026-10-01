/**
 * Ce qu'une alerte retient, et comment elle se lit.
 *
 * Séparé de `collect/veille.ts` pour la même raison que `lbc.ts` l'est de
 * `collect/lbc.py` : le script est une orchestration — balayer, envoyer —
 * tandis que la règle « cette annonce mérite-t-elle une alerte ? » est une
 * décision métier, qui se teste sans réseau. La mise en forme et l'envoi vers
 * Discord vivent dans `lib/discord.ts` ; ici on ne décide que du *quoi*.
 *
 * Aucun import de `node:` ici : rien de ce fichier ne touche au disque.
 */

import { euro, percent, plural } from "./format";
import { CONDITION_LABELS, STRONG_SCORE } from "./match";
import { SOURCE_NAMES } from "./source";
import type { FeedCard, FeedItem } from "./feed";
import { postedAt } from "./vinted-date";

/**
 * Annonces citées dans un message. Au-delà, on renvoie au site : trente liens
 * ne se lisent pas d'un coup, et Discord plafonne de toute façon ses embeds.
 */
export const MAX_ALERTS = 25;

/**
 * Ancienneté maximale d'une annonce, comptée avant le repère, pour mériter une
 * alerte. Le 1er octobre 2026, la veille a envoyé 200 alertes d'un coup au
 * retour de Vinted, et 20 à 50 à chaque carte ajoutée : tout ce que la
 * collecte croisait pour la première fois partait comme neuf, y compris des
 * annonces de quinze mois. Trois jours couvrent une panne d'un week-end et
 * l'imprécision de la date estimée des annonces Vinted (`lib/vinted-date.ts`).
 */
export const MAX_POST_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Une carte et ce qu'elle a de neuf à annoncer. */
export interface AlertGroup {
  card: FeedCard;
  items: FeedItem[];
}

/**
 * Annonces neuves depuis `since`, dans l'ordre de découverte décroissant.
 *
 * Le filtre reprend **les réglages par défaut du tableau de bord**, et pas
 * d'autres : correspondance forte, ni gradée, ni lot. C'est la seule façon
 * qu'une alerte ne mène pas à une page où l'annonce annoncée est justement
 * masquée — un utilisateur qui suit le lien et ne trouve rien cesse de faire
 * confiance à l'alerte suivante.
 *
 * `>` et non `>=` : le repère vaut la date du dernier envoi, et une annonce
 * découverte exactement à cet instant a déjà été annoncée.
 *
 * `hidden` prolonge la même règle : ce que l'utilisateur a écarté du fil à la
 * main ne doit pas revenir lui faire vibrer le téléphone. Le cas se produit
 * pour de bon — la veille passe au quart d'heure, et une annonce découverte
 * puis congédiée sur le site entre deux passages serait sans cela annoncée
 * juste après avoir été refusée.
 *
 * Enfin, « apparue chez nous » ne suffit pas : il faut aussi qu'elle ait été
 * mise en ligne depuis peu, voir `MAX_POST_AGE_MS`.
 */
export function selectFresh(
  items: FeedItem[],
  since: number,
  hidden: Record<string, number> = {},
): FeedItem[] {
  return items
    .filter(
      (item) =>
        item.firstSeen > since &&
        postedAt(item) > since - MAX_POST_AGE_MS &&
        item.score >= STRONG_SCORE &&
        !item.graded &&
        !item.bulk &&
        !(item.id in hidden),
    )
    .sort((a, b) => b.firstSeen - a.firstSeen);
}

/**
 * Une annonce, en une ligne de texte : « 12,00 € · −38 % · Vinted · Bon ».
 *
 * Volontairement sans lien ni balisage : c'est `lib/discord.ts` qui l'habille
 * (`[texte](url)` en Markdown Discord). Rester en texte brut la garde pure et
 * testable, et réutilisable si un autre transport arrive un jour.
 */
export function offerText(item: FeedItem): string {
  const parts = [euro(item.totalPrice ?? item.price)];

  if (item.auction) parts.push(`enchère · ${plural(item.bids, "offre")}`);
  // L'écart n'a de sens que face à une cote, et une enchère en cours n'en a
  // pas : `feed.ts` le laisse vide plutôt que faux, on ne l'invente pas ici.
  if (item.vsMarket !== null) parts.push(percent(item.vsMarket));

  parts.push(SOURCE_NAMES[item.source]);
  if (item.condition) parts.push(CONDITION_LABELS[item.condition]);

  return parts.join(" · ");
}
