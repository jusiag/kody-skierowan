"""Codzienna aktualizacja słownika ICD-9 PL CM.

Co robi (kolejność; szczegóły bezpieczeństwa: jawny User-Agent, robots.txt, tylko domena nfz.gov.pl, limity rozmiaru, próg zmian nazw):
 1. Jeśli w folderze incoming/ leży plik .xlsx pobrany ręcznie z NFZ, konwertuje go
    (to awaryjna droga, gdy serwer NFZ nie wpuszcza automatu).
 2. W przeciwnym razie otwiera stronę słownika NFZ, odczytuje numer aktualnej wersji
    i link do pliku, a gdy wersja jest nowsza od tej w data/meta.json, pobiera plik.
 3. Konwertuje, sprawdza poprawność i dopiero wtedy podmienia data/icd9.json.
 4. Po udanym sprawdzeniu strony NFZ zapisuje datę w data/meta.json (także gdy wersja
    się nie zmieniła), co utrzymuje repozytorium aktywne.

Kod wyjścia 0 = wszystko w porządku, 1 = nie udało się (workflow zgłosi błąd).
Wynik dla workflow: pisze "changed=true/false" do pliku $GITHUB_OUTPUT.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from urllib import robotparser
from urllib.parse import urljoin, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert as cv  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "icd9.json")
META = os.path.join(ROOT, "data", "meta.json")
INCOMING = os.path.join(ROOT, "incoming")
NFZ_PAGE = "https://www.nfz.gov.pl/dla-swiadczeniodawcy/slowniki/pliki-icd-9-pl/"
# Przedstawiamy się uczciwie jako automat (z adresem kontaktowym), bez udawania przeglądarki.
# Nagłówek HTTP musi być czystym ASCII, więc bez polskich znaków.
BOT_NAME = "kody-skierowan-updater"
UA = (
    BOT_NAME + "/1.0 (+https://github.com/jusiag/kody-skierowan; "
    "raz dziennie sprawdza wersje slownika ICD-9 PL na stronie NFZ)"
)
ALLOWED_HOST = "nfz.gov.pl"          # pobieramy wyłącznie z tej domeny (i jej subdomen), tylko przez https
MAX_PAGE_BYTES = 5 * 1024 * 1024     # strona HTML i robots.txt
MAX_FILE_BYTES = 25 * 1024 * 1024    # plik .xlsx (obecny ma ok. 1 MB)
MAX_NAME_CHANGE = 0.20               # tyle (20%) nazw kodów może się zmienić bez ręcznego przeglądu


def log(msg):
    print(msg, flush=True)


def is_allowed_url(url):
    """Tylko https i tylko domena NFZ (także po przekierowaniach i dla linku odczytanego ze strony)."""
    p = urlparse(url)
    host = (p.hostname or "").lower()
    return p.scheme == "https" and (host == ALLOWED_HOST or host.endswith("." + ALLOWED_HOST))


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Nie pozwala, żeby serwer przekierował nas poza domenę NFZ."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_allowed_url(newurl):
            raise urllib.error.URLError(f"przekierowanie poza {ALLOWED_HOST}: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(_SafeRedirect)


def http_get(url, binary=False, limit=MAX_PAGE_BYTES):
    if not is_allowed_url(url):
        raise RuntimeError(f"Adres spoza domeny {ALLOWED_HOST} (albo bez https), nie pobieram: {url}")
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Language": "pl,en;q=0.8"}
    )
    with OPENER.open(req, timeout=60) as r:
        body = r.read(limit + 1)
    if len(body) > limit:
        raise RuntimeError(f"Odpowiedź serwera jest większa niż {limit // (1024 * 1024)} MB, przerywam: {url}")
    return body if binary else body.decode("utf-8", "replace")


def robots_allows(url):
    """Czy robots.txt serwera zezwala nam (automatowi) pobrać ten adres.
    Zasady jak w RFC 9309: brak pliku (błąd 4xx) = bez ograniczeń; błąd serwera (5xx) = nie pobieramy."""
    p = urlparse(url)
    robots_url = f"{p.scheme}://{p.netloc}/robots.txt"
    try:
        text = http_get(robots_url)
    except urllib.error.HTTPError as e:
        return e.code < 500
    except (urllib.error.URLError, OSError) as e:
        raise RuntimeError(
            f"Nie udało się odczytać {robots_url} ({e}). Bez tego pliku nie pobieram nic automatem. "
            "Spróbuj ponownie za kilka godzin albo wgraj ręcznie pobrany plik .xlsx do folderu incoming."
        ) from e
    rp = robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    return rp.can_fetch(BOT_NAME, url)


def require_robots(url):
    if not robots_allows(url):
        raise RuntimeError(
            f"robots.txt serwera NFZ nie zezwala automatom na pobranie {url}. Nie obchodzę tego zakazu. "
            "Pobierz plik ręcznie w przeglądarce i wgraj go do folderu incoming (instrukcja w README)."
        )


def read_meta():
    try:
        with open(META, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write_meta(meta):
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def find_latest(html, base):
    """Zwraca (wersja, adres_pliku) najnowszego słownika ze strony NFZ."""
    links = []
    for m in re.finditer(r'href\s*=\s*["\']([^"\']+\.xlsx?)["\']', html, re.I):
        href = m.group(1).replace("&amp;", "&")
        name = href.rsplit("/", 1)[-1]
        ver = cv.version_from_name(name)
        if ver and "cm" in name.lower():
            links.append((ver, urljoin(base, href)))
    if not links:
        raise RuntimeError(
            "Na stronie NFZ nie znalazłam żadnego linku do pliku słownika ICD-9 PL CM. "
            "Strona mogła zmienić układ albo zwróciła stronę blokady."
        )
    best = max(links, key=lambda x: cv.version_key(x[0]))
    # Napis "Aktualna wersja ICD-9 PL CM X.YY" jako dodatkowe potwierdzenie.
    m = re.search(r"Aktualna\s+wersja[^0-9]{0,60}?(\d{1,2}\.\d{2})", re.sub(r"<[^>]+>", " ", html), re.I)
    if m and cv.version_key(m.group(1)) > cv.version_key(best[0]):
        raise RuntimeError(
            f"Strona NFZ podaje aktualną wersję {m.group(1)}, ale nie znalazłam do niej linku "
            f"(najnowszy znaleziony: {best[0]})."
        )
    return best


def name_change_ratio(old_codes, new_codes):
    """Jaka część kodów występujących w obu wersjach ma inną nazwę (0.0 – 1.0)."""
    old = {c[0]: c[1] for c in old_codes}
    common = [c for c in new_codes if c[0] in old]
    if not common:
        return 1.0
    return sum(1 for c in common if old[c[0]] != c[1]) / len(common)


def install(data, source, meta, manual=False):
    old = meta.get("count") or 0
    if old and data["count"] < old * 0.9:
        raise RuntimeError(
            f"Nowy słownik ma {data['count']} kodów, a obecny {old}. Różnica jest podejrzanie duża, "
            "więc niczego nie podmieniam. Sprawdź plik ręcznie."
        )
    # Automat nie publikuje bez przeglądu słownika, w którym zmieniło się dużo nazw (plik o poprawnej
    # strukturze, ale z podmienioną treścią). Plik wgrany ręcznie przez człowieka (manual) uznajemy za sprawdzony.
    if not manual and os.path.exists(DATA):
        try:
            with open(DATA, encoding="utf-8") as f:
                ratio = name_change_ratio(json.load(f)["codes"], data["codes"])
        except (OSError, ValueError, KeyError):
            ratio = 0.0
        if ratio > MAX_NAME_CHANGE:
            raise RuntimeError(
                f"W nowym słowniku zmieniły się nazwy {ratio:.0%} kodów (limit {MAX_NAME_CHANGE:.0%}). "
                "Niczego nie podmieniam. Przejrzyj plik ręcznie i, jeśli jest w porządku, wgraj go do folderu incoming."
            )
    tmp = DATA + ".new"
    cv.write_json(data, tmp)
    os.replace(tmp, DATA)
    meta.update(
        {"version": data["version"], "count": data["count"], "source": source, "updatedAt": now_iso()}
    )
    write_meta(meta)  # od razu, żeby dane i metadane nigdy się nie rozjechały
    log(f"Zapisano słownik {data['version']}: {data['count']} kodów.")


def process_incoming(meta):
    files = sorted(glob.glob(os.path.join(INCOMING, "*.xlsx")))
    if not files:
        return False
    best = None
    for f in files:
        ver = cv.version_from_name(os.path.basename(f))
        if not ver:
            raise RuntimeError(
                f"Nie umiem odczytać numeru wersji z nazwy pliku {os.path.basename(f)}. "
                "Zostaw oryginalną nazwę z NFZ, np. icd-9_pl_cm_v_5.91.xlsx."
            )
        if best is None or cv.version_key(ver) > cv.version_key(best[0]):
            best = (ver, f)
    ver, path = best
    changed = False
    if cv.version_key(ver) > cv.version_key(meta.get("version", "0")):
        log(f"Wczytuję ręcznie dodany plik {os.path.basename(path)} (wersja {ver}).")
        try:
            data = cv.convert(path, ver)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Plik {os.path.basename(path)} z folderu incoming nie nadaje się do wczytania: {e} "
                "Usuń go z folderu incoming (otwórz plik, kliknij kosz) i wgraj poprawny."
            ) from e
        install(data, "ręcznie dodany plik " + os.path.basename(path), meta, manual=True)
        changed = True
    else:
        log(f"Plik {os.path.basename(path)} nie jest nowszy niż obecna wersja {meta.get('version')}.")
    for f in files:
        os.remove(f)
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page-file", help="(testy) czytaj stronę NFZ z pliku zamiast z sieci")
    ap.add_argument("--xlsx-file", help="(testy) użyj tego pliku zamiast pobierać z NFZ")
    args = ap.parse_args()

    meta = read_meta()
    changed = False

    if process_incoming(meta):
        changed = True

    if args.page_file:
        with open(args.page_file, encoding="utf-8") as f:
            html = f.read()
    else:
        log(f"Otwieram stronę NFZ: {NFZ_PAGE}")
        require_robots(NFZ_PAGE)
        try:
            html = http_get(NFZ_PAGE)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Nie udało się otworzyć strony NFZ ({e}). Serwer NFZ nie odpowiedział automatowi, odmówił "
                "albo strona chwilowo nie działa. Spróbuj uruchomić aktualizację ponownie za kilka godzin; "
                "jeśli problem się powtarza, wgraj ręcznie pobrany plik .xlsx do folderu incoming."
            ) from e
    ver, url = find_latest(html, NFZ_PAGE)
    log(f"NFZ: najnowsza wersja {ver} ({url}); w aplikacji: {meta.get('version', 'brak')}")

    if cv.version_key(ver) > cv.version_key(meta.get("version", "0")):
        if args.xlsx_file:
            path = args.xlsx_file
        else:
            log("Pobieram plik słownika...")
            require_robots(url)
            try:
                blob = http_get(url, binary=True, limit=MAX_FILE_BYTES)
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(
                    f"Nie udało się pobrać pliku {url} ({e}). Serwer NFZ mógł odmówić automatowi; "
                    "wgraj ręcznie pobrany plik .xlsx do folderu incoming."
                ) from e
            if blob[:2] != b"PK":
                raise RuntimeError("Pobrany plik nie jest plikiem .xlsx (serwer NFZ mógł zwrócić stronę blokady).")
            fd, path = tempfile.mkstemp(suffix=".xlsx")
            with os.fdopen(fd, "wb") as f:
                f.write(blob)
        data = cv.convert(path, ver)
        install(data, url, meta)
        changed = True
    else:
        log("Aplikacja ma już najnowszą wersję.")

    meta["latestSeen"] = ver
    meta["latestFile"] = url.rsplit("/", 1)[-1]
    meta["checkedAt"] = now_iso()
    write_meta(meta)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 - chcemy czytelny komunikat w logu Actions
        print(f"::error::{e}", flush=True)
        sys.exit(1)
