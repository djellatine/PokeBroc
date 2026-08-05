/**
 * Les places de marché, et rien d'autre.
 *
 * Module minuscule, et volontairement sans le moindre import : ces deux
 * déclarations sont les seules que le navigateur *et* le serveur partagent.
 * Elles ont d'abord vécu dans `feed.ts`, ce qui marchait tant que les
 * composants n'en tiraient que le type — effacé à la compilation. Le jour où
 * `OfferRow` a eu besoin de `SOURCE_NAMES`, une valeur, l'import a cessé d'être
 * effacé et a entraîné tout `feed.ts` dans le paquet client, `node:fs/promises`
 * compris. Le build échoue alors, mais ni `tsc` ni le linter ne le voient.
 *
 * D'où ce fichier : ce qui traverse la frontière serveur/client n'a pas à
 * cohabiter avec ce qui lit le disque.
 */

export type Source = "vinted" | "ebay" | "lbc";

/**
 * Nom d'affichage d'une place de marché.
 *
 * Partagé plutôt que dupliqué : les messages d'erreur de collecte le citent
 * (« Vinted : … ») et naissent côté serveur, tandis que la pastille de
 * provenance l'affiche côté client. Deux définitions pour une même donnée
 * divergeraient à la première retouche.
 */
export const SOURCE_NAMES: Record<Source, string> = {
  vinted: "Vinted",
  ebay: "eBay",
  lbc: "leboncoin",
};
