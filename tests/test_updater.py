"""Testy skryptów pobierających dane (bez internetu).
Uruchomienie (z głównego folderu repozytorium):  python3 -m unittest discover -s tests -p "test_*.py" -v
Sprawdzają: jawny User-Agent, robots.txt, tylko domena NFZ, limity rozmiaru, próg zmian nazw.
Żaden test nie łączy się z siecią (połączenia są podmieniane)."""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import check_resort as cr  # noqa: E402
import update as u  # noqa: E402


def codes(n, rename=0):
    """Syntetyczny słownik: n kodów, z czego `rename` ma zmienioną nazwę."""
    return [[f"10.{i}", ("Zmieniona nazwa " if i < rename else "Nazwa ") + str(i), 2, "10", 0] for i in range(n)]


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


class UserAgent(unittest.TestCase):
    def test_nie_udaje_przegladarki(self):
        for ua in (u.UA, cr.UA):
            self.assertNotIn("Mozilla", ua)
            self.assertNotIn("Chrome", ua)
            self.assertNotIn("Safari", ua)

    def test_zawiera_nazwe_i_adres_kontaktowy(self):
        for ua in (u.UA, cr.UA):
            self.assertIn("kody-skierowan", ua)
            self.assertIn("https://github.com/", ua)

    def test_czysty_ascii(self):
        for ua in (u.UA, cr.UA):
            ua.encode("ascii")  # polskie znaki w nagłówku HTTP powodowałyby błąd


class Domena(unittest.TestCase):
    def test_dozwolone(self):
        for url in ("https://www.nfz.gov.pl/x.xlsx", "https://nfz.gov.pl/", "https://WWW.NFZ.GOV.PL/a"):
            self.assertTrue(u.is_allowed_url(url), url)

    def test_zabronione(self):
        for url in (
            "http://www.nfz.gov.pl/x.xlsx",             # bez https
            "https://evil.example.com/x.xlsx",
            "https://nfz.gov.pl.evil.com/x.xlsx",       # podszycie pod domenę
            "https://evilnfz.gov.pl/x",                 # inna domena kończąca się podobnie
            "https://www.nfz.gov.pl@evil.com/x",        # użytkownik@host
            "ftp://www.nfz.gov.pl/x",
            "file:///etc/passwd",
            "//www.nfz.gov.pl/x",
            "",
        ):
            self.assertFalse(u.is_allowed_url(url), url)

    def test_http_get_odmawia_obcego_adresu_bez_polaczenia(self):
        with mock.patch.object(u.OPENER, "open", side_effect=AssertionError("nie wolno się łączyć")):
            with self.assertRaises(RuntimeError):
                u.http_get("https://evil.example.com/a.xlsx", binary=True)

    def test_przekierowanie_poza_domene_jest_blokowane(self):
        h = u._SafeRedirect()
        req = u.urllib.request.Request("https://www.nfz.gov.pl/a")
        with self.assertRaises(urllib.error.URLError):
            h.redirect_request(req, None, 302, "Found", {}, "https://evil.example.com/b")
        with self.assertRaises(urllib.error.URLError):
            h.redirect_request(req, None, 302, "Found", {}, "http://www.nfz.gov.pl/b")
        ok = h.redirect_request(req, io.BytesIO(b""), 302, "Found", {}, "https://www.nfz.gov.pl/b")
        self.assertIsNotNone(ok)

    def test_link_do_obcej_domeny_na_stronie_nie_jest_pobierany(self):
        html = '<a href="https://evil.example.com/icd-9_pl_cm_v_9.99.xlsx">plik</a> Aktualna wersja ICD-9 PL CM 9.99'
        with tempfile.TemporaryDirectory() as d:
            page = os.path.join(d, "page.html")
            with open(page, "w", encoding="utf-8") as f:
                f.write(html)
            meta = os.path.join(d, "meta.json")
            with open(meta, "w", encoding="utf-8") as f:
                json.dump({"version": "5.90", "count": 100}, f)
            with mock.patch.object(u, "META", meta), mock.patch.object(u, "INCOMING", d), \
                    mock.patch.object(u.OPENER, "open", side_effect=AssertionError("nie wolno się łączyć")), \
                    mock.patch.object(sys, "argv", ["update.py", "--page-file", page]):
                with self.assertRaises(RuntimeError):
                    u.main()


class Limity(unittest.TestCase):
    def test_zbyt_duza_odpowiedz_jest_odrzucana(self):
        big = FakeResponse(b"x" * 200)
        with mock.patch.object(u.OPENER, "open", return_value=big):
            with self.assertRaises(RuntimeError):
                u.http_get("https://www.nfz.gov.pl/a", binary=True, limit=100)

    def test_odpowiedz_w_limicie_przechodzi(self):
        with mock.patch.object(u.OPENER, "open", return_value=FakeResponse(b"abc")):
            self.assertEqual(u.http_get("https://www.nfz.gov.pl/a", binary=True, limit=100), b"abc")

    def test_limity_maja_sensowne_wartosci(self):
        self.assertGreaterEqual(u.MAX_FILE_BYTES, 5 * 1024 * 1024)   # obecny plik ma ok. 1 MB
        self.assertLessEqual(u.MAX_FILE_BYTES, 100 * 1024 * 1024)


class Robots(unittest.TestCase):
    URL = "https://www.nfz.gov.pl/dla-swiadczeniodawcy/slowniki/pliki-icd-9-pl/"

    def allows(self, text):
        with mock.patch.object(u, "http_get", return_value=text):
            return u.robots_allows(self.URL)

    def test_zakaz_dla_wszystkich(self):
        self.assertFalse(self.allows("User-agent: *\nDisallow: /\n"))

    def test_zakaz_dla_naszego_automatu(self):
        self.assertFalse(self.allows("User-agent: kody-skierowan-updater\nDisallow: /\n"))

    def test_zakaz_innej_sciezki_nie_blokuje(self):
        self.assertTrue(self.allows("User-agent: *\nDisallow: /admin/\n"))

    def test_zakaz_tej_sciezki(self):
        self.assertFalse(self.allows("User-agent: *\nDisallow: /dla-swiadczeniodawcy/\n"))

    def test_pusty_plik_zezwala(self):
        self.assertTrue(self.allows(""))

    def err(self, code):
        e = urllib.error.HTTPError("https://www.nfz.gov.pl/robots.txt", code, "x", {}, None)
        with mock.patch.object(u, "http_get", side_effect=e):
            return u.robots_allows(self.URL)

    def test_brak_pliku_404_zezwala(self):
        self.assertTrue(self.err(404))

    def test_brak_polaczenia_to_czytelny_blad(self):
        with mock.patch.object(u, "http_get", side_effect=urllib.error.URLError("brak sieci")):
            with self.assertRaises(RuntimeError) as cm:
                u.robots_allows(self.URL)
        self.assertIn("incoming", str(cm.exception))

    def test_blad_serwera_5xx_nie_zezwala(self):
        self.assertFalse(self.err(503))

    def test_require_robots_zglasza_czytelny_blad(self):
        with mock.patch.object(u, "robots_allows", return_value=False):
            with self.assertRaises(RuntimeError) as cm:
                u.require_robots(self.URL)
        self.assertIn("incoming", str(cm.exception))

    def test_robots_pobierany_z_tego_samego_hosta(self):
        with mock.patch.object(u, "http_get", return_value="") as g:
            u.robots_allows(self.URL)
        self.assertEqual(g.call_args[0][0], "https://www.nfz.gov.pl/robots.txt")


class ProgZmian(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = os.path.join(self.tmp.name, "icd9.json")
        self.meta = os.path.join(self.tmp.name, "meta.json")
        with open(self.data, "w", encoding="utf-8") as f:
            json.dump({"version": "5.90", "count": 100, "codes": codes(100)}, f)
        self.patches = [mock.patch.object(u, "DATA", self.data), mock.patch.object(u, "META", self.meta)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def new(self, n=100, rename=0):
        return {"version": "5.91", "count": n, "codes": codes(n, rename), "notes": {}}

    def test_ratio(self):
        self.assertEqual(u.name_change_ratio(codes(10), codes(10)), 0.0)
        self.assertEqual(u.name_change_ratio(codes(10), codes(10, rename=5)), 0.5)
        self.assertEqual(u.name_change_ratio(codes(10), [["99.9", "x", 2, "", 0]]), 1.0)

    def test_mala_zmiana_przechodzi(self):
        u.install(self.new(rename=5), "test", {"count": 100})
        with open(self.data, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["version"], "5.91")

    def test_duza_zmiana_nazw_jest_wstrzymana_i_dane_nietkniete(self):
        with self.assertRaises(RuntimeError) as cm:
            u.install(self.new(rename=60), "test", {"count": 100})
        self.assertIn("incoming", str(cm.exception))
        with open(self.data, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["version"], "5.90")

    def test_reczny_plik_omija_prog(self):
        u.install(self.new(rename=60), "test", {"count": 100}, manual=True)
        with open(self.data, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["version"], "5.91")

    def test_spadek_liczby_kodow_nadal_blokuje(self):
        with self.assertRaises(RuntimeError):
            u.install(self.new(n=80), "test", {"count": 100})

    def test_pierwsza_instalacja_bez_starego_pliku(self):
        os.remove(self.data)
        u.install(self.new(rename=100), "test", {})
        self.assertTrue(os.path.exists(self.data))


class StronaNFZ(unittest.TestCase):
    def test_wybor_najnowszej_wersji_dziala_jak_wczesniej(self):
        html = ('<a href="/gfx/x/icd-9_pl_cm_v_5.89.xlsx">a</a><a href="/gfx/x/icd-9_pl_cm_v_5.90.xlsx">b</a>'
                " Aktualna wersja ICD-9 PL CM 5.90")
        ver, url = u.find_latest(html, "https://www.nfz.gov.pl/dla-swiadczeniodawcy/slowniki/")
        self.assertEqual(ver, "5.90")
        self.assertTrue(u.is_allowed_url(url), url)

    def test_aktualny_adres_ze_zrodla_jest_dozwolony(self):
        with open(os.path.join(ROOT, "data", "meta.json"), encoding="utf-8") as f:
            src = json.load(f).get("source", "")
        self.assertTrue(u.is_allowed_url(src), src)

    def test_brak_linku_to_czytelny_blad(self):
        with self.assertRaises(RuntimeError):
            u.find_latest("<html>blokada</html>", "https://www.nfz.gov.pl/")


class ApiSejmu(unittest.TestCase):
    def test_znany_stan_nie_daje_problemow(self):
        act = {"ELI": "DU/2012/594", "inForce": "IN_FORCE",
               "references": {"Akty zmieniające": [{"id": "DU/2017/999"}], "Inf. o tekście jednolitym": [{"id": "DU/2019/173"}]}}
        self.assertEqual(cr.check(act)[0], [])

    def test_nowy_akt_zmieniajacy_daje_alarm(self):
        act = {"ELI": "DU/2012/594", "inForce": "IN_FORCE",
               "references": {"Akty zmieniające": [{"id": "DU/2017/999"}, {"id": "DU/2026/1"}], "Inf. o tekście jednolitym": [{"id": "DU/2019/173"}]}}
        self.assertTrue(cr.check(act)[0])

    GOOD = {"ELI": "DU/2012/594", "inForce": "IN_FORCE",
            "references": {"Akty zmieniające": [{"id": "DU/2017/999"}], "Inf. o tekście jednolitym": [{"id": "DU/2019/173"}]}}

    def run_main(self, body):
        with tempfile.TemporaryDirectory() as d:
            meta = os.path.join(d, "meta.json")
            with mock.patch.object(cr, "META", meta), \
                    mock.patch.object(cr.urllib.request, "urlopen", return_value=FakeResponse(body)), \
                    mock.patch.object(sys, "argv", ["check_resort.py"]):
                return cr.main()

    def test_poprawna_odpowiedz_api_przechodzi(self):
        self.assertEqual(self.run_main(json.dumps(self.GOOD).encode("utf-8")), 0)

    def test_zbyt_duza_odpowiedz_api_jest_odrzucona_nawet_gdy_poprawna(self):
        body = json.dumps(self.GOOD).encode("utf-8") + b" " * (cr.MAX_BYTES + 10)
        with self.assertRaises(RuntimeError):
            self.run_main(body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
