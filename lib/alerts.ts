/**
 * Ce qu'une alerte retient, et comment elle se lit.
 *
 * Séparé de `collect/veille.ts` pour la même raison que `lbc.ts` l'est de
 * `collect/lbc.py` : le script est une orchestration — relever la boîte de
 * réception, balayer, envoyer — tandis que la règle « cette annonce mérite-t-elle
 * de faire vibrer un téléphone ? » est une décision métier, qui se teste sans
 * réseau et sans Telegram.
 *
 * Aucun import de `node:` ici : rien de ce fichier ne touche au disque.
 */

import { euro, percent, plural } from "./format";
import { CONDITION_LABELS, STRONG_SCORE } from "./match";
import { SOURCE_NAMES } from "./source";
import type { FeedCard, FeedItem } from "./feed";
import { escapeHtml } from "./telegram";

/**
 * Annonces citées dans un message. Au-delà, on renvoie au site : trente liens
 * sur un téléphone ne se lisent pas, et Telegram découperait en trois messages
 * dont personne n'ouvrirait le dernier.
 */
export const MAX_ALERTS = 25;

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
        item.score >= STRONG_SCORE &&
        !item.graded &&
        !item.bulk &&
        !(item.id in hidden),
    )
    .sort((a, b) => b.firstSeen - a.firstSeen);
}

/** Une annonce, sur une seule ligne cliquable. */
export function offerLine(item: FeedItem): string {
  const parts = [euro(item.totalPrice ?? item.price)];

  if (item.auction) parts.push(`enchère · ${plural(item.bids, "offre")}`);
  // L'écart n'a de sens que face à une cote, et une enchère en cours n'en a
  // pas : `feed.ts` le laisse vide plutôt que faux, on ne l'invente pas ici.
  if (item.vsMarket !== null) parts.push(percent(item.vsMarket));

  parts.push(SOURCE_NAMES[item.source]);
  if (item.condition) parts.push(CONDITION_LABELS[item.condition]);

  return `<a href="${escapeHtml(item.url)}">${escapeHtml(parts.join(" · "))}</a>`;
}

/**
 * Le message, ligne à ligne — à `chunk()` de le découper si Telegram le refuse.
 *
 * Groupé par carte plutôt qu'à plat : dix annonces d'affilée sans savoir
 * laquelle de ses cartes est concernée obligeraient à ouvrir chaque lien pour
 * le découvrir.
 */
export function compose(groups: AlertGroup[], max = MAX_ALERTS): string[] {
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const lines = [`🔔 <b>${plural(total, "nouvelle annonce", "nouvelles annonces")}</b>`];

  let shown = 0;
  for (const group of groups) {
    if (shown >= max) break;

    const title = group.card.localId
      ? `${group.card.name} — ${group.card.localId}`
      : group.card.name;

    lines.push("");
    lines.push(
      `<b>${escapeHtml(title)}</b>${group.card.setName ? ` · ${escapeHtml(group.card.setName)}` : ""}`,
    );

    for (const item of group.items) {
      if (shown >= max) break;
      lines.push(offerLine(item));
      shown += 1;
    }
  }

  if (total > shown) {
    lines.push("");
    lines.push(`<i>… et ${plural(total - shown, "autre")}, sur le site.</i>`);
  }

  return lines;
}

/**
 * Un motif d'échec définitif : la conversation n'existe plus, ou le bot y est
 * banni. Réessayer au prochain passage n'y changerait rien — la veille délie
 * plutôt que d'empiler la même erreur toutes les quinze minutes.
 *
 * Tout le reste — coupure réseau, 500 de Telegram — est traité comme passager,
 * et le repère des alertes ne bouge alors pas : les annonces seront renvoyées
 * au passage suivant plutôt que perdues.
 */
export function isPermanentFailure(message: string): boolean {
  return /blocked|chat not found|deactivated|forbidden|kicked/i.test(message);
}
