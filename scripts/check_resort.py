"""Sprawdza, czy rozporządzenie o resortowych kodach identyfikacyjnych (Dz. U. 2012 poz. 594)
zostało zmienione po 2017 r. Używa oficjalnego, publicznego API Sejmu (ELI).

Znana lista (tabela kodów w aplikacji jest zgodna z tym stanem):
  akty zmieniające:  DU/2017/999
  tekst jednolity:   DU/2019/173

Jeśli API pokaże coś innego (nowy akt zmieniający, nowy tekst jednolity, utrata mocy),
skrypt kończy się błędem. Workflow wysyła wtedy e-mail, a data sprawdzenia w aplikacji
przestaje się odświeżać. Tabela kodów wymaga wtedy uzupełnienia ręcznie.
Po udanym sprawdzeniu zapisuje datę w data/meta.json (klucz "resort").
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.request

# Jawny User-Agent z adresem kontaktowym (czysty ASCII, bez udawania przeglądarki).
UA = "kody-skierowan-check/1.0 (+https://github.com/jusiag/kody-skierowan; raz dziennie sprawdza zmiany rozporzadzenia przez API Sejmu)"
MAX_BYTES = 2 * 1024 * 1024  # odpowiedź API to kilka KB; większa jest podejrzana

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "data", "meta.json")
API = "https://api.sejm.gov.pl/eli/acts/DU/2012/594"
KNOWN_AMENDMENTS = {"DU/2017/999"}
KNOWN_CONSOLIDATED = {"DU/2019/173"}


def ids(refs, key):
    return {x.get("id") for x in refs.get(key, []) if x.get("id")}


def check(act):
    """Zwraca listę problemów (pusta = wszystko zgodne ze znanym stanem)."""
    problems = []
    if act.get("ELI") != "DU/2012/594":
        problems.append(f"Odpowiedź dotyczy innego aktu: {act.get('ELI')!r}.")
    if act.get("inForce") != "IN_FORCE":
        problems.append(f"Rozporządzenie nie ma statusu obowiązującego (inForce={act.get('inForce')!r}).")
    refs = act.get("references") or {}
    amend = ids(refs, "Akty zmieniające")
    cons = ids(refs, "Inf. o tekście jednolitym")
    if amend != KNOWN_AMENDMENTS:
        problems.append(f"Zmieniła się lista aktów zmieniających: jest {sorted(amend)}, znane {sorted(KNOWN_AMENDMENTS)}.")
    if cons != KNOWN_CONSOLIDATED:
        problems.append(f"Zmienił się tekst jednolity: jest {sorted(cons)}, znany {sorted(KNOWN_CONSOLIDATED)}.")
    return problems, sorted(amend), sorted(cons)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-file", help="(testy) odpowiedź API z pliku zamiast z sieci")
    args = ap.parse_args()

    if args.json_file:
        with open(args.json_file, encoding="utf-8") as f:
            act = json.load(f)
    else:
        req = urllib.request.Request(API, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError("odpowiedź większa niż 2 MB")
            act = json.loads(body.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"Nie udało się pobrać danych z API Sejmu ({e}). Spróbuj ponownie później.") from e

    problems, amend, cons = check(act)
    if problems:
        raise RuntimeError(
            "Przepisy o kodach resortowych mogły się zmienić. " + " ".join(problems)
            + " Sprawdź w ISAP (Dz. U. 2012 poz. 594, zakładka Akty zmieniające) i uzupełnij tabelę kodów."
        )

    try:
        with open(META, encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        meta = {}
    meta["resort"] = {
        "checkedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "amendments": amend,
        "consolidated": cons,
    }
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("Kody resortowe: bez zmian w przepisach (akty zmieniające: " + ", ".join(amend) + ").")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"::error::{e}", flush=True)
        sys.exit(1)
