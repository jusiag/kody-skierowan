# PROJEKT: Kody do skierowań (notatka dla opiekuna i dla nowej rozmowy z Claude)

Ten plik opisuje, co to jest, dlaczego jest zrobione tak, jak jest, jak to aktualizować i czego nie robić.
Jeśli zaczynasz nową rozmowę z Claude, wgraj ten plik i napisz, co chcesz zmienić.
Stan na: 27.10.2026 (po dodaniu motywu jasny/ciemny i wyników resortowych na górze).

## 1. Cel
Prosta, nieoficjalna aplikacja dla lekarzy: wyszukiwarka kodów do skierowań.
- Kody procedur **ICD-9 PL CM** (słownik NFZ, wersja 5.90, 10 059 kodów).
- Kody **resortowe, część VIII** (4 cyfry, specjalność komórki: poradnia, oddział) z rozporządzenia Ministra Zdrowia.
Lekarze dostają tylko link. Nie ma kont ani logowania. Kod zawsze dobiera lekarz.

## 2. Adresy
- Strona: https://jusiag.github.io/kody-skierowan/
- Repozytorium: https://github.com/jusiag/kody-skierowan (publiczne)
- Zgłoszenia błędów: zakładka Issues w repozytorium

## 3. Źródła danych
- Słownik ICD-9: https://www.nfz.gov.pl/dla-swiadczeniodawcy/slowniki/pliki-icd-9-pl/ (plik .xlsx, nazwa np. icd-9_pl_cm_v_5.90.xlsx). Własność NFZ.
- Kody resortowe: rozporządzenie MZ z 17.05.2012 w sprawie systemu resortowych kodów identyfikacyjnych (Dz. U. 2012 poz. 594), załącznik nr 2, część VIII. Tekst jednolity: Dz. U. 2019 poz. 173. Jedyny akt zmieniający: Dz. U. 2017 poz. 999 (jest w tekście jednolitym).
- § 9 ust. 4 rozporządzenia: komórka dla dzieci ma kod nieparzysty, o 1 wyższy niż kod dla dorosłych (np. 4308 → 4309). Aplikacja wylicza takie kody sama.
- Komunikat NFZ o AP-KOLCE z 27.09.2024 wymienia kody 2302, 2304, 2306, 2314, 4300–4311 i 7400/7401. Wszystkie są w naszej tabeli (kody 2302–2314 i 4300–7400 jako pozycje rozporządzenia, nieparzyste 4301, 4303, 4307, 4309, 4311 i 7401 jako wyliczone dla dzieci wg § 9 ust. 4). Nazwy w tabeli zgadzają się z nagłówkami z komunikatu. Własnych nazw NFZ nie dopisujemy ani nie zgadujemy.
- API Sejmu (sprawdzanie zmian przepisów): https://api.sejm.gov.pl/eli/acts/DU/2012/594

## 4. Jak to działa
Strona statyczna na GitHub Pages, bez serwera i bez zbierania danych. Raz dziennie (ok. 7:30) automat GitHub Actions (`.github/workflows/main.yml`):
1. `scripts/update.py`: sprawdza stronę NFZ. Gdy jest nowsza wersja słownika, pobiera, konwertuje i podmienia `data/icd9.json`. Odmawia podmiany, gdy liczba kodów spada o ponad 10%.
2. `scripts/check_resort.py`: pyta API Sejmu o akty zmieniające rozporządzenie. Jeśli lista różni się od znanej (`KNOWN_AMENDMENTS`, `KNOWN_CONSOLIDATED`), kończy się błędem i GitHub wysyła e-mail.
3. Publikuje stronę, wpisując w nią datę sprawdzeń. Aplikacja pokazuje te daty i ostrzega, gdy są starsze niż 3 dni.
4. Jeśli któryś krok się nie powiedzie, strona nadal działa na starych danych, a GitHub wysyła e-mail.

## 5. Pliki
- `index.html`: strona, style, polityka bezpieczeństwa (CSP).
- `app.js`: cała logika (wyszukiwanie, widoki, aktualność).
- `resort.js`: tabela kodów resortowych (359 pozycji, 10 działów).
- `theme.js`: przełącznik motywu (automatyczny / jasny / ciemny), wybór zapamiętany na urządzeniu.
- `sw.js`: działanie bez internetu.
- `data/icd9.json`: słownik. `data/meta.json`: wersja i daty sprawdzeń.
- `scripts/`: `update.py`, `convert.py`, `check_resort.py`.
- `incoming/`: miejsce na ręcznie pobrany .xlsx, gdy NFZ blokuje automat.
- `.github/workflows/main.yml`, `.github/dependabot.yml`: automat i aktualizacje narzędzi.

## 6. Co robić, gdy przyjdzie e-mail z GitHuba
- **Problem z NFZ:** pobierz plik ze strony NFZ i wgraj go (bez zmiany nazwy) do folderu `incoming`.
- **Zmiana przepisów (kody resortowe):** w ISAP (Dz. U. 2012 poz. 594, zakładka „Akty zmieniające”) sprawdź nowy akt. Wprowadź zmiany w `resort.js` i dopisz akt do `KNOWN_AMENDMENTS` w `scripts/check_resort.py`. Daj też nową datę w opisie aplikacji.
- **Brak e-maili, ale aplikacja ostrzega o starym sprawdzeniu:** w Actions uruchom ręcznie „Run workflow”.

## 7. Ważne decyzje i dlaczego
- **Nazwa „Kody do skierowań”**, bo aplikacja zawiera nie tylko ICD-9.
- **Źródło NFZ i zastrzeżenie** są wyraźnie na dole strony; kody resortowe mają własną ramkę ze źródłem. Wynika z tego, że to narzędzie pomocnicze, nie oficjalne.
- **Dane na GitHubie są przetworzone, nazw ani kodów nie zmieniamy.**
- **Brak przycisku „sprawdź” w aplikacji.** Aplikacja nie wysyła zbędnych zapytań, sprawdza raz dziennie automat.
- **Brak zewnętrznych serwerów** (czcionki systemowe, polityka CSP `default-src 'self'`).
- **Tabela resortowa jest aktualizowana ręcznie.** Automat tylko alarmuje, bo zmianę prawa trzeba wprowadzić świadomie.
- **Kody resortowe są pokazywane nad kodami ICD-9** (jest ich mniej, a lekarz często szuka właśnie poradni lub oddziału). Wyszukiwanie resortowe: po 4 cyfrach, po 2–3 pierwszych cyfrach i po nazwie; „fizjoterapia” = „rehabilitacja”.
- **Kopiować można tylko kody końcowe** (kody resortowe i kody ICD-9 bez kodów szczegółowych). Kategorie ogólne, np. 89.00 albo 93.11, mają kropkowaną ramkę i nie kopiują się; z nich przechodzi się do „Kody szczegółowe”. W słowniku NFZ nie ma oznaczenia, że kategoria ogólna bywa też kodem końcowym, więc żadna taka nie jest kopiowalna.
- **Przy kodzie, który można skopiować, jest ikona kopiowania (dwie karteczki)**; po dotknięciu zmienia się na ptaszek.
- **Ekran startowy:** najpierw „Kody resortowe”, potem „Przeglądaj wszystkie kategorie”. Wersja słownika i liczba kodów są tylko w stopce (nie w nagłówku).
- **Motyw:** przycisk w prawym górnym rogu przełącza automatyczny → jasny → ciemny.
- **Wyszukiwanie od 2 znaków**, jedna litera daje komunikat. Obsługuje skróty (usg, rtg, tk, mr, ekg…), końcówki fleksyjne, grupy wyników, gdy żaden kod nie zawiera wszystkich słów.

## 8. Czego nie wiemy / nie sprawdzono
- Czy kod ICD-9 jest wymagany na każdym skierowaniu. To zależy od rodzaju skierowania i placówki.
- Własnych kodów NFZ z komunikatów (np. AP-KOLCE) poza tymi, które wynikają z rozporządzenia.
- Czy NFZ zmieni układ strony ze słownikiem. Wtedy `update.py` zgłosi błąd i trzeba wgrać plik ręcznie.

## 9. Bezpieczeństwo (zrobione i do zrobienia)
- Zrobione: 2FA na koncie GitHub, czcionki lokalne, CSP, brak zewnętrznych hostów.
- Do włączenia w Settings → Code security: Dependabot alerts, Secret scanning, CodeQL.
- Dobra praktyka: kody odzyskiwania 2FA trzymaj poza komputerem, na którym pracujesz.

## 10. Kopie zapasowe
- Repozytorium na GitHubie zawiera pełny projekt. Zalecana kopia: raz na jakiś czas **Code → Download ZIP** i zapisanie na dysku.
- Ten plik (`PROJEKT.md`) wgrany do repozytorium przetrwa także zmianę rozmowy z Claude.
