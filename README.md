# Kody do skierowań

Prosta aplikacja (strona instalowana na telefonie jak aplikacja), w której lekarz znajduje:

- **kody procedur ICD-9 PL CM** (słownik NFZ, ok. 10 tys. kodów),
- **kody resortowe** komórek organizacyjnych, czyli poradni i oddziałów (część VIII; rozporządzenie Ministra Zdrowia z 17.05.2012, tekst jednolity z 2019 r., Dz. U. poz. 173).

Aplikacja jest nieoficjalna. Kod zawsze dobiera i potwierdza lekarz.

## Jak to działa

Strona jest statyczna (GitHub Pages), bez serwera i bez zbierania danych. Raz dziennie automat (GitHub Actions):

1. sprawdza stronę NFZ i, gdy jest nowsza wersja słownika, konwertuje ją (`scripts/update.py`),
2. sprawdza w API Sejmu, czy rozporządzenie o kodach resortowych nie doczekało się nowych zmian (`scripts/check_resort.py`),
3. publikuje stronę, wpisując w nią datę ostatniego sprawdzenia.

Gdy któryś krok się nie uda albo przepisy się zmienią, GitHub wysyła e-mail. Strona nadal działa na dotychczasowych danych.

## Pliki

- `index.html`, `app.js`: strona i jej działanie
- `resort.js`: tabela kodów resortowych
- `data/icd9.json`, `data/meta.json`: słownik ICD-9 i dane o sprawdzeniach
- `scripts/`: konwersja słownika i oba sprawdzenia
- `incoming/`: miejsce na ręcznie pobrany plik .xlsx z NFZ, gdy automat nie może go pobrać
- `.github/workflows/update.yml`: codzienny automat

## Gdy przyjdzie e-mail o problemie

- **NFZ:** pobierz plik ze strony https://www.nfz.gov.pl/dla-swiadczeniodawcy/slowniki/pliki-icd-9-pl/ i wgraj go (bez zmiany nazwy) do folderu `incoming`.
- **Kody resortowe:** otwórz ISAP, Dz. U. 2012 poz. 594, zakładka „Akty zmieniające”. Nowy akt trzeba wprowadzić do `resort.js`, a w `scripts/check_resort.py` dopisać go do znanych (`KNOWN_AMENDMENTS`).

Dane NFZ należą do NFZ. Źródła i zastrzeżenie są widoczne na dole strony.
