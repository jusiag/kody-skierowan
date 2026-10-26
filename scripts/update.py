"""Codzienna aktualizacja słownika ICD-9 PL CM.

Co robi (kolejność):
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
import urllib.request
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert as cv  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "icd9.json")
META = os.path.join(ROOT, "data", "meta.json")
INCOMING = os.path.join(ROOT, "incoming")
NFZ_PAGE = "https://www.nfz.gov.pl/dla-swiadczeniodawcy/slowniki/pliki-icd-9-pl/"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36 kody-icd9-updater"
)


def log(msg):
    print(msg, flush=True)


def http_get(url, binary=False):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Language": "pl,en;q=0.8"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    return body if binary else body.decode("utf-8", "replace")


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


def install(data, source, meta):
    old = meta.get("count") or 0
    if old and data["count"] < old * 0.9:
        raise RuntimeError(
            f"Nowy słownik ma {data['count']} kodów, a obecny {old}. Różnica jest podejrzanie duża, "
            "więc niczego nie podmieniam. Sprawdź plik ręcznie."
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
        install(data, "ręcznie dodany plik " + os.path.basename(path), meta)
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
        try:
            html = http_get(NFZ_PAGE)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Nie udało się otworzyć strony NFZ ({e}). Serwer NFZ mógł zablokować automat GitHuba "
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
            try:
                blob = http_get(url, binary=True)
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(
                    f"Nie udało się pobrać pliku {url} ({e}). NFZ mógł zablokować pobieranie przez automat; "
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
