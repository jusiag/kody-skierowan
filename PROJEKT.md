# PROJEKT: Kody do skierowań (notatka dla opiekuna i dla nowej rozmowy z Claude)

Ten plik opisuje, co to jest, dlaczego jest zrobione tak, jak jest, jak to aktualizować i czego nie robić.
Jeśli zaczynasz nową rozmowę z Claude, wgraj ten plik i napisz, co chcesz zmienić.
Stan na: 12.11.2026 (po dodaniu rozpoznań ICD-10).

## 1. Cel
Prosta, nieoficjalna aplikacja dla lekarzy: wyszukiwarka kodów do skierowań.
- Kody rozpoznań **ICD-10** (polska wersja klasyfikacji WHO, wydawca Centrum e-Zdrowia, aktualizacja z 31.03.2021, 12 010 kodów).
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
- Słownik ICD-10: https://dane.gov.pl/pl/dataset/27 (Centrum e-Zdrowia, plik XML ok. 12 MB, np. ICD10_PL_en_covid_2021_03_31_2.xml). NFZ nie publikuje własnego słownika ICD-10. Ostatnia aktualizacja klasyfikacji: 31.03.2021 (kody U07–U12 związane z COVID-19). Prawa: © WHO; polska wersja: Centrum e-Zdrowia (dawniej CSIOZ).
- API dane.gov.pl (sprawdzanie nowej wersji ICD-10): https://api.dane.gov.pl/1.4/datasets/27/resources
- API Sejmu (sprawdzanie zmian przepisów): https://api.sejm.gov.pl/eli/acts/DU/2012/594

## 4. Jak to działa
Strona statyczna na GitHub Pages, bez serwera i bez zbierania danych. Raz dziennie (ok. 7:30) automat GitHub Actions (`.github/workflows/update.yml`):
1. `scripts/update.py`: sprawdza stronę NFZ. Gdy jest nowsza wersja słownika, pobiera, konwertuje i podmienia `data/icd9.json`. Odmawia podmiany, gdy liczba kodów spada o ponad 10%.
2. `scripts/check_resort.py`: pyta API Sejmu o akty zmieniające rozporządzenie. Jeśli lista różni się od znanej (`KNOWN_AMENDMENTS`, `KNOWN_CONSOLIDATED`), kończy się błędem i GitHub wysyła e-mail.
3. `scripts/update_icd10.py`: wczytuje plik ICD-10 wgrany do `incoming/` (.xml) i sprawdza na dane.gov.pl, czy jest nowszy plik niż w aplikacji (porównuje „datę danych”). Nowszego pliku nie pobiera sam, tylko wysyła e-mail.
4. Publikuje stronę, wpisując w nią datę sprawdzeń. Aplikacja pokazuje te daty i ostrzega, gdy są starsze niż 3 dni.
5. Jeśli któryś krok się nie powiedzie, strona nadal działa na starych danych, a GitHub wysyła e-mail.

## 5. Pliki
- `index.html`: strona, style, polityka bezpieczeństwa (CSP).
- `app.js`: widoki, kody resortowe, aktualność danych.
- `search.js`: wyszukiwanie kodów ICD-9 i ICD-10 (opis w punktach 7a i 7b).
- `tests/`: testy wyszukiwania (`search.test.js`) i zapisana kolejność wyników (`wzorce.json`).
- `resort.js`: tabela kodów resortowych (359 pozycji, 10 działów).
- `theme.js`: przełącznik motywu (automatyczny / jasny / ciemny), wybór zapamiętany na urządzeniu.
- `sw.js`: działanie bez internetu.
- `data/icd9.json`: słownik ICD-9. `data/icd10.json`: słownik ICD-10. `data/meta.json`: wersje i daty sprawdzeń (ICD-10 w kluczu `icd10`).
- `scripts/`: `update.py`, `convert.py` (ICD-9), `convert_icd10.py`, `update_icd10.py` (ICD-10), `check_resort.py`.
- `incoming/`: miejsce na ręcznie pobrany .xlsx, gdy NFZ blokuje automat.
- `.github/workflows/update.yml`, `.github/dependabot.yml`: automat i aktualizacje narzędzi.

## 6. Co robić, gdy przyjdzie e-mail z GitHuba
- **Problem z NFZ:** pobierz plik ze strony NFZ i wgraj go (bez zmiany nazwy) do folderu `incoming`.
- **ICD-10 (nowsza wersja na dane.gov.pl albo błąd portalu):** pobierz najnowszy plik XML z https://dane.gov.pl/pl/dataset/27 i wgraj go (bez zmiany nazwy) do `incoming`. Jeśli e-mail mówi, że portal „zmienił budowę”, automat nie umie odczytać odpowiedzi API: sprawdź ręcznie, czy jest nowy plik, i zgłoś to do poprawy skryptu.
- **Zmiana przepisów (kody resortowe):** w ISAP (Dz. U. 2012 poz. 594, zakładka „Akty zmieniające”) sprawdź nowy akt. Wprowadź zmiany w `resort.js` i dopisz akt do `KNOWN_AMENDMENTS` w `scripts/check_resort.py`. Daj też nową datę w opisie aplikacji.
- **Brak e-maili, ale aplikacja ostrzega o starym sprawdzeniu:** w Actions uruchom ręcznie „Run workflow”.

## 7. Ważne decyzje i dlaczego
- **Nazwa „Kody do skierowań”**, bo aplikacja zawiera nie tylko ICD-9.
- **Źródła bez ramek** (od 12.11.2026): każda sekcja wyników (ICD-10, Kody resortowe, Procedury ICD-9) ma pod wynikami krótką notkę „Źródło.” drobnym, szarym tekstem; kody resortowe mają w niej też „Aktualność” i linki do ISAP. Pełne źródła i zastrzeżenie są na dole strony, również bez ramki, żeby nie wyglądały jak wynik. Wynika z tego, że to narzędzie pomocnicze, nie oficjalne.
- **Dane na GitHubie są przetworzone, nazw ani kodów nie zmieniamy.**
- **Brak przycisku „sprawdź” w aplikacji.** Aplikacja nie wysyła zbędnych zapytań, sprawdza raz dziennie automat.
- **Brak zewnętrznych serwerów** (czcionki systemowe, polityka CSP `default-src 'self'`).
- **Tabela resortowa jest aktualizowana ręcznie.** Automat tylko alarmuje, bo zmianę prawa trzeba wprowadzić świadomie.
- **Kody resortowe są pokazywane nad kodami ICD-9** (jest ich mniej, a lekarz często szuka właśnie poradni lub oddziału). Wyszukiwanie resortowe: po 4 cyfrach, po 2–3 pierwszych cyfrach i po nazwie; „fizjoterapia” = „rehabilitacja”.
- **Kopiować można tylko kody końcowe** (kody resortowe i kody ICD-9 bez kodów szczegółowych). Kategorie ogólne, np. 89.00 albo 93.11, mają kropkowaną ramkę i nie kopiują się; z nich przechodzi się do „Kody szczegółowe”. W słowniku NFZ nie ma oznaczenia, że kategoria ogólna bywa też kodem końcowym, więc żadna taka nie jest kopiowalna.
- **Bez ulubionych (gwiazdek)** (od 29.10.2026). Lista ulubionych wymagała zapisu w pamięci przeglądarki, a ta nie zawsze działa (tryb prywatny, wersja testowa w Claude, inne urządzenie) i lista znikała. Aplikacja nie zapisuje kodów wybranych przez lekarza. W pamięci urządzenia zostaje tylko wybór motywu (jasny/ciemny) i kopia słownika do pracy bez internetu.
- **Przy kodzie, który można skopiować, jest ikona kopiowania (dwie karteczki)**; po dotknięciu zmienia się na ptaszek.
- **Ekran startowy:** najpierw „Rozpoznania ICD-10 (wszystkie rozdziały)”, potem „Kody resortowe”, potem „Kody procedur ICD-9 (wszystkie kategorie)”.
- **Jedno pole wyszukiwania, trzy sekcje** (od 12.11.2026): Rozpoznania ICD-10 → Kody resortowe → Procedury ICD-9. Sekcja ICD-10 pokazuje się tylko, gdy rozpoznanie pasuje do wszystkich wpisanych słów (inaczej przy „usg tarczycy” nad procedurą 88.713 stałyby przypadkowe rozpoznania). Widać 5 rozpoznań, resztę po „Pokaż więcej”.
- **Zwijanie sekcji wyników** (od 12.11.2026): nagłówek każdej sekcji (ICD-10, Kody resortowe, Procedury ICD-9) jest przyciskem z napisem „Zwiń” / „Rozwiń” i liczbą wyników (bez strzałki: napis i wygląd przycisku wystarczą). Domyślnie wszystko rozwinięte. Zwinięta sekcja zostaje zwinięta przy kolejnych hasłach do zamknięcia strony; nic nie jest zapisywane w telefonie. Gdy wyniki są tylko w ICD-9, jej nagłówek jest zwykłym napisem (nie da się zwinąć jedynej sekcji). W przeglądaniu kategorii „Wróć do listy kategorii” jest pod nagłówkiem. Wersja słownika i liczba kodów są tylko w stopce (nie w nagłówku).
- **Motyw:** przycisk w prawym górnym rogu przełącza automatyczny → jasny → ciemny.
- **Wyszukiwanie od 2 znaków**, jedna litera daje komunikat. Obsługuje skróty (usg, rtg, tk, mr, ekg…), końcówki fleksyjne, grupy wyników, gdy żaden kod nie zawiera wszystkich słów.

## 7a. Wyszukiwanie (plik `search.js`, od 29.10.2026)
Cała logika szukania kodów ICD-9 jest w `search.js`. Plik nie dotyka strony, więc da się go sprawdzić testami bez przeglądarki. `app.js` tylko wyświetla wyniki. Kody resortowe (`resSearch` w `app.js`, `resort.js`) są osobno i tego nie dotyczy.

**Jak to działa, krok po kroku:**
1. **Normalizacja:** małe litery, „ł” → „l”, bez ogonków, tylko litery, cyfry i kropka.
2. **Słowa:** zapytanie dzielone na słowa (najwyżej 12). Zapytanie zaczynające się od cyfry zachowuje kropki (to numer kodu).
3. **Warianty słowa:**
   - słowo ze słownika skrótów `SYN` (usg, rtg, tk, mr, ekg, zdjecie, konsultacja…) → jego warianty;
   - **niedokończone słowo** (min. 3 litery), które jest początkiem klucza `SYN`, działa jak ten klucz („zdje”, „zdjec”, „zdjeci” = „zdjecie”), więc wyniki nie skaczą przy pisaniu;
   - staw (kolano, biodro, kostka, staw skokowy, bark, łokieć, nadgarstek, dłoń) → wariant **konkretny** (np. „kolan”) i warianty **ogólne** („staw”, „kończyna dolna/górna” jako para słów, „mięśniowo”);
   - pozostałe słowa: skrócona końcówka (≥ 8 liter: bez 3 ostatnich, ≥ 5: bez 2, min. 4 litery).
4. **Trafienie:** któreś słowo nazwy zaczyna się od wariantu. Liczy się nazwa kodu albo nazwy kategorii nadrzędnych.
5. **Ocena:** punkty jak dotąd (stałe z opisem są na górze `search.js`). Kod z oceną ≤ 0 nie jest pokazywany (tak było i wcześniej).
6. **Kolejność:**
   1) najpierw kody trafione **konkretnie**, dopiero pod nimi kody trafione tylko wariantem ogólnym (np. „staw”);
   2) potem więcej punktów;
   3) przy remisie: trafione słowo wcześniej w nazwie, potem krótsza nazwa, potem numer kodu. Przy szukaniu po numerze kodu remis rozstrzyga od razu numer.
- **Wariant ogólny nigdy nie łapie** kodu, który nazywa inny staw (np. bark dla „kolano”), rękę/stopę po drugiej stronie albo drugą kończynę (np. „kończyny górnej” dla „kolano”). Wyjątek: kod wymienia obie kończyny, np. 88.793 „USG kończyn górnych lub dolnych”.
- Bez zmian: minimum 2 znaki (1 znak = komunikat), szukanie po początku numeru kodu („88”, „93.11”, „g50”), grupy wyników dla każdego słowa (gdy żaden kod nie ma wszystkich słów), wyniki częściowe, podświetlanie.
- Przełącznik `LEAF_FIRST` (domyślnie wyłączony): po włączeniu kody końcowe zawsze stoją przed kategoriami ogólnymi. Zmienia top 10 w ok. 27% zapytań, więc wymaga świadomej decyzji.

**Jak dodać nowy skrót:** w `search.js` w `SYN` dopisz np. `dexa: ["densytometr"],` (klucz i warianty małymi literami, bez polskich znaków; pierwszy wariant to termin główny). Potem uruchom testy.

**Testy** (na komputerze z Node.js, w głównym folderze projektu): `node tests/search.test.js`. Sprawdzają przykłady z błędów (kolano, bark, łokieć, zdjęcie…), regułę „inny staw / druga kończyna” dla wszystkich stawów, odporność na dziwne zapytania i szybkość. Plik `tests/wzorce.json` zapamiętuje kolejność top 10 dla ok. 40 typowych zapytań. Jeśli zmiana kodu przestawi wyniki, test pokaże „było / jest”. Gdy zmiana jest zamierzona, zapisz nową kolejność: `node tests/search.test.js --zapisz-wzorce`.

## 7b. Rozpoznania ICD-10 (od 12.11.2026)
**Dane** (`scripts/convert_icd10.py`, kodów i nazw nie zmieniamy):
- rozdziały (np. J00–J99) i bloki (J40–J47) to kategorie ogólne; kategoria (J45) i podkategoria (J45.0) to kody;
- 117 kategorii (np. E10–E14 cukrzyca, F10–F19, K25–K28, N00–N07, O03–O06, V01–V89) ma w pliku podkategorie zapisane tylko schematem („.0 Ze śpiączką … .9 Bez powikłań”). Pełne kody składamy jak w Tomie I: E11 + .9 = **E11.9**, nazwa „Cukrzyca insulinoniezależna – Bez powikłań” (989 takich kodów);
- znaki † (przyczyna) i * (objaw) są pokazywane przy kodzie, ale **nie są kopiowane** (nie należą do kodu);
- określenia włączone („Obejmuje”, np. pod E06.3 „Zapalenie tarczycy Hashimoto”) są przeszukiwane i pokazywane pod nazwą, gdy to one pasują;
- nieobowiązkowy 5. znak (umiejscowienie w rozdziale M, złamanie zamknięte/otwarte w S/T) jest uwagą przy kategorii, nie osobnym kodem;
- bloki jednokodowe (B99, F99, C50, C97) występują raz, jako kategoria.
**Wyszukiwanie** (ten sam silnik co ICD-9, `search.js`, punkt 10; indeks ICD-9 budowany jest bez zmian, co pilnują testy):
- kod: „J45”, „j45.0”, „J450”, „e119” (bez kropki też działa);
- trafienie w określeniu włączonym liczy się prawie jak w nazwie (8 pkt zamiast 10);
- `PHRASES10`: „cukrzyca typu 2 / t2 / DM2” → insulinoniezależna (E11), „typu 1” → insulinozależna (E10);
- `SYN10`: skróty z gabinetu (POChP, AZS, RZS, ZUM, IBS, GERD, ChNS, NT, AF, SM, ADHD, angina, dyskopatia, infekcja, alergia, nerwica…);
- `COMMON10`: lista ok. 70 częstych rozpoznań POZ/AOS (np. I10, E11, J06, J45, M54, N39, R10, Z00). Gdy pasują do wpisanych słów **w samej nazwie kodu**, stoją na górze. To ułatwienie, nie zalecenie; listę można zmienić albo opróżnić (wtedy kolejność wynika tylko z punktów). Lista ułożona przez Claude: **warto, żeby przejrzał ją lekarz**.
**Jak dodać skrót ICD-10:** w `search.js` w `SYN10` dopisz np. `pzp: ["przewlekl"]`; frazę wielowyrazową dopisz do `PHRASES10`. Potem `node tests/search.test.js`.

## 8. Czego nie wiemy / nie sprawdzono
- Czy kod ICD-9 jest wymagany na każdym skierowaniu. To zależy od rodzaju skierowania i placówki.
- Własnych kodów NFZ z komunikatów (np. AP-KOLCE) poza tymi, które wynikają z rozporządzenia.
- Czy NFZ zmieni układ strony ze słownikiem. Wtedy `update.py` zgłosi błąd i trzeba wgrać plik ręcznie.
- Dokładna budowa odpowiedzi API dane.gov.pl nie była sprawdzona na żywo (z miejsca, gdzie powstawał skrypt, portal był niedostępny). Skrypt szuka zasobu XML z „ICD-10” w tytule i jego „daty danych”. Jeśli pierwsze uruchomienie automatu zgłosi, że „portal zmienił budowę”, trzeba poprawić `walk_resources`/`resource_date` w `scripts/update_icd10.py`.
- Czy NFZ/P1 przyjmuje kody ICD-10 3-znakowe, gdy kategoria ma podkategorie. Aplikacja pozwala kopiować tylko kody końcowe (jak w ICD-9), więc np. J45 trzeba rozwinąć do J45.0–J45.9.
- Lista częstych rozpoznań (`COMMON10`) nie pochodzi z danych NFZ o częstości, tylko z wiedzy ogólnej. Warto ją skonsultować z lekarzami.

## 9. Bezpieczeństwo (zrobione i do zrobienia)
- Zrobione: 2FA na koncie GitHub, czcionki lokalne, CSP, brak zewnętrznych hostów.
- Do włączenia w Settings → Code security: Dependabot alerts, Secret scanning, CodeQL.
- Dobra praktyka: kody odzyskiwania 2FA trzymaj poza komputerem, na którym pracujesz.

## 10. Kopie zapasowe
- Repozytorium na GitHubie zawiera pełny projekt. Zalecana kopia: raz na jakiś czas **Code → Download ZIP** i zapisanie na dysku.
- Ten plik (`PROJEKT.md`) wgrany do repozytorium przetrwa także zmianę rozmowy z Claude.
