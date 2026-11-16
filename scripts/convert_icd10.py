"""Konwersja słownika ICD-10 (polska wersja Centrum e-Zdrowia, plik XML z Rejestru Systemów Kodowania / dane.gov.pl)
do pliku data/icd10.json, w tej samej postaci co data/icd9.json.

Użycie:  python scripts/convert_icd10.py incoming/ICD10_....xml data/icd10.json

Co robi (kodów i nazw NIE zmienia):
- rozdziały (np. „A00–B99”) i bloki (np. „A00–A09”) zostają kategoriami ogólnymi, tak jak w Tomie I;
- kategoria (np. „J45”) i podkategoria (np. „J45.0”) to kody;
- 117 kategorii (np. E10–E14, F10–F19, K25–K28) ma podkategorie zapisane w pliku tylko schematem
  („.0 Ze śpiączką … .9 Bez powikłań”). Pełny kod składamy jak w Tomie I: E11 + .9 = E11.9,
  nazwa: „<nazwa kategorii> – <nazwa z schematu>”;
- znaki † i * (system „sztylet–gwiazdka”) nie są częścią kodu: kod zapisujemy bez nich, znak osobno (marks);
- węzły bez kodu z nazwą to określenia włączone („Obejmuje”), np. pod A00.0 „Cholera klasyczna”;
- cyfry 5. znaku (umiejscowienie w rozdziale M, złamanie zamknięte/otwarte w S/T) nie są osobnymi kodami
  w polskiej praktyce; zapisujemy je jako uwagę przy kategorii;
- adnotacje (annotationPL), np. przy U07.1, zapisujemy jako uwagi.

Wynik: {"version", "source", "count", "codes": [[kod, nazwa, poziom 0–3, kodRodzica, maKody 0/1]],
         "notes": {kod: {"i": [...], "u": [...]}}, "marks": {kod: "†" | "*"}}
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

NS = "{http://rsk.rejestrymedyczne.csioz.gov.pl}"
CAT_RE = re.compile(r"^([A-Z]\d\d(?:\.\d)?)([†*]?)$")
SCHEME_RE = re.compile(r"^\.(\d)([†*]?)$")
FIFTH_RE = re.compile(r"^\d$")
RANGE_RE = re.compile(r"^[A-Z]\d\d–[A-Z]\d\d$")
MIN_CODES = 10000  # zabezpieczenie: polski ICD-10 ma ok. 12,5 tys. kodów


def kids_of(node):
    return node.findall(NS + "nodes/" + NS + "node")


def name_of(node):
    return " ".join((node.findtext(NS + "name") or "").split())


def annotations(node):
    return [" ".join((a.text or "").split()) for a in node.findall(NS + "attributes/" + NS + "attribute")
            if a.get("name") == "annotationPL" and (a.text or "").strip()]


def convert(xml_path):
    root = ET.parse(xml_path).getroot()
    version_name = (root.findtext(NS + "name") or "ICD-10").strip()
    # Data aktualizacji jest w nazwie pliku CeZ, np. ICD10_PL_en_covid_2021_03_31_2.xml
    m = re.search(r"(20\d\d)[_-](\d\d)[_-](\d\d)", xml_path.replace("\\", "/").split("/")[-1])
    if m:
        version_name += f", aktualizacja z {m.group(3)}.{m.group(2)}.{m.group(1)}"
    codes, notes, marks = [], {}, {}
    seen = set()

    def add(code, name, lvl, parent):
        if code in seen:
            raise SystemExit(f"Powtórzony kod {code}: plik ma nieznaną budowę, sprawdź ręcznie.")
        seen.add(code)
        codes.append([code, name, lvl, parent, 0])

    def note(code, kind, text):
        if text:
            notes.setdefault(code, {}).setdefault(kind, []).append(text)

    def inclusions(node, code, prefix=""):
        """Określenia włączone: węzły bez kodu, z nazwą (także zagnieżdżone, np. „Salmonellozowe:” > „zapalenie płuc”)."""
        for c in kids_of(node):
            if (c.get("code") or "") != "":
                continue
            n = name_of(c)
            if not n:
                inclusions(c, code, prefix)
                continue
            full = (prefix + " " + n).strip() if prefix else n
            sub = [k for k in kids_of(c) if (k.get("code") or "") == "" and name_of(k)]
            if n.endswith(":") and sub:
                inclusions(c, code, full)
            else:
                note(code, "i", full)
                inclusions(c, code, full if n.endswith(":") else "")

    def category(node, parent, lvl):
        m = CAT_RE.match(node.get("code"))
        code, mark = m.group(1), m.group(2)
        cname = name_of(node)
        lvl = 3 if "." in code else 2  # 2 = kategoria (J45), 3 = podkategoria (J45.0)
        add(code, cname, lvl, parent)
        if mark:
            marks[code] = mark
        for a in annotations(node):
            note(code, "u", a)
        inclusions(node, code)
        fifth = []
        for c in kids_of(node):
            cc = c.get("code") or ""
            if CAT_RE.match(cc):
                category(c, code, lvl + 1)
            elif SCHEME_RE.match(cc):
                d, smark = SCHEME_RE.match(cc).groups()
                sub = f"{code}.{d}"
                add(sub, f"{cname} – {name_of(c)}", lvl + 1, code)
                if smark:
                    marks[sub] = smark
                inclusions(c, sub)
            elif FIFTH_RE.match(cc):
                fifth.append(f"{cc} {name_of(c)}")
            elif cc == "" and not name_of(c):
                walk_plain(c, code, lvl + 1)
        if fifth:
            note(code, "u", "Nieobowiązkowy 5. znak kodu: " + "; ".join(fifth) + ".")

    def single_code_block(node):
        """Blok jednokodowy (np. B99, F99, C50, C97): w pliku ma ten sam kod co kategoria w jego środku."""
        own = CAT_RE.match(node.get("code") or "")
        if not own:
            return False
        return any(c is not node and CAT_RE.match(c.get("code") or "")
                   and CAT_RE.match(c.get("code")).group(1) == own.group(1) for c in node.iter(NS + "node"))

    def walk_plain(node, parent, lvl):
        """Przechodzi przez węzły techniczne (bez kodu i nazwy), bloki (np. C00–C75) i bloki jednokodowe."""
        for c in kids_of(node):
            cc = c.get("code") or ""
            if RANGE_RE.match(cc):
                add(cc, name_of(c), min(lvl, 1), parent)
                walk_plain(c, cc, lvl + 1)
            elif CAT_RE.match(cc):
                if single_code_block(c):
                    walk_plain(c, parent, lvl)
                else:
                    category(c, parent, lvl)
            elif cc == "" and not name_of(c):
                walk_plain(c, parent, lvl)

    for chapter in kids_of(root):
        ch = chapter.get("code")
        if not RANGE_RE.match(ch or ""):
            raise SystemExit(f"Nieznany rozdział: {ch!r}")
        add(ch, name_of(chapter), 0, None)
        for block in kids_of(chapter):
            bc = block.get("code") or ""
            if not (RANGE_RE.match(bc) or CAT_RE.match(bc)):
                raise SystemExit(f"Nieznany blok: {bc!r} w {ch}")
        walk_plain(chapter, ch, 1)
    has_kids = {c[3] for c in codes if c[3]}
    for c in codes:
        c[4] = 1 if c[0] in has_kids else 0
    if len(codes) < MIN_CODES:
        raise SystemExit(f"Za mało kodów ({len(codes)}), plik wygląda na niepełny.")
    return {
        "version": version_name,
        "source": "Centrum e-Zdrowia, Rejestr Systemów Kodowania (dane.gov.pl, zbiór 27): Międzynarodowa Statystyczna Klasyfikacja Chorób i Problemów Zdrowotnych ICD-10, polska wersja językowa",
        "count": sum(1 for c in codes if not RANGE_RE.match(c[0])),
        "codes": codes,
        "notes": notes,
        "marks": marks,
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Użycie: python scripts/convert_icd10.py PLIK.xml data/icd10.json")
    out = convert(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Zapisano {out['count']} kodów ICD-10 ({len(out['codes'])} pozycji z rozdziałami i blokami) do {sys.argv[2]}")
