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
from unittest import mock

import lbc
from lbc import Blocked, attribute, collect_cards, normalize, parse_date, price_of


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


def ad(list_id: int, subject: str) -> dict:
    """Le minimum que `normalize` accepte."""
    return {"list_id": list_id, "subject": subject, "price": [10]}


class Rotation(unittest.TestCase):
    """La tranche de cartes interrogée à chaque passage.

    C'est le seul endroit du collecteur où un passage dépend du précédent, donc
    le seul qui puisse dériver en silence : un offset qui n'avance pas rejoue
    éternellement les douze mêmes cartes, et un dictionnaire remplacé au lieu
    d'être complété fait perdre à chaque carte ses annonces dès qu'elle sort de
    la tranche. Ni l'un ni l'autre ne lève, ni ne se voit dans le journal.
    """

    QUERIES = [{"cardId": f"c{i}", "query": f"carte {i}"} for i in range(10)]

    def setUp(self):
        # Le collecteur s'impose 2 s entre deux requêtes : trente secondes de
        # suite de tests pour une arithmétique d'index.
        patch = mock.patch.object(lbc.time, "sleep")
        patch.start()
        self.addCleanup(patch.stop)

    def collect(self, previous=None, slice_size=3, fail=()):
        def fake_search(session, query, page):
            if query in fail:
                raise Blocked(f"HTTP 403 sur « {query} »")
            return [ad(hash(query) % 10_000, query)]

        with mock.patch.object(lbc, "search", fake_search),              mock.patch.object(lbc, "CARD_SLICE", slice_size):
            return collect_cards(None, self.QUERIES, previous or {}, verbose=False)

    def test_premier_passage_prend_la_premiere_tranche(self):
        cards, offset, problems = self.collect()
        self.assertEqual(sorted(cards), ["c0", "c1", "c2"])
        self.assertEqual(offset, 3)
        self.assertEqual(problems, [])

    def test_le_passage_suivant_reprend_ou_on_en_etait(self):
        cards, offset, _ = self.collect({"offset": 3, "cards": {}})
        self.assertEqual(sorted(cards), ["c3", "c4", "c5"])
        self.assertEqual(offset, 6)

    def test_le_tour_boucle(self):
        cards, offset, _ = self.collect({"offset": 9, "cards": {}})
        # Neuf, zéro, un : la tranche enjambe la fin de liste plutôt que de
        # s'arrêter court, sinon la dernière carte serait servie seule.
        self.assertEqual(sorted(cards), ["c0", "c1", "c9"])
        self.assertEqual(offset, 2)

    def test_les_cartes_hors_tranche_gardent_leurs_annonces(self):
        """Le cœur de la rotation : compléter, jamais remplacer."""
        kept = normalize(ad(1, "vieux"))
        previous = {"offset": 0, "cards": {"c7": {"at": 1, "items": [kept]}}}
        cards, _, _ = self.collect(previous)
        self.assertIn("c7", cards)
        self.assertEqual(cards["c7"]["items"][0]["title"], "vieux")
        self.assertEqual(cards["c7"]["at"], 1)

    def test_une_carte_refusee_n_emporte_pas_les_autres(self):
        cards, offset, problems = self.collect(fail={"carte 1"})
        self.assertEqual(sorted(cards), ["c0", "c2"])
        self.assertEqual(len(problems), 1)
        # L'offset avance quand même : réessayer la carte refusée au prochain
        # passage retarderait les dix autres pour une annonce qui, neuf fois
        # sur dix, n'existe pas.
        self.assertEqual(offset, 3)

    def test_sans_requetes_rien_a_faire(self):
        """La veille n'a pas encore tourné : pas une requête, pas une erreur."""
        with mock.patch.object(lbc, "search", mock.Mock(side_effect=AssertionError)):
            cards, offset, problems = collect_cards(None, [], {}, verbose=False)
        self.assertEqual((cards, offset, problems), ({}, 0, []))


class Reseau(unittest.TestCase):
    """Les pannes de réseau, distinctes des refus de Datadome.

    Relevé sur la tablette le 3 septembre 2026 : vingt-deux passages tombés sur
    un nom irrésoluble, un sur un délai dépassé — et ce dernier emportait le
    passage entier, faute d'être rattrapé dans la boucle des cartes.
    """

    def setUp(self):
        patch = mock.patch.object(lbc.time, "sleep")
        self.sleep = patch.start()
        self.addCleanup(patch.stop)

    def test_une_erreur_curl_devient_unreachable(self):
        session = mock.Mock()
        session.get.side_effect = lbc.requests.exceptions.DNSError("Could not resolve host")
        with self.assertRaises(lbc.Unreachable) as caught:
            lbc.search(session, "lot cartes pokemon", 1)
        self.assertNotIsInstance(caught.exception, Blocked)
        self.assertIn("Could not resolve host", str(caught.exception))

    def test_une_seconde_chance_apres_une_pause(self):
        calls = []

        def flaky():
            calls.append(1)
            if len(calls) == 1:
                raise lbc.Unreachable("réseau")
            return "ok"

        self.assertEqual(lbc.patiently(flaky), "ok")
        self.assertEqual(len(calls), 2)
        self.sleep.assert_called_once_with(lbc.UNREACHABLE_PAUSE_S)

    def test_pas_de_troisieme_chance(self):
        def down():
            raise lbc.Unreachable("réseau")

        with self.assertRaises(lbc.Unreachable):
            lbc.patiently(down)

    def test_une_carte_injoignable_ne_stoppe_pas_la_tranche(self):
        queries = [{"cardId": f"c{i}", "query": f"carte {i}"} for i in range(3)]

        def fake_search(session, query, page):
            if query == "carte 1":
                raise lbc.Unreachable("réseau sur « carte 1 »")
            return [ad(hash(query) % 10_000, query)]

        with mock.patch.object(lbc, "search", fake_search), mock.patch.object(lbc, "CARD_SLICE", 3):
            cards, offset, problems = collect_cards(None, queries, {}, verbose=False)

        # Les deux autres cartes sont relevées, la panne est notée, le tour avance.
        self.assertEqual(sorted(cards), ["c0", "c2"])
        self.assertEqual(offset, 0)
        self.assertEqual(len(problems), 1)
        self.assertIn("carte 1", problems[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
