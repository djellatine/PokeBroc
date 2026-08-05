"""
Tests du collecteur leboncoin.

    python collect/test_lbc.py

La normalisation est la seule partie du script qui puisse échouer en silence.
Une requête bloquée se voit — code de sortie, message, instantané vide. Un
fuseau mal converti, non : la fenêtre de trois heures se vide d'un tiers en
hiver et se remplit de bruit en été, sans qu'aucune erreur ne soit levée.
D'où une suite concentrée sur les dates et sur les champs que leboncoin publie
sous une forme inattendue — le prix en liste, les attributs en tableau.
"""

import unittest
from datetime import datetime, timezone

from lbc import attribute, normalize, parse_date, price_of


class ParseDate(unittest.TestCase):
    """`first_publication_date` est publié en heure de Paris, sans fuseau."""

    def test_heure_ete(self):
        # 5 août 2026, 12 h à Paris (UTC+2) = 10 h UTC.
        expected = datetime(2026, 8, 5, 10, 0, 0, tzinfo=timezone.utc).timestamp() * 1000
        self.assertEqual(parse_date("2026-08-05 12:00:00"), int(expected))

    def test_heure_hiver(self):
        # 15 janvier 2026, 12 h à Paris (UTC+1) = 11 h UTC. Le décalage change,
        # et c'est précisément ce qu'un `timestamp()` naïf raterait.
        expected = datetime(2026, 1, 15, 11, 0, 0, tzinfo=timezone.utc).timestamp() * 1000
        self.assertEqual(parse_date("2026-01-15 12:00:00"), int(expected))

    def test_millisecondes(self):
        """Le reste du projet compte en millisecondes epoch, pas en secondes."""
        value = parse_date("2026-08-05 12:00:00")
        self.assertGreater(value, 1_000_000_000_000)

    def test_absente_ou_illisible(self):
        self.assertIsNone(parse_date(None))
        self.assertIsNone(parse_date(""))
        self.assertIsNone(parse_date("hier"))


class PriceOf(unittest.TestCase):
    """Leboncoin publie le prix en liste — `[55]` — et parfois pas du tout."""

    def test_liste(self):
        self.assertEqual(price_of({"price": [55]}), 55.0)

    def test_liste_vide_retombe_sur_les_centimes(self):
        self.assertEqual(price_of({"price": [], "price_cents": 4250}), 42.5)

    def test_absent(self):
        self.assertIsNone(price_of({}))

    def test_scalaire(self):
        self.assertEqual(price_of({"price": 30}), 30.0)


class Attribute(unittest.TestCase):
    """Les attributs arrivent en tableau de dictionnaires, pas en dictionnaire."""

    AD = {
        "attributes": [
            {"key": "condition", "value": "2", "value_label": "Très bon état"},
            {"key": "shippable", "value": "true"},
        ]
    }

    def test_prefere_le_libelle(self):
        # `condition()` côté TypeScript lit du français, pas un code numérique.
        self.assertEqual(attribute(self.AD, "condition"), "Très bon état")

    def test_retombe_sur_la_valeur_brute(self):
        self.assertEqual(attribute(self.AD, "shippable"), "true")

    def test_absent(self):
        self.assertIsNone(attribute(self.AD, "couleur"))
        self.assertIsNone(attribute({}, "condition"))


class Normalize(unittest.TestCase):
    AD = {
        "list_id": 3208812061,
        "subject": "Lot 100 cartes Pokémon avec une holo",
        "url": "https://www.leboncoin.fr/ad/collection/3208812061",
        "first_publication_date": "2026-08-05 12:00:00",
        "index_date": "2026-08-05 18:00:00",
        "price": [45],
        "images": {"small_url": "https://img.leboncoin.fr/a-small.jpg",
                   "thumb_url": "https://img.leboncoin.fr/a-thumb.jpg"},
        "attributes": [{"key": "condition", "value_label": "Bon état"}],
        "location": {"city": "Limoges"},
        "owner": {"name": "Alex", "type": "private"},
    }

    def test_champs_attendus_par_toLot(self):
        item = normalize(self.AD)
        self.assertEqual(item["id"], 3208812061)
        self.assertEqual(item["title"], "Lot 100 cartes Pokémon avec une holo")
        self.assertEqual(item["price"], 45.0)
        self.assertEqual(item["status"], "Bon état")
        self.assertEqual(item["city"], "Limoges")
        self.assertEqual(item["seller"], "Alex")
        self.assertFalse(item["promoted"])
        self.assertEqual(item["favourites"], 0)

    def test_date_de_publication_et_non_de_remontee(self):
        """
        Le tri de leboncoin porte sur `index_date`. Retenir cette date-là
        ferait passer une annonce de deux mois pour une nouveauté — c'est
        l'erreur que la fenêtre de trois heures est censée écarter.
        """
        item = normalize(self.AD)
        self.assertEqual(item["createdAt"], parse_date("2026-08-05 12:00:00"))
        self.assertNotEqual(item["createdAt"], parse_date("2026-08-05 18:00:00"))

    def test_prefere_la_petite_image_a_la_vignette(self):
        self.assertEqual(normalize(self.AD)["thumbnail"], "https://img.leboncoin.fr/a-small.jpg")

    def test_pas_de_prix_total(self):
        """Le mode de remise se choisit à l'achat : aucun total à annoncer."""
        self.assertIsNone(normalize(self.AD)["totalPrice"])

    def test_annonce_mutilee_ecartee(self):
        self.assertIsNone(normalize({"subject": "Lot sans identifiant"}))
        self.assertIsNone(normalize({"list_id": 42, "subject": "   "}))
        self.assertIsNone(normalize({}))

    def test_url_reconstruite_si_absente(self):
        ad = dict(self.AD)
        del ad["url"]
        self.assertIn("3208812061", normalize(ad)["url"])

    def test_annonce_sans_image_ni_etat(self):
        item = normalize({"list_id": 1, "subject": "Lot cartes", "price": [5]})
        self.assertIsNone(item["thumbnail"])
        self.assertIsNone(item["status"])
        self.assertIsNone(item["city"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
