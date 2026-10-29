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
- **Ekran startowy:** najpierw „Kody resortowe”, potem „Kody procedur ICD-9 (wszystkie kategorie)”. Wersja słownika i liczba kodów są tylko w stopce (nie w nagłówku).
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

## 11. Wyszukiwanie
Cała logika wyszukiwania kodów ICD-9 jest w pliku **`search.js`** (czysty JavaScript, bez dostępu do strony, ładowany w `index.html` przed `app.js`). `app.js` tylko woła `KodySearch.search(...)` i pokazuje wynik. Kody resortowe (4 cyfry, `resSearch` w `app.js`, dane w `resort.js`) mają osobne wyszukiwanie i nie są tu opisane. Testy: `tests/search.test.js` (uruchomienie: `node tests/search.test.js`, bez żadnych bibliotek).

### Jak to działa (po kolei)
1. **Normalizacja** (`norm`): małe litery, „ł”→„l”, bez ogonków, tylko litery a–z, cyfry i kropka.
2. **Słowa** (`tokenize`): zapytanie dzieli się na słowa (najwyżej 8 słów i 120 znaków; resztę pomijamy). Zapytanie wyglądające jak kod („88”, „93.11”, „g50”) jest dodatkowo dopasowywane po początku kodu.
3. **Rozwinięcie słowa** (`expand`): każde słowo zamienia się na listę „początków słów”, które mają pasować:
   - **konkretne**: skrót ze słownika `SYN` (np. „usg” → usg, ultrasonogra…), nazwa stawu („kolano” → „kolan”) albo zwykłe słowo z obciętą końcówką (≥8 liter: bez 3 ostatnich, ≥5: bez 2, min. 4 litery);
   - **ogólne** (tylko dla stawów): „staw” oraz strona kończyny („kończyny dolnej/dolnych” dla kolana, biodra i kostki, „górnej/górnych” dla barku, łokcia, nadgarstka i dłoni).
4. **Dopasowanie** (`matchToken`): kod pasuje, gdy któreś słowo jego nazwy ZACZYNA SIĘ od wariantu. Sprawdzamy w kolejności: konkretny w nazwie kodu, konkretny w nazwach nadrzędnych kategorii, dopiero potem ogólny. Kod musi pasować do wszystkich słów.
5. **Ocena** (`scoreFull`, stałe w obiekcie `SCORE`, każda z opisem w pliku): +10 za słowo we własnej nazwie (+3 gdy tylko w nadrzędnych), +4 za samo wpisane słowo (nie tylko synonim), +25 gdy wszystkie słowa są we własnej nazwie, +6 kody diagnostyczne (rozdziały 87–92, 93, 95 i literowe), +2 kod końcowy, +4 gdy nazwa zaczyna się od pierwszego słowa, minus długość nazwy/18 (najwyżej 8). Te liczby są takie same jak w poprzedniej wersji.
6. **Kolejność** (`compare`): (1) wyniki trafione konkretnie, potem wspomagane wariantem ogólnym; (2) kody z wszystkimi słowami we własnej nazwie przed kodami z trafieniem tylko w nazwach nadrzędnych; (3) punkty; (4) remis punktowy: więcej słów trafionych jako cały wyraz, potem wcześniejsze trafienie w nazwie; (5) dopiero na końcu numer kodu.
7. Gdy żaden kod nie pasuje do wszystkich słów: **grupy** (osobna lista dla każdego słowa, po 10 kodów, najpierw konkretne), a w ostateczności wyniki **„częściowe”** (pasuje pierwsze słowo).

### Zasada specyficzności (dlaczego „kolano” nie pokazuje kończyny górnej)
Wariant ogólny może tylko UZUPEŁNIAĆ wyniki, nigdy ich wypierać. Konkretnie: (a) kod trafiony wyłącznie wariantem ogólnym jest zawsze za wszystkimi kodami trafionymi konkretnie; (b) wariant ogólny nie obejmuje kodów z przeciwną stroną ciała (np. „kończyny górnej” przy kolanie; kod z obiema stronami, np. „USG kończyn górnych lub dolnych”, jest dopuszczony); (c) nie obejmuje kodów o innym stawie lub innej części ciała (np. „USG stawów barkowych”, „Uwolnienie stawu - kręgosłup”, staw skroniowo-żuchwowy); (d) słowa „dolnej/górnej” liczą się tylko razem ze słowem „kończyn…” (inaczej łapałyby „powieki dolnej” czy „żyłę główną dolną”). Listy stawów i części ciała są na górze `search.js` (tablice `JOINTS` i `OTHER_PARTS`).

### Nieregularne odmiany i słowa-wypełniacze
- W `SYN` są wiersze łączące odmiany, których samo skracanie końcówek nie łączy: „udo/uda”, „brzuch/brzucha/brzusznej…”, „ręka/ręki” (ręka łączy się też z dłonią, bo w słowniku jest „RTG nadgarstka/dłoni”).
- Lista `FILLER_WORDS` („jamy”, „okolicy”, „narządów”…): jeśli zapytanie NIC nie znalazło, wyszukiwanie jest powtarzane bez tych słów („usg jamy brzusznej” → „usg brzusznej”). Zapytania, które coś znajdują, nie są zmieniane.

### Niedokończone słowa
Słowo, które ma co najmniej 3 litery i jest początkiem klucza z `SYN` (np. „zdj”, „zdjeci”), działa jak ten klucz („zdjecie”) i dodatkowo jak wpisane dosłownie (żeby „kon” nadal znajdowało też „kończyna”). Dzięki temu wyniki nie „skaczą” podczas pisania: „zdj”, „zdje”, „zdjec”, „zdjeci” i „zdjecie” dają dokładnie ten sam wynik.

### Jak dodać nowy skrót do SYN
1. Otwórz `search.js`, znajdź obiekt `SYN` na górze pliku.
2. Dopisz wiersz: `klucz: ["pierwszy", "drugi"],`. Klucz to słowo, które wpisuje użytkownik (małymi literami, bez ogonków). Wartości to POCZĄTKI słów z nazw kodów (też bez ogonków). **Pierwsza wartość to samo słowo** (dostaje premię +4), reszta to synonimy. Przykład: `ekg: ["ekg", "elektrokardiogra"]`.
3. Początki dobieraj tak, żeby nie łapały obcych słów (np. „kola” łapało „kolagen”; zamiast tego „kolan”). Przed dodaniem sprawdź w `data/icd9.json`, jakie słowa zaczynają się tak samo.
4. Dodaj w `tests/search.test.js` test na nowy skrót (np. `assert.ok(codes("mojklucz").includes("88.713"))`) i uruchom `node tests/search.test.js`. Test sam sprawdza też, że każdy klucz `SYN` daje wyniki i że jego początki (≥3 litery) nie dają węższego zbioru.
5. Nowy staw: dopisz wiersz do `JOINTS` (początki słów, strona `dolna`/`gorna`, `family`).
6. Po zmianie wgraj `search.js` (i `tests/search.test.js`) na GitHub; plik jest już na liście `sw.js` i w kroku `cp` w `update.yml`, więc nic więcej nie trzeba.

### Prywatność
Aplikacja nie używa ciasteczek i nie ma ulubionych (gwiazdek). Nie zapisuje na urządzeniu zapytań ani kodów. Jedyny zapis na urządzeniu to wybór motywu jasny/ciemny (`theme.js`, pamięć przeglądarki `localStorage`, nie ciasteczko) oraz kopia strony i słownika do pracy bez internetu (`sw.js`). Test w `tests/search.test.js` pilnuje, żeby `app.js` i `search.js` nie zaczęły zapisywać danych.

### Pobieranie danych z serwisów rządowych (bezpieczeństwo)
- Skrypty `scripts/update.py` (NFZ) i `scripts/check_resort.py` (API Sejmu) przedstawiają się uczciwie: nagłówek User-Agent z nazwą `kody-skierowan-updater` i adresem repozytorium (bez udawania przeglądarki).
- Przed pobraniem strony i pliku `update.py` czyta `robots.txt` serwera NFZ. Jeśli zabrania automatom, nie pobiera i zgłasza błąd; wtedy pobierz plik sam w przeglądarce i wgraj do `incoming` (instrukcja w `incoming/CZYTAJ.txt`).
- Pobieranie tylko z domeny `nfz.gov.pl` przez `https` (także po przekierowaniach i dla linku odczytanego ze strony). Limity: strona 5 MB, plik .xlsx 25 MB, odpowiedź API Sejmu 2 MB.
- Automat nie publikuje słownika, w którym zmieniło się więcej niż 20% nazw kodów (zmiana wymaga przeglądu): przejrzyj plik i wgraj go ręcznie do `incoming`. Plik wgrany ręcznie przez Ciebie nie podlega temu progowi. Pozostałe sprawdzenia bez zmian (min. 5000 kodów, wymagane kody, spadek liczby kodów o ponad 10% blokuje).
- Workflow ma osobne uprawnienia dla każdego zadania (zapis do repozytorium tylko w zadaniu aktualizującym dane; publikacja Pages tylko w zadaniu publikującym) oraz przypięte wersje `openpyxl` i `defusedxml`.
- Testy skryptów: `python3 -m unittest discover -s tests -p "test_*.py" -v` (bez internetu).
- **Warunki ponownego wykorzystywania słownika NFZ nie zostały sprawdzone** (sekcja 8). Zalecane: zapytać NFZ o zgodę na ponowne publikowanie w nieoficjalnej aplikacji.

### Świadomie NIE zmienione (wymaga decyzji właścicielki)
- Premia +6 dla kodów diagnostycznych sprawia, że przy „terapia” kody 93.xx stoją przed „94.42 Terapia rodzin”. To zachowanie pierwotne, test pilnuje, że kolejność top 20 jest taka jak wcześniej.
- „Badanie krwi”: kody z trafieniem tylko w nadrzędnych (np. 92.058) są dopiero za kodami z trafieniem we własnej nazwie. Kod 00.9603 ma „krwi” we własnej nazwie („elementów morfotycznych krwi”), więc jego pozycja jest zgodna z zasadami.

### Znane ograniczenia i pomysły (nie wdrożone; testy wypisują je jako „info”)
- „ekg”: 89.52 „Elektrokardiogram” jest 7., bo nazwy zawierające dosłownie „ekg” (np. „Fonokardiogram z ekg”) dostają premię +4.
- Odmiany spoza listy w `SYN` (np. „noga”) nadal nie łączą się z „kończyną dolną”. Rozwiązanie: wiersz w `SYN`.
- Skracanie końcówek jest agresywne dla krótkich słów: „stopy” łapie „stopnia”, „krwi” łapie „krwiotwórczego”.
- Kody końcowe nie są ściśle przed wszystkimi kategoriami ogólnymi (np. przy „fizjoterapia” kategoria 93.39 stoi przed kodem 93.88).
