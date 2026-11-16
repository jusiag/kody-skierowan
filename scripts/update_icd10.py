"""Aktualizacja słownika ICD-10 (rozpoznania).

1. Jeśli w folderze incoming/ leży plik .xml z ICD-10 (pobrany ręcznie z dane.gov.pl), konwertuje go
   (scripts/convert_icd10.py) i podmienia data/icd10.json. Plik z incoming/ jest potem usuwany.
2. Sprawdza w oficjalnym API portalu dane.gov.pl (zbiór 27, Centrum e-Zdrowia), czy nie pojawił się plik
   ICD-10 nowszy niż ten w aplikacji (porównuje „datę danych” zasobu z datą naszego pliku, np. 2021-03-31).
   Jeśli tak, kończy się błędem: GitHub wysyła e-mail, a strona działa dalej na obecnym słowniku.
3. Po udanym sprawdzeniu zapisuje datę w data/meta.json (klucz "icd10").

Słownik ICD-10 zmienia się rzadko (ostatnio 31.03.2021: kody związane z COVID-19), dlatego automat nie pobiera
go sam: nowy plik trzeba świadomie wgrać do incoming/ (instrukcja w incoming/CZYTAJ.txt).
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert_icd10 as cv10  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "icd10.json")
META = os.path.join(ROOT, "data", "meta.json")
INCOMING = os.path.join(ROOT, "incoming")
API = "https://api.dane.gov.pl/1.4/datasets/27/resources?per_page=100"
DATASET_PAGE = "https://dane.gov.pl/pl/dataset/27"
TRIES = 3              # tyle prób połączenia z portalem
TIMEOUT = 90           # sekund na jedną próbę
GRACE_DAYS = 7         # portal może nie odpowiadać tyle dni, zanim przyjdzie e-mail


def log(msg):
    print(msg, flush=True)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def file_date(name):
    """Data z nazwy pliku CeZ, np. ICD10_PL_en_covid_2021_03_31_2.xml -> 2021-03-31."""
    m = re.search(r"(20\d\d)[_-](\d\d)[_-](\d\d)", name)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def process_incoming(meta):
    files = sorted(glob.glob(os.path.join(INCOMING, "*.xml")))
    if not files:
        return False
    m10 = meta.setdefault("icd10", {})
    changed = False
    for path in files:
        name = os.path.basename(path)
        log(f"Wczytuję ręcznie dodany plik ICD-10: {name}")
        try:
            data = cv10.convert(path)
        except BaseException as e:  # noqa: BLE001  (convert kończy się SystemExit przy złym pliku)
            raise RuntimeError(
                f"Plik {name} z folderu incoming nie nadaje się do wczytania jako ICD-10: {e} "
                "Usuń go z folderu incoming (otwórz plik, kliknij kosz) i wgraj poprawny plik XML z dane.gov.pl."
            ) from None
        old = m10.get("count") or 0
        if old and data["count"] < old * 0.9:
            raise RuntimeError(
                f"Nowy słownik ICD-10 ma {data['count']} kodów, a obecny {old}. Różnica jest podejrzanie duża, "
                "więc niczego nie podmieniam. Sprawdź plik ręcznie."
            )
        tmp = DATA + ".new"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, DATA)
        m10.update({"version": data["version"], "count": data["count"], "fileDate": file_date(name),
                    "source": "ręcznie dodany plik " + name, "updatedAt": now_iso()})
        write_meta(meta)
        log(f"Zapisano słownik ICD-10 {data['version']}: {data['count']} kodów.")
        os.remove(path)
        changed = True
    return changed


def walk_resources(obj):
    """Zasoby z odpowiedzi API (format JSON:API): zwraca listę słowników atrybutów z polem id."""
    items = obj.get("data") if isinstance(obj, dict) else None
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        a = dict(it.get("attributes") or {})
        a["id"] = it.get("id")
        out.append(a)
    return out


def icd10_xml_resources(resources):
    def is_icd10(a):
        title = (a.get("title") or "") + " " + (a.get("description") or "")
        fmt = (a.get("format") or "").lower()
        return "icd-10" in title.lower().replace("icd10", "icd-10") and fmt == "xml"
    return [a for a in resources if is_icd10(a)]


def resource_date(a):
    for key in ("data_date", "data date", "modified", "created"):
        v = a.get(key)
        if v:
            return str(v)[:10]
    return None


def ensure_meta(meta):
    """Pierwsze uruchomienie: w meta.json nie ma jeszcze klucza icd10. Uzupełniamy go z data/icd10.json."""
    m10 = meta.setdefault("icd10", {})
    if m10.get("fileDate") and m10.get("version"):
        return m10
    with open(DATA, encoding="utf-8") as f:
        d = json.load(f)
    m = re.search(r"(\d\d)\.(\d\d)\.(20\d\d)", d.get("version", ""))
    m10.setdefault("version", d.get("version"))
    m10.setdefault("count", d.get("count"))
    if m:
        m10.setdefault("fileDate", f"{m.group(3)}-{m.group(2)}-{m.group(1)}")
    return m10


def check_portal(meta, payload):
    m10 = ensure_meta(meta)
    ours = m10.get("fileDate")
    if not ours:
        raise RuntimeError("W data/meta.json brakuje daty obecnego pliku ICD-10 (icd10.fileDate).")
    res = icd10_xml_resources(walk_resources(payload))
    if not res:
        raise RuntimeError(
            f"W API dane.gov.pl nie znalazłem zasobu XML z ICD-10 (zbiór 27). Portal mógł zmienić budowę. "
            f"Sprawdź ręcznie: {DATASET_PAGE}"
        )
    newest = max((resource_date(a) or "" for a in res), default="")
    if newest and newest > ours:
        titles = "; ".join(f"{a.get('title')} (data danych {resource_date(a)})" for a in res if (resource_date(a) or "") > ours)
        raise RuntimeError(
            f"Na dane.gov.pl jest nowszy plik ICD-10 niż w aplikacji ({ours}): {titles}. "
            f"Pobierz go z {DATASET_PAGE} i wgraj (bez zmiany nazwy) do folderu incoming."
        )
    m10["checkedAt"] = now_iso()
    m10["portalNewest"] = newest
    write_meta(meta)
    log(f"ICD-10: na dane.gov.pl nie ma nowszego pliku (najnowszy: {newest}, w aplikacji: {ours}).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-file", help="(testy) odpowiedź API z pliku zamiast z sieci")
    args = ap.parse_args()
    meta = read_meta()
    process_incoming(meta)
    if args.json_file == "TIMEOUT":  # (testy) udawany brak odpowiedzi portalu
        payload = None
    elif args.json_file:
        with open(args.json_file, encoding="utf-8") as f:
            payload = json.load(f)
    else:
        payload = fetch_api()
    if payload is None:
        return portal_unreachable(meta)
    meta.get("icd10", {}).pop("failingSince", None)
    check_portal(meta, payload)
    return 0


def fetch_api():
    """Kilka prób z przerwą. Zwraca odpowiedź albo None, gdy portal nie odpowiada."""
    req = urllib.request.Request(API, headers={"User-Agent": "kody-skierowan-check", "Accept": "application/json"})
    for i in range(TRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"Próba {i + 1}/{TRIES}: portal dane.gov.pl nie odpowiedział ({e}).")
            if i + 1 < TRIES:
                time.sleep(30)
    return None


def portal_unreachable(meta):
    """Brak odpowiedzi portalu to zwykle chwilowa awaria. E-mail (błąd) dopiero, gdy trwa to dłużej niż GRACE_DAYS."""
    m10 = ensure_meta(meta)
    since = m10.setdefault("failingSince", now_iso())
    write_meta(meta)
    days = (dt.datetime.now(dt.timezone.utc) - dt.datetime.strptime(since, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).days
    if days >= GRACE_DAYS:
        raise RuntimeError(
            f"Portal dane.gov.pl nie odpowiada automatowi od {days} dni (od {since[:10]}). "
            f"Sprawdź ręcznie na {DATASET_PAGE}, czy jest nowszy plik ICD-10 niż {m10.get('fileDate')}."
        )
    print(f"::warning::Portal dane.gov.pl nie odpowiedział (od {since[:10]}). Spróbuję jutro; e-mail przyjdzie dopiero po {GRACE_DAYS} dniach bez odpowiedzi.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"::error::{e}", flush=True)
        sys.exit(1)
