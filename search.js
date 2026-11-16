/* search.js: wyszukiwanie kodów procedur ICD-9 (słownik NFZ).
 *
 * Czysty moduł: nie dotyka strony (DOM), nie łączy się z internetem.
 * W przeglądarce udostępnia obiekt window.KodySearch (ładowany w index.html przed app.js).
 * W Node (testy) działa przez require("./search.js").
 *
 * Kolejność pracy (każdy krok to osobna, krótka funkcja):
 *   1. norm()        normalizacja tekstu (małe litery, bez ogonków)
 *   2. tokens()      podział zapytania na słowa
 *   3. expand()      rozwinięcie słowa na warianty: KONKRETNE i OGÓLNE
 *   4. matchToken()  test trafienia jednego słowa w jednym kodzie
 *   5. scoreEntry()  ocena kodu (punkty) i poziom ogólności
 *   6. compare()     sortowanie wyników
 *
 * Kod kodów resortowych (resSearch, resort.js) jest w app.js i ten plik go nie dotyczy.
 */
(function (root) {
  "use strict";

  /* ---------- 1. Słowniki pomocnicze ---------- */

  /* Skróty i synonimy: wpisane słowo → początki słów, które mają pasować.
   * Jak dodać nowy skrót: dopisz parę  klucz: ["początek1", "początek2"]
   * (klucz i warianty bez polskich znaków, małymi literami). Pierwszy wariant
   * to termin główny: kod, który go zawiera, dostaje małą premię (PTS_MAIN_VARIANT).
   * Niedokończone słowo (min. 3 litery), które jest początkiem klucza, działa jak ten klucz
   * (np. „zdje” → „zdjecie”, „rezo” → „rezonans”). */
  const SYN = {
    usg: ["usg", "ultrasonogra", "ultradzwiek", "echokardiogra"], ultrasonografia: ["usg", "ultrasonogra"],
    rtg: ["rtg", "rentgen", "radiogra"], rentgen: ["rtg", "rentgen", "radiogra"],
    /* „zdjec” (a nie „zdjeci”), żeby łapać też „zdjęć” (np. 23.0301 „Rentgenodiagnostyka do 2 zdjęć…”) */
    zdjecie: ["rtg", "zdjec", "radiogra"],
    tk: ["tk", "tomogra"], ct: ["tk", "tomogra"], tomografia: ["tk", "tomogra"],
    mr: ["rezonans", "rm"], mri: ["rezonans", "rm"], rm: ["rezonans", "rm"], nmr: ["rezonans", "rm"], rezonans: ["rezonans", "rm"],
    ekg: ["ekg", "elektrokardiogra"], echo: ["echokardiogra", "echo"], eeg: ["eeg", "elektroencefalogra"], emg: ["emg", "elektromiogra"],
    ktg: ["ktg", "kardiotokogra"], pet: ["pet", "pozytonow"], gastroskopia: ["gastroskop", "ezofagogastroduodenoskop"],
    morfologia: ["morfologi"], konsultacja: ["konsultac", "porada"], porada: ["porada", "konsultac"],
    fizjoterapia: ["fizjoterap"], rehabilitacja: ["rehabilit", "fizjoterap"]
  };
  const SYN_KEYS = Object.keys(SYN);
  const SYN_PREFIX_MIN = 3; /* od ilu liter niedokończone słowo traktujemy jak klucz SYN */

  /* Stawy. „starts” = początki wpisanego słowa, które rozpoznają staw; „roots” = warianty KONKRETNE.
   * „lower” mówi, czy to kończyna dolna (true) czy górna (false). */
  const JOINTS = [
    { starts: ["kolan"], roots: ["kolan"], lower: true },
    { starts: ["biodr"], roots: ["biodr"], lower: true },
    { starts: ["skokow"], roots: ["skokow"], lower: true },
    { starts: ["kostk"], roots: ["kostk"], lower: true },
    { starts: ["bark"], roots: ["bark"], lower: false },
    { starts: ["lokc", "lokie"], roots: ["lokc", "lokie"], lower: false }, /* łokcia / łokieć */
    { starts: ["nadgar"], roots: ["nadgar"], lower: false },
    { starts: ["dlon"], roots: ["dlon"], lower: false }
  ];
  const JOINT_MIN = 4; /* od ilu liter rozpoznajemy staw (jak dotąd) */
  /* Słowa oznaczające drugą kończynę. Jeśli kod je zawiera, wariant ogólny (np. „staw”) go NIE łapie.
   * Sprawdzane jako całe słowa, bo krótkie początki („rek”) łapałyby np. „rekonstrukcję”. */
  const UPPER_WORDS = ["reka", "reki", "rak", "reke", "ramie", "ramienia", "przedramie", "przedramienia"];
  const LOWER_WORDS = ["stopa", "stopy", "stop", "stope", "udo", "uda", "podudzie", "podudzia"];
  /* Inne stawy i okolice spoza listy JOINTS (początki słów). Wariant ogólny „staw” ich nie łapie,
   * np. „kolano” nie pokaże „Kontrastowy artrogram stawu skroniowo-żuchwowego” (87.13). */
  const OTHER_JOINT_ROOTS = ["skroni", "zuchw", "kregos", "obojcz", "mostk", "krzyzow", "palc", "paluch", "kciuk"];

  /* ---------- 2. Stałe punktowe (wartości jak w poprzedniej wersji) ---------- */
  const PTS_OWN = 10;          /* słowo jest we własnej nazwie kodu */
  const PTS_CTX = 3;           /* słowo jest tylko w nazwach kategorii nadrzędnych */
  const PTS_INC = 8;           /* ICD-10: słowo jest w określeniu włączonym („Obejmuje”, np. „Astma atopowa” pod J45.0),
                                  czyli prawie jak w nazwie, ale nazwa wygrywa (10) */
  const PTS_MAIN_VARIANT = 4;  /* słowo ma kilka wariantów, a kod zawiera pierwszy (główny) */
  const PTS_ALL_OWN = 25;      /* wszystkie słowa we własnej nazwie; jest większa niż suma pozostałych premii (24),
                                  więc taki kod zawsze wyprzedza kod trafiony częściowo w kategoriach nadrzędnych */
  const PTS_DIAG = 6;          /* kod diagnostyczny / terapeutyczny (rozdziały 87–93, 95, kody literowe): tego zwykle szuka lekarz kierujący */
  const PTS_LEAF = 2;          /* kod końcowy (można go skopiować) przed kategorią ogólną */
  const LEN_DIVISOR = 18;      /* kara za długą nazwę: długość / 18 ... */
  const LEN_MAX_PENALTY = 8;   /* ... ale najwyżej 8 punktów */
  const PTS_FIRST_WORD = 4;    /* nazwa ZACZYNA SIĘ od pierwszego wpisanego słowa */
  const PTS_PARTIAL_WORD = 10; /* wyniki częściowe: za każde trafione słowo */
  const PTS_PARTIAL_CAT = 4;   /* wyniki częściowe: kategoria ogólna wyżej (lekarz rozwinie ją do kodów szczegółowych) */
  const MIN_SCORE = 0;         /* kod z oceną <= 0 nie trafia do wyników (tak było dotąd: odpadają np. długie nazwy
                                  trafione tylko w kategorii nadrzędnej, zob. 63.961 dla „fertilization”) */   /* wyniki częściowe: kategoria ogólna wyżej (lekarz rozwinie ją do kodów szczegółowych) */

  /* Wyszukiwanie po numerze kodu */
  const PTS_CODE_EXACT = 1000, PTS_CODE_PREFIX = 500, PTS_CODE_PER_CHAR = 10;

  /* Czy kody końcowe (do skopiowania) mają ZAWSZE stać przed kategoriami ogólnymi?
   * false = jak dotąd (kategoria może być wyżej, jeśli ma więcej punktów). Ustawienie true zmienia
   * top 10 w ok. 27% zapytań (pomiar na 724 słowach ze słownika), więc wymaga decyzji autorki. */
  const LEAF_FIRST = false;

  const MIN_CHARS = 2;     /* krótsze zapytanie = komunikat „wpisz co najmniej 2 znaki” */
  const MAX_TOKENS = 12;   /* dłuższe zapytania przycinamy (ochrona przed zawieszeniem przy wklejeniu tekstu) */
  const GROUP_LIMIT = 10;  /* ile kodów pokazujemy na jedno słowo, gdy żaden kod nie ma wszystkich słów */
  const GROUP_MIN_LEN = 3; /* słowa krótsze nie dostają własnej grupy */
  const PARTIAL_LIMIT = 40;

  /* ---------- 3. Normalizacja i słowa ---------- */
  const norm = (s) => String(s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
  const words = (s) => norm(s).replace(/\./g, " ").split(" ").filter(Boolean);

  /* Zapytanie wyglądające na numer kodu: „88”, „93.11”, „g50”. */
  const isCodeLike = (qn) => /^[0-9]{1,2}(\.[0-9]*)?$|^[a-z]{1,2}[0-9]{0,3}$/.test(qn);

  /* Słowa zapytania. Kropka w zapytaniu zaczynającym się od cyfry zostaje (to numer kodu). */
  function tokens(qn) {
    const sep = /^[0-9]/.test(qn) ? "." : " ";
    return qn.replace(/\./g, sep).split(" ").filter(Boolean).slice(0, MAX_TOKENS);
  }

  /* Skracanie końcówki fleksyjnej: „tarczycy” → „tarczy”, „terapia” → „terap”. Bez zmian względem poprzedniej wersji. */
  function stem(tok) {
    if (tok.length >= 8) return tok.slice(0, tok.length - 3);
    if (tok.length >= 5) return tok.slice(0, Math.max(4, tok.length - 2));
    return tok;
  }

  /* ---------- 4. Rozwinięcie słowa na warianty ----------
   * Wynik: { spec, gen, excl, exclWords }
   *   spec  warianty KONKRETNE (początki słów); zwykły wynik
   *   gen   warianty OGÓLNE; każdy to lista początków, które muszą wystąpić RAZEM
   *         (np. ["konczyn","doln"] = „kończyna dolna”). Kod trafiony tylko przez wariant ogólny
   *         trafia do wyników zawsze PONIŻEJ kodów trafionych konkretnie.
   *   excl, exclWords  jeśli kod je zawiera, wariant ogólny go nie łapie (inny staw, ręka/stopa itp.)
   *   side, otherSide  właściwa i przeciwna kończyna („doln”/„gorn”); przeciwna wyklucza kod,
   *         chyba że kod wymienia obie */
  const cache = new Map();
  function expand(tok) {
    if (cache.has(tok)) return cache.get(tok);
    const r = expandRaw(tok);
    if (cache.size > 500) cache.clear();
    cache.set(tok, r);
    return r;
  }
  function expandRaw(tok) {
    const none = { spec: [], gen: [], excl: [], exclWords: [], side: null, otherSide: null };
    if (SYN[tok]) return { ...none, spec: SYN[tok].slice() };
    const joint = tok.length >= JOINT_MIN && JOINTS.find((j) => j.starts.some((s) => tok.startsWith(s)));
    if (joint) return jointVariants(joint);
    const keys = tok.length >= SYN_PREFIX_MIN ? SYN_KEYS.filter((k) => k.startsWith(tok)) : [];
    if (keys.length) return { ...none, spec: synPrefixVariants(tok, keys) };
    return { ...none, spec: [stem(tok)] };
  }

  /* Niedokończone słowo = wszystkie pasujące klucze SYN; samo wpisane słowo dokładamy na końcu
   * tylko wtedy, gdy łapie coś, czego nie łapią warianty (np. „ren” łapie też „renina”). */
  function synPrefixVariants(tok, keys) {
    const out = [];
    for (const k of keys) for (const v of SYN[k]) if (!out.includes(v)) out.push(v);
    if (!out.some((v) => tok.startsWith(v))) out.push(tok);
    return out;
  }

  function jointVariants(joint) {
    const side = joint.lower ? "doln" : "gorn";
    const other = joint.lower ? "gorn" : "doln";
    const otherRoots = JOINTS.filter((j) => j !== joint).flatMap((j) => j.roots);
    return {
      spec: joint.roots.slice(),
      gen: [["staw"], ["konczyn", side], ["miesniowo"]],
      excl: [...otherRoots, ...OTHER_JOINT_ROOTS],
      exclWords: joint.lower ? UPPER_WORDS : LOWER_WORDS,
      side, otherSide: other
    };
  }

  /* Wszystkie warianty jednego słowa jako płaska lista (używa jej podświetlanie w app.js). */
  function alts(tok) {
    const x = expand(tok);
    const out = x.spec.slice();
    for (const g of x.gen) for (const v of g) if (!out.includes(v)) out.push(v);
    return out;
  }

  /* ---------- 5. Test trafienia ---------- */
  /* Któreś słowo listy zaczyna się od wariantu (wariant 1-literowy musi być całym słowem). */
  const hitWord = (list, v) => list.some((w) => (v.length < 2 ? w === v : w.startsWith(v)));
  const hitAll = (list, group) => group.every((v) => hitWord(list, v));
  const hitAny = (list, vs) => vs.some((v) => hitWord(list, v));

  /* Druga kończyna wyklucza kod, chyba że kod wymienia obie (np. 88.793 „USG kończyn górnych lub dolnych”). */
  function excluded(e, x) {
    if (hitAny(e.all, x.excl) || e.all.some((w) => x.exclWords.includes(w))) return true;
    return !!x.otherSide && hitWord(e.all, x.otherSide) && !hitWord(e.all, x.side);
  }

  /* Wynik dla jednego słowa w jednym kodzie: null (brak) albo { own, generic }.
   * own = trafienie we własnej nazwie (w ICD-10 także w określeniu włączonym: wtedy inc = true),
   *       inaczej tylko w nazwach nadrzędnych,
   * generic = trafienie tylko wariantem ogólnym. */
  function matchToken(e, x) {
    const sOwn = hitAny(e.own, x.spec);
    const sInc = !sOwn && e.inc.length > 0 && hitAny(e.inc, x.spec); /* tylko ICD-10; w ICD-9 lista jest pusta */
    const sCtx = !sOwn && !sInc && hitAny(e.ctx, x.spec);
    if (sOwn || sInc || sCtx) return { own: sOwn || sInc, inc: sInc, generic: false };
    if (!x.gen.length) return null;
    const gOwn = x.gen.some((g) => hitAll(e.own, g));
    const gCtx = !gOwn && x.gen.some((g) => hitAll(e.ctx, g));
    if ((!gOwn && !gCtx) || excluded(e, x)) return null; /* wykluczenia sprawdzamy na końcu, bo są najwolniejsze */
    return { own: gOwn, generic: true };
  }

  /* ---------- 6. Ocena ---------- */
  const lenPenalty = (e) => Math.min(LEN_MAX_PENALTY, e.name.length / LEN_DIVISOR);
  const variantCount = (x) => x.spec.length + x.gen.length;

  /* Ocena kodu dla całego zapytania.
   * Zwraca { all, score, generic, partialScore }:
   *   all      wszystkie słowa trafione
   *   generic  ile słów trafiło tylko wariantem ogólnym (0 = wynik w pełni konkretny)
   *   partialScore  ocena do wyników częściowych (gdy nie wszystkie słowa pasują) albo null */
  function scoreEntry(e, xs) {
    let score = 0, n = 0, generic = 0, all = true, ownAll = true, nameAll = true, firstHit = false;
    for (let i = 0; i < xs.length; i++) {
      const m = matchToken(e, xs[i]);
      if (!m) { all = false; continue; }
      n++; if (i === 0) firstHit = true;
      if (m.generic) generic++;
      if (!m.own) ownAll = false;
      if (!m.own || m.inc || m.generic) nameAll = false;
      score += m.own ? (m.inc ? PTS_INC : PTS_OWN) : PTS_CTX;
      if (variantCount(xs[i]) > 1 && hitWord(e.own, xs[i].spec[0])) score += PTS_MAIN_VARIANT;
    }
    if (!all) {
      const partialScore = xs.length > 1 && n > 0 && firstHit
        ? n * PTS_PARTIAL_WORD + (e.diag ? PTS_DIAG : 0) + (e.hasKids ? PTS_PARTIAL_CAT : 0) - lenPenalty(e)
        : null;
      return { all: false, score: 0, generic, nameAll: false, partialScore };
    }
    if (ownAll) score += PTS_ALL_OWN;
    if (e.diag) score += PTS_DIAG;
    if (!e.hasKids) score += PTS_LEAF;
    score -= lenPenalty(e);
    if (e.own[0] && xs[0].spec.some((v) => e.own[0].startsWith(v))) score += PTS_FIRST_WORD;
    return { all: true, score, generic, nameAll, partialScore: null };
  }

  /* Ocena dopasowania po numerze kodu (0 = nie pasuje). */
  function codeScore(e, qn) {
    const cl = e.code.toLowerCase();
    if (cl === qn) return PTS_CODE_EXACT;
    if (cl.startsWith(qn)) return PTS_CODE_PREFIX - (cl.length - qn.length) * PTS_CODE_PER_CHAR;
    return 0;
  }

  /* ---------- 7. Sortowanie ----------
   * 1) mniej słów trafionych tylko wariantem ogólnym (konkretne zawsze nad ogólnymi),
   *    w ICD-10 potem częste rozpoznania (COMMON10), w ICD-9 ten krok nic nie zmienia,
   *    (opcjonalnie, gdy LEAF_FIRST: kody końcowe przed kategoriami ogólnymi)
   * 2) więcej punktów,
   * 3) przy remisie: wcześniej w nazwie stoi trafione słowo (trafniejsze), potem krótsza nazwa
   *    (przy szukaniu po numerze kodu remis rozstrzyga od razu numer),
   * 4) na końcu numer kodu (żeby kolejność była zawsze ta sama). */
  const leafRank = (x) => (x.e.hasKids ? 1 : 0);
  const byCodeNum = (a, b) => a.code.localeCompare(b.code, "pl", { numeric: true });
  function compare(a, b) {
    const d = (a.generic - b.generic) || (b.common - a.common)
      || (LEAF_FIRST ? leafRank(a) - leafRank(b) : 0) || (b.score - a.score);
    if (d) return d;
    if (a.byNumber && b.byNumber) return byCodeNum(a.e, b.e); /* szukanie po numerze: kolejność numerów, jak dotąd */
    return (a.pos - b.pos) || (a.e.name.length - b.e.name.length) || byCodeNum(a.e, b.e);
  }

  /* Pozycja (numer słowa) pierwszego trafionego słowa w nazwie; 99 = brak. Służy tylko do remisów. */
  function firstPos(e, xs) {
    for (let i = 0; i < e.own.length; i++) {
      const w = e.own[i];
      if (xs.some((x) => x.spec.some((v) => (v.length < 2 ? w === v : w.startsWith(v))))) return i;
    }
    return 99;
  }

  /* ---------- 8. Indeks ---------- */
  /* data.codes: [kod, nazwa, poziom 0–3, kodRodzica, maKody 0/1]
   * opts.kind: "icd9" (domyślnie) albo "icd10". Dla ICD-10 dochodzą określenia włączone (data.notes[kod].i)
   * i znaki † / * (data.marks). Indeks ICD-9 budowany jest dokładnie tak jak dotąd. */
  function createIndex(data, opts) {
    const kind = (opts && opts.kind) || "icd9";
    const byCode = new Map(), kids = new Map(), entries = [];
    for (const [code, name, lvl, parent, hasKids] of data.codes) {
      byCode.set(code, { code, name, lvl, parent, hasKids });
      if (parent) { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(code); }
    }
    for (const e of byCode.values()) {
      const chain = []; let p = e.parent, guard = 0;
      while (p && byCode.has(p) && guard++ < 6) { chain.unshift(byCode.get(p)); p = byCode.get(p).parent; }
      e.chain = chain;
      e.own = words(e.name);
      e.ctx = chain.flatMap((c) => words(c.name));
      e.all = e.own.concat(e.ctx); /* do sprawdzania wykluczeń wariantów ogólnych */
      e.diag = /^(8[7-9]|9[0-2]|9[35])/.test(e.code) || /^[A-Z]/.test(e.code);
      const inc = kind === "icd10" && data.notes && data.notes[e.code] && data.notes[e.code].i;
      e.incText = inc ? inc : [];
      e.inc = inc ? words(inc.join(" ")) : [];
      e.mark = (kind === "icd10" && data.marks && data.marks[e.code]) || "";
      e.isRange = e.code.includes("\u2013"); /* rozdział lub blok ICD-10, np. „J40–J47” */
      e.common = kind === "icd10" && isCommon10(e.code) ? 1 : 0; /* w ICD-9 zawsze 0 */
      entries.push(e);
    }
    return { kind, entries, byCode, kids };
  }

  /* ---------- 9. Wyszukiwanie ----------
   * Wynik: null (puste zapytanie) albo { toks, items, partial?, groups? }. */
  const isTooShort = (q) => String(q || "").trim().length > 0 && String(q || "").trim().length < MIN_CHARS;

  function search(index, q) {
    const raw = String(q || "").trim(); if (!raw) return null;
    const icd10 = index.kind === "icd10";
    const qn = icd10 ? phrases10(norm(raw)) : norm(raw);
    const toks = tokens(qn);
    if (!toks.length) return { toks, items: [] };
    const codeQ = icd10 ? codeQuery10(qn) : (isCodeLike(qn) ? qn : null);
    const xs = toks.map(icd10 ? expand10 : expand);
    const out = [], partial = [];
    for (const e of index.entries) {
      const cs = codeQ && !e.isRange ? codeScore(e, codeQ) : 0;
      if (cs) { out.push({ e, score: cs, generic: 0, pos: 0, byNumber: true, common: 0 }); continue; }
      const r = scoreEntry(e, xs);
      /* common: częste rozpoznanie ICD-10, ale tylko gdy wszystkie słowa są w samej nazwie kodu */
      if (r.all && r.score > MIN_SCORE) out.push({ e, score: r.score, generic: r.generic, pos: firstPos(e, xs), common: e.common && r.nameAll ? 1 : 0 });
      else if (!r.all && r.partialScore !== null) partial.push({ e, score: r.partialScore, generic: r.generic, pos: firstPos(e, xs), common: 0 });
    }
    if (!out.length && toks.length > 1) {
      const groups = groupByWord(index, toks);
      if (groups.length) return { toks, groups, items: groups.flatMap((g) => g.items) };
    }
    if (!out.length && partial.length) {
      partial.sort(compare);
      return { toks, partial: true, items: partial.slice(0, PARTIAL_LIMIT).map((x) => x.e) };
    }
    out.sort(compare);
    return { toks, items: out.map((x) => x.e) };
  }

  /* ---------- 10. Dodatki tylko dla ICD-10 ----------
   * Kod rozpoznania: „j45”, „J45.0”, „j450” (bez kropki), „e11.9”. Jedna litera i 1–3 cyfry. */
  function codeQuery10(qn) {
    const m = /^([a-z])(\d{2})\.?(\d)$/.exec(qn);           /* j450, j45.0 → j45.0 */
    if (m) return m[1] + m[2] + "." + m[3];
    return /^[a-z]\d{1,2}\.?$/.test(qn) ? qn.replace(/\.$/, "") : null; /* j, j4, j45, j45. */
  }

  /* Nazwy w polskim ICD-10 bywają inne niż język gabinetu. Frazy zamieniamy przed podziałem na słowa.
   * Jak dodać: [/wzorzec/, "słowa z nazwy ICD-10"], wszystko małymi literami bez polskich znaków. */
  const PHRASES10 = [
    [/\b(typu?|t\.?) ?(2|ii)\b/g, "insulinoniezalezna"],   /* cukrzyca typu 2 = E11 */
    [/\b(typu?|t\.?) ?(1|i)\b/g, "insulinozalezna"],       /* cukrzyca typu 1 = E10 */
    [/\bdm ?2\b/g, "cukrzyca insulinoniezalezna"],
    [/\bdm ?1\b/g, "cukrzyca insulinozalezna"]
  ];
  const phrases10 = (qn) => PHRASES10.reduce((s, [re, to]) => s.replace(re, to), qn);

  /* Skróty używane w gabinecie → początki słów z nazw ICD-10 (działa jak SYN, tylko dla ICD-10). */
  const SYN10 = {
    pochp: ["obturacyjn"], copd: ["obturacyjn"], azs: ["atopow"], rzs: ["reumatoidaln"], zzsk: ["zesztywniajac"],
    zum: ["moczow"], ibs: ["jelita drazliw"], gerd: ["refluks"], chns: ["niedokrwien"], nt: ["nadcisnie"],
    af: ["migotani"], ms: ["stwardnienie rozsiane"], sm: ["stwardnienie rozsiane"], pnn: ["nerek"], adhd: ["hiperkinetyczn"],
    anemia: ["niedokrwistos", "anemi"], covid: ["covid"], zawal: ["zawal"], udar: ["udar"],
    angina: ["angin", "migdalk"], dyskopatia: ["krazk"], infekcja: ["zakaze", "infekc"], infekcje: ["zakaze", "infekc"],
    alergia: ["alergi", "uczuleni"], uczulenie: ["uczuleni", "alergi"], nerwica: ["nerwic", "lekow"]
  };

  /* Częste rozpoznania w gabinecie (POZ i skierowania do AOS). Gdy pasują do wpisanych słów, stoją na górze
   * listy ICD-10 (kod kategorii obejmuje też jej podkody, np. „I21” = I21, I21.0 … I21.9).
   * To ułatwienie, nie zalecenie: kod zawsze dobiera lekarz. Listę można dowolnie zmieniać albo opróżnić. */
  const COMMON10 = [
    "I10", "I11", "I20", "I21", "I25", "I48", "I50", "I63", "I83", "E03", "E04", "E05", "E06", "E10", "E11", "E66", "E78",
    "D50", "J00", "J01", "J02", "J03", "J06", "J11", "J18", "J20", "J30", "J32", "J40", "J44", "J45", "K21", "K29", "K58",
    "K59", "K80", "M16", "M17", "M19", "M47", "M51", "M54", "M75", "M81", "N20", "N39", "N40", "R10", "R51", "F32", "F33",
    "F41", "F43", "F51", "G43", "G44", "G47", "H10", "H66", "L20", "L40", "L70", "B02", "Z00", "Z01", "Z09", "Z34", "U07", "U09"
  ];
  const isCommon10 = (code) => COMMON10.some((c) => code === c || code.startsWith(c + "."));
  const cache10 = new Map();
  function expand10(tok) {
    if (cache10.has(tok)) return cache10.get(tok);
    let r;
    if (SYN10[tok]) {
      /* wariant złożony z dwóch słów („jelita drazliw”) traktujemy jako ogólny, wymagający obu słów */
      const single = SYN10[tok].filter((v) => !v.includes(" "));
      const multi = SYN10[tok].filter((v) => v.includes(" ")).map((v) => v.split(" "));
      r = { spec: single.length ? single : [tok], gen: multi, excl: [], exclWords: [], side: null, otherSide: null };
    } else r = expand(tok);
    if (cache10.size > 500) cache10.clear();
    cache10.set(tok, r);
    return r;
  }

  /* Żaden kod nie zawiera wszystkich słów: osobna lista dla każdego słowa (trafienie we własnej nazwie). */
  function groupByWord(index, toks) {
    const groups = [];
    for (const t of toks) {
      if (t.length < GROUP_MIN_LEN) continue;
      const x = index.kind === "icd10" ? expand10(t) : expand(t);
      const found = [];
      for (const e of index.entries) {
        const m = matchToken(e, x);
        if (m && m.own) found.push({ e, generic: m.generic ? 1 : 0 });
      }
      found.sort((a, b) => (a.generic - b.generic) || (b.e.diag - a.e.diag)
        || ((a.e.hasKids ? 1 : 0) - (b.e.hasKids ? 1 : 0)) || (a.e.name.length - b.e.name.length));
      const items = found.slice(0, GROUP_LIMIT).map((f) => f.e);
      if (items.length) groups.push({ label: t, items });
    }
    return groups;
  }

  /* Warianty do podświetlania; dla ICD-10 z uwzględnieniem fraz i skrótów ICD-10. */
  function alts10(tok) {
    const x = expand10(tok);
    const out = x.spec.slice();
    for (const g of x.gen) for (const v of g) if (!out.includes(v)) out.push(v);
    return out;
  }
  /* Określenia włączone kodu ICD-10, w których jest któreś z wpisanych słów (do pokazania pod nazwą). */
  function matchedInclusions(e, toks, max) {
    if (!e.incText || !e.incText.length || !toks || !toks.length) return [];
    const xs = toks.map(expand10);
    if (xs.every((x) => hitAny(e.own, x.spec))) return []; /* wszystko widać już w nazwie */
    return e.incText.filter((t) => { const w = words(t); return xs.some((x) => hitAny(w, x.spec) && !hitAny(e.own, x.spec)); }).slice(0, max || 2);
  }

  const api = { SYN, SYN10, JOINTS, MIN_CHARS, norm, words, tokens, stem, expand, expand10, alts, alts10, hitWord, matchToken, scoreEntry,
    createIndex, search, isTooShort, isCodeLike, codeQuery10, phrases10, matchedInclusions };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KodySearch = api;
})(typeof self !== "undefined" ? self : this);
