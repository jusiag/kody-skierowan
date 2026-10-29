/* search.js: wyszukiwanie kodów procedur ICD-9 (czysty moduł, bez dostępu do DOM).
 *
 * Działa w przeglądarce (ładowany w index.html przed app.js, udostępnia KodySearch)
 * i w Node (testy: tests/search.test.js).
 *
 * Droga zapytania, krok po kroku (każdy krok to osobna, krótka funkcja):
 *   1. norm()       normalizacja tekstu (małe litery, bez ogonków)
 *   2. tokenize()   zapytanie -> lista słów (tokenów)
 *   3. expand()     słowo -> warianty: KONKRETNE (specific) i OGÓLNE (generic)
 *   4. matchToken() czy dany kod pasuje do słowa i jak dobrze (nazwa własna / nadrzędna)
 *   5. score*()     ocena punktowa (stałe w SCORE, każda z opisem)
 *   6. compare()    sortowanie: warstwa -> własna/nadrzędna -> punkty -> remis -> numer kodu
 *
 * Najważniejsza zasada (SPECYFICZNOŚĆ): wariant ogólny („staw”, „kończyna dolna”) może tylko
 * UZUPEŁNIAĆ wyniki. Kod trafiony wyłącznie wariantem ogólnym ląduje zawsze PO wszystkich
 * kodach trafionych wariantem konkretnym, i nigdy nie łączy przeciwnej strony ciała
 * (kolano nie dostaje „kończyny górnej”, bark nie dostaje „kończyny dolnej”).
 */
(function (global) {
  "use strict";

  /* ---------- Skróty i synonimy (słownik SYN) ----------
   * Klucz = wpisane słowo, wartość = początki słów, które mają pasować.
   * Pierwszy wariant to „samo słowo” (dostaje premię WORD_ITSELF), reszta to synonimy.
   * Nowy skrót: dopisz wiersz (opis w PROJEKT.md, sekcja „Wyszukiwanie”). */
  const SYN = {
    usg: ["usg", "ultrasonogra", "ultradzwiek", "echokardiogra"], ultrasonografia: ["usg", "ultrasonogra"],
    rtg: ["rtg", "rentgen", "radiogra"], rentgen: ["rtg", "rentgen", "radiogra"],
    /* „zdjec” (a nie „zdjeci”), bo w słowniku jest też „zdjęć” (23.0301: „do 2 zdjęć wewnątrzustnych”) */
    zdjecie: ["rtg", "zdjec", "radiogra"],
    tk: ["tk", "tomogra"], ct: ["tk", "tomogra"], tomografia: ["tk", "tomogra"],
    mr: ["rezonans", "rm"], mri: ["rezonans", "rm"], rm: ["rezonans", "rm"], nmr: ["rezonans", "rm"], rezonans: ["rezonans", "rm"],
    ekg: ["ekg", "elektrokardiogra"], echo: ["echokardiogra", "echo"], eeg: ["eeg", "elektroencefalogra"], emg: ["emg", "elektromiogra"],
    ktg: ["ktg", "kardiotokogra"], pet: ["pet", "pozytonow"], gastroskopia: ["gastroskop", "ezofagogastroduodenoskop"],
    /* Nieregularne odmiany: słownik ma „uda”, „brzucha”, „ręki”, a pacjent/lekarz wpisuje „udo”, „brzusznej”, „ręka” */
    udo: ["udo", "uda"], uda: ["uda", "udo"],
    brzuch: ["brzuch", "brzuszn"], brzucha: ["brzuch", "brzuszn"], brzuszny: ["brzuszn", "brzuch"], brzusznej: ["brzuszn", "brzuch"], brzusznych: ["brzuszn", "brzuch"], brzuszna: ["brzuszn", "brzuch"], brzuszne: ["brzuszn", "brzuch"], brzusznego: ["brzuszn", "brzuch"],
    reka: ["rek", "dlon"], reki: ["rek", "dlon"], reke: ["rek", "dlon"],
    morfologia: ["morfologi"], konsultacja: ["konsultac", "porada"], porada: ["porada", "konsultac"], fizjoterapia: ["fizjoterap"], rehabilitacja: ["rehabilit", "fizjoterap"]
  };
  const SYN_KEYS = Object.keys(SYN);
  /* Tylko własne klucze (bez „constructor” i innych z prototypu obiektu). */
  const synOf = (t) => (Object.prototype.hasOwnProperty.call(SYN, t) ? SYN[t] : null);
  /* Niedokończone słowo od tylu znaków traktujemy jak początek klucza z SYN („zdjeci” = „zdjecie”). */
  const SYN_PREFIX_MIN = 3;

  /* ---------- Stawy i strona ciała ----------
   * roots: początki słów oznaczające dany staw (konkretne),
   * side: strona ciała (dolna / gorna), family: ten sam staw pod różnymi nazwami (kostka = skokowy). */
  const JOINTS = [
    { roots: ["kolan"], side: "dolna", family: "kolano" },
    { roots: ["bark"], side: "gorna", family: "bark" },
    { roots: ["biodr"], side: "dolna", family: "biodro" },
    { roots: ["lokc", "lokie"], side: "gorna", family: "lokiec" }, /* łokcia / łokieć: różne rdzenie jednego słowa */
    { roots: ["nadgar"], side: "gorna", family: "nadgarstek" },
    { roots: ["skokow"], side: "dolna", family: "kostka" },
    { roots: ["kostk"], side: "dolna", family: "kostka" },
    { roots: ["dlon"], side: "gorna", family: "dlon" }
  ];
  /* Inne części ciała: służą tylko do ODRZUCANIA wariantu ogólnego (np. „Uwolnienie stawu - kręgosłup”
   * nie ma być wynikiem dla kolana). Nie rozwijają wpisanego słowa. */
  const OTHER_PARTS = [
    { roots: ["kregoslup", "kregow"], family: "kregoslup" },
    { roots: ["skroniowo", "zuchwow"], family: "zuchwa" },
    { roots: ["palc"], family: "palce" },
    { roots: ["stop"], family: "stopa" }
  ];
  /* Strona kończyny: „kończyny dolnej/dolnych”. Słowa „dolnej/górnej” liczą się tylko razem ze słowem „kończyn…”
   * (inaczej łapałyby „powieki dolnej”, „żyły głównej dolnej”). */
  const SIDE_WORDS = { dolna: ["dolnej", "dolnych"], gorna: ["gornej", "gornych"] };
  const LIMB_WORD = "konczyn";
  /* Warianty OGÓLNE dla stawu (poza stroną kończyny): każdy staw, każde badanie układu kostno-mięśniowego. */
  const JOINT_GENERIC = ["staw", "miesniowo"];
  const JOINT_MIN_LEN = 4; /* krótsze słowo nie jest uznawane za nazwę stawu */

  /* Słowa-wypełniacze: gdy z nimi nic nie pasuje, szukamy jeszcze raz bez nich
   * („usg jamy brzusznej” -> „usg brzusznej”). Używane tylko wtedy, gdy zwykłe wyszukiwanie niczego nie znalazło. */
  const FILLER_WORDS = ["jamy", "jama", "jamie", "okolicy", "okolica", "narzadow", "narzadu"];

  /* ---------- Ograniczenia (ochrona przed bardzo długim zapytaniem) ---------- */
  const MAX_QUERY_CHARS = 120;
  const MAX_TOKENS = 8;

  /* ---------- Punktacja ----------
   * Wartości zostały odziedziczone z poprzedniej wersji bez zmian. Każda ma nazwę i powód. */
  const SCORE = {
    OWN: 10,          /* słowo trafione we WŁASNEJ nazwie kodu */
    CTX: 3,           /* słowo trafione tylko w nazwach nadrzędnych kategorii (słabsze) */
    WORD_ITSELF: 4,   /* trafione samo wpisane słowo, a nie tylko jego synonim (np. „zdjecie” > „rtg”) */
    ALL_OWN: 25,      /* wszystkie słowa we własnej nazwie: pewniejsze niż trafienie „z kategorii” */
    DIAG: 6,          /* kody diagnostyczne (rozdziały 87–92, 93, 95 i literowe): lekarz szuka głównie ich */
    LEAF: 2,          /* kod końcowy (bez kodów szczegółowych) można skopiować, więc jest lepszy niż kategoria */
    LEN_DIVISOR: 18,  /* każde 18 znaków nazwy odejmuje punkt: krótsza nazwa = bardziej konkretny kod */
    LEN_MAX: 8,       /* ... ale nie więcej niż tyle punktów */
    FIRST_WORD: 4,    /* nazwa zaczyna się od szukanego pierwszego słowa */
    CODE_EXACT: 1000, /* wpisano cały kod */
    CODE_PREFIX: 500, /* wpisano początek kodu */
    CODE_GAP: 10,     /* kara za każdy brakujący znak kodu (krótszy kod wyżej) */
    PARTIAL_TOKEN: 10,   /* wyniki „częściowe”: punkty za każde trafione słowo */
    PARTIAL_CATEGORY: 4  /* ... przy częściowych wolimy kategorie ogólne */
  };
  const PARTIAL_LIMIT = 40;  /* ile wyników częściowych pokazujemy */
  const GROUP_LIMIT = 10;    /* ile kodów na jedno słowo w widoku „grupy” */

  /* ---------- Krok 1–2: normalizacja i tokeny ---------- */

  /* Małe litery, „ł”→„l”, bez ogonków (NFKD: także pełnoszerokie „ＵＳＧ” → „usg”), tylko a-z, 0-9 i kropka. */
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
  /* Słowa nazwy (kropki też dzielą słowa). */
  const words = (s) => norm(s).replace(/\./g, " ").split(" ").filter(Boolean);

  /* Zapytanie -> { toks: słowa, codeLike: czy wygląda na początek kodu („88”, „93.11”, „g50”) }. */
  function tokenize(raw) {
    const qn = norm(String(raw == null ? "" : raw).slice(0, MAX_QUERY_CHARS));
    const codeLike = /^[0-9]{1,2}(\.[0-9]*)?$|^[a-z]{1,2}[0-9]{0,3}$/.test(qn);
    const toks = qn.replace(/\./g, /^[0-9]/.test(qn) ? "." : " ").split(" ").filter(Boolean).slice(0, MAX_TOKENS);
    return { qn, codeLike, toks };
  }

  /* ---------- Krok 3: rozwinięcie słowa w warianty ---------- */

  /* Skracanie końcówek fleksyjnych: ≥8 znaków bez 3 ostatnich, ≥5 bez 2 (min. 4), krótsze bez zmian. */
  const stem = (t) => (t.length >= 8 ? t.slice(0, t.length - 3) : t.length >= 5 ? t.slice(0, Math.max(4, t.length - 2)) : t);

  const uniq = (list) => list.filter((x, i) => list.indexOf(x) === i);

  /* Który staw nazywa słowo (indeks w JOINTS albo -1). */
  const findJoint = (tok) => (tok.length < JOINT_MIN_LEN ? -1 : JOINTS.findIndex((j) => j.roots.some((r) => tok.startsWith(r))));

  /* Niedokończone słowo (≥ SYN_PREFIX_MIN znaków), które jest początkiem klucza z SYN, zachowuje się jak ten klucz
   * (suma wariantów wszystkich pasujących kluczy) i dodatkowo jak wpisane literalnie, żeby nie zgubić zwykłych słów
   * zaczynających się tak samo (np. „kon” = „konsultacja”, ale nadal też „kończyna”). */
  function expandByPrefix(tok) {
    if (tok.length < SYN_PREFIX_MIN) return null;
    const keys = SYN_KEYS.filter((k) => k.startsWith(tok));
    if (!keys.length) return null;
    return uniq(keys.flatMap((k) => SYN[k]).concat(tok));
  }

  /* Rozwinięcie jednego słowa:
   *   specific: warianty konkretne (rdzeń słowa, synonimy z SYN),
   *   generic:  warianty ogólne (tylko dla stawów: „staw”; do tego dochodzi strona kończyny, patrz side),
   *   side, family: strona ciała i nazwa stawu (tylko dla stawów), potrzebne do pilnowania strony ciała,
   *   all:      wszystkie warianty razem (konkretne, ogólne, słowa strony kończyny), m.in. do podświetlania. */
  function expand(tok) {
    const syn = synOf(tok);
    const j = syn ? null : JOINTS[findJoint(tok)] || null;
    const specific = syn ? syn.slice() : j ? j.roots.slice() : expandByPrefix(tok) || [stem(tok)];
    const generic = j ? JOINT_GENERIC.slice() : [];
    const sideWords = j ? SIDE_WORDS[j.side] : [];
    return { tok, specific, generic, side: j && j.side, family: j && j.family, all: specific.concat(generic, sideWords) };
  }

  /* Wszystkie warianty słowa (konkretne, potem ogólne): używane m.in. do podświetlania wyników. */
  const alts = (tok) => expand(tok).all;

  /* ---------- Krok 4: dopasowanie ---------- */

  /* Słowo nazwy zaczyna się od wariantu (wariant 1-znakowy musi być równy słowu). */
  const hit = (list, alt) => list.some((w) => (alt.length < 2 ? w === alt : w.startsWith(alt)));
  const hitAny = (list, variants) => variants.some((v) => hit(list, v));

  /* Wynik dopasowania jednego słowa do kodu. */
  const NO = 0, OWN_SPECIFIC = 1, CTX_SPECIFIC = 2, OWN_GENERIC = 3, CTX_GENERIC = 4;
  const isOwn = (m) => m === OWN_SPECIFIC || m === OWN_GENERIC;
  const isGeneric = (m) => m === OWN_GENERIC || m === CTX_GENERIC;

  /* Czy wariant ogólny wolno użyć dla tego kodu? Nie wolno, gdy kod dotyczy przeciwnej strony ciała
   * (np. „kończyna górna” przy kolanie) albo innego stawu lub części ciała
   * (np. „USG stawów barkowych” albo „Uwolnienie stawu - kręgosłup” przy kolanie). */
  function genericAllowed(e, ex) {
    const lower = ex.side === "dolna";
    const same = lower ? e.lowerLimb : e.upperLimb;
    const opposite = lower ? e.upperLimb : e.lowerLimb;
    if (opposite && !same) return false;
    if (e.families.length && !e.families.includes(ex.family)) return false;
    return true;
  }

  /* Trafienie wariantem ogólnym w podanych słowach: „staw”... albo strona kończyny (tylko gdy kod mówi o kończynie). */
  function genericHit(words, e, ex) {
    const sideOk = ex.side === "dolna" ? e.lowerLimb : e.upperLimb;
    return hitAny(words, ex.generic) || (sideOk && hitAny(words, SIDE_WORDS[ex.side]));
  }

  /* Jak kod pasuje do słowa. Kolejność = specyficzność: konkretny w nazwie własnej, konkretny w nadrzędnych,
   * dopiero potem ogólny (własna, nadrzędne). */
  function matchToken(e, ex) {
    if (hitAny(e.own, ex.specific)) return OWN_SPECIFIC;
    if (hitAny(e.ctx, ex.specific)) return CTX_SPECIFIC;
    if (ex.side && genericAllowed(e, ex)) {
      if (genericHit(e.own, e, ex)) return OWN_GENERIC;
      if (genericHit(e.ctx, e, ex)) return CTX_GENERIC;
    }
    return NO;
  }

  /* Dopasowanie wszystkich słów zapytania do kodu: lista wyników matchToken (jeden na słowo). */
  const matchAll = (e, exps) => exps.map((ex) => matchToken(e, ex));

  /* To samo, ale kończy na pierwszym słowie bez trafienia (zwraca null): większość kodów odpada od razu,
   * dzięki czemu długie zapytania są szybkie. */
  function matchEvery(e, exps) {
    const matches = [];
    for (const ex of exps) {
      const m = matchToken(e, ex);
      if (m === NO) return null;
      matches.push(m);
    }
    return matches;
  }

  /* ---------- Krok 5: ocena ---------- */

  /* Kara za długość nazwy: krótka nazwa = bardziej konkretny kod. */
  const lengthPenalty = (e) => Math.min(SCORE.LEN_MAX, e.name.length / SCORE.LEN_DIVISOR);

  /* Ocena kodu, który pasuje do WSZYSTKICH słów (matches: wynik matchAll). */
  function scoreFull(e, exps, matches) {
    let t = 0;
    for (let i = 0; i < exps.length; i++) {
      const ex = exps[i];
      t += isOwn(matches[i]) ? SCORE.OWN : SCORE.CTX;
      if (ex.all.length > 1 && hit(e.own, ex.specific[0])) t += SCORE.WORD_ITSELF;
    }
    if (matches.every(isOwn)) t += SCORE.ALL_OWN;
    if (e.diag) t += SCORE.DIAG;
    if (!e.hasKids) t += SCORE.LEAF;
    t -= lengthPenalty(e);
    if (e.own[0] && exps[0].all.some((x) => e.own[0].startsWith(x))) t += SCORE.FIRST_WORD;
    return t;
  }

  /* Ocena kodu pasującego tylko do części słów (wyniki „częściowe”: pasuje pierwsze słowo). */
  function scorePartial(e, matched) {
    return matched * SCORE.PARTIAL_TOKEN + (e.diag ? SCORE.DIAG : 0) + (e.hasKids ? SCORE.PARTIAL_CATEGORY : 0) - lengthPenalty(e);
  }

  /* Ocena trafienia po początku kodu. */
  function scoreCode(e, qn) {
    const cl = e.code.toLowerCase();
    if (cl === qn) return SCORE.CODE_EXACT;
    if (cl.startsWith(qn)) return SCORE.CODE_PREFIX - (cl.length - qn.length) * SCORE.CODE_GAP;
    return 0;
  }

  /* Rozstrzyganie remisów punktowych: ile słów trafiono jako CAŁY wyraz, a nie tylko jego początek (exact;
   * porównujemy wariant, nie dosłowną formę, więc „kolano” i „kolana” dają to samo), i jak wcześnie
   * w nazwie wypada trafienie (pos, suma indeksów słów; trafienie tylko w nadrzędnych = koniec nazwy). */
  function tieInfo(e, exps, matches) {
    let exact = 0, pos = 0;
    for (let i = 0; i < exps.length; i++) {
      if (exps[i].specific.some((v) => e.own.includes(v))) exact++;
      const k = matches[i] && isOwn(matches[i]) ? e.own.findIndex((w) => hitAny([w], exps[i].all)) : -1;
      pos += k >= 0 ? k : e.own.length;
    }
    return { exact, pos };
  }

  /* ---------- Krok 6: sortowanie ----------
   * Kolejność:
   *   1. tier:   0 = trafione konkretnie, 1 = wspomagane wariantem ogólnym (zawsze za warstwą 0),
   *   2. viaCtx: 0 = wszystkie słowa we własnej nazwie, 1 = któreś tylko w nazwach nadrzędnych (zawsze za 0),
   *   3. punkty malejąco,
   *   4. remis punktowy: więcej słów trafionych dokładnie, potem wcześniejsze trafienie w nazwie,
   *   5. numer kodu (dopiero na końcu). */
  const collator = new Intl.Collator("pl", { numeric: true });
  const compare = (a, b) => a.tier - b.tier || a.viaCtx - b.viaCtx || b.score - a.score || b.exact - a.exact || a.pos - b.pos || collator.compare(a.e.code, b.e.code);

  /* ---------- Indeks kodów (budowany raz po wczytaniu słownika) ---------- */

  /* Kody diagnostyczne: rozdziały 87–92, 93, 95 oraz kody literowe (badania laboratoryjne). */
  const isDiag = (code) => /^(8[7-9]|9[0-2]|9[35])/.test(code) || /^[A-Z]/.test(code);

  /* codes: tablica [kod, nazwa, poziom, kodRodzica, maKody] z data/icd9.json.
   * Każdy wpis dostaje: own (słowa nazwy), ctx (słowa nazw nadrzędnych), diag, hasKids oraz
   * pola pomocnicze do pilnowania strony ciała i stawu (lowerLimb, upperLimb, families). */
  function buildIndex(codes) {
    const byCode = new Map(), kids = new Map(), index = [];
    for (const row of Array.isArray(codes) ? codes : []) {
      /* Uszkodzony wiersz (brak kodu lub nazwy) pomijamy, żeby jeden zły wpis nie psuł całego wyszukiwania. */
      if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
      const [code, name, lvl, parent, hasKids] = row;
      byCode.set(code, { code, name, lvl, parent, hasKids });
      if (parent) { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(code); }
    }
    for (const e of byCode.values()) {
      const chain = []; let p = e.parent, guard = 0;
      while (p && byCode.has(p) && guard++ < 6) { chain.unshift(byCode.get(p)); p = byCode.get(p).parent; }
      e.chain = chain;
      e.own = words(e.name);
      e.ctx = chain.flatMap((c) => words(c.name));
      e.diag = isDiag(e.code);
      const all = e.own.concat(e.ctx);
      const limb = hit(all, LIMB_WORD);
      e.lowerLimb = limb && hitAny(all, SIDE_WORDS.dolna);
      e.upperLimb = limb && hitAny(all, SIDE_WORDS.gorna);
      e.families = uniq(JOINTS.concat(OTHER_PARTS).filter((j) => hitAny(all, j.roots)).map((j) => j.family));
      index.push(e);
    }
    return { byCode, kids, index };
  }

  /* ---------- Wyszukiwanie ---------- */

  /* Kody pasujące do wszystkich słów, uporządkowane. */
  function rankFull(index, exps) {
    const out = [];
    for (const e of index) {
      const matches = matchEvery(e, exps);
      if (!matches) continue;
      const tie = tieInfo(e, exps, matches);
      out.push({ e, score: scoreFull(e, exps, matches), tier: matches.some(isGeneric) ? 1 : 0, viaCtx: matches.every(isOwn) ? 0 : 1, exact: tie.exact, pos: tie.pos });
    }
    return out.sort(compare);
  }

  /* Kody pasujące do części słów (musi pasować pierwsze), gdy nic nie pasuje do wszystkich. */
  function rankPartial(index, exps) {
    const out = [];
    for (const e of index) {
      const matches = matchAll(e, exps);
      const matched = matches.filter((m) => m !== NO).length;
      if (matches[0] === NO || matched === exps.length) continue;
      out.push({ e, score: scorePartial(e, matched), tier: matches.some(isGeneric) ? 1 : 0, viaCtx: 0, exact: 0, pos: 0 });
    }
    return out.sort(compare).slice(0, PARTIAL_LIMIT).map((x) => x.e);
  }

  /* Widok „grupy”: osobno kody dla każdego słowa. Najpierw konkretne, wariant ogólny tylko dopełnia do limitu. */
  function rankGroups(index, toks, exps) {
    const groups = [];
    const order = (x, y) => (y.diag - x.diag) || ((x.hasKids ? 1 : 0) - (y.hasKids ? 1 : 0)) || x.name.length - y.name.length;
    toks.forEach((t, i) => {
      if (t.length < 3) return;
      const ex = exps[i];
      const specific = index.filter((e) => hitAny(e.own, ex.specific)).sort(order).slice(0, GROUP_LIMIT);
      let items = specific;
      if (specific.length < GROUP_LIMIT && ex.side) {
        const fill = index.filter((e) => !specific.includes(e) && genericAllowed(e, ex) && genericHit(e.own, e, ex)).sort(order);
        items = specific.concat(fill.slice(0, GROUP_LIMIT - specific.length));
      }
      if (items.length) groups.push({ label: t, items });
    });
    return groups;
  }

  /* Główna funkcja. Zwraca null (puste zapytanie) albo
   *   { toks, items }                     zwykłe wyniki,
   *   { toks, partial: true, items }      wyniki „częściowe”,
   *   { toks, groups, items }             wyniki pogrupowane per słowo. */
  function search(q, index) {
    const raw = String(q == null ? "" : q).trim();
    if (!raw) return null;
    const { qn, codeLike, toks } = tokenize(raw);
    if (!toks.length) return { toks, items: [] };
    const exps = toks.map(expand);
    const out = [];
    const textMatch = [];
    for (const e of index) {
      const s = codeLike ? scoreCode(e, qn) : 0;
      if (s) out.push({ e, score: s, tier: 0, viaCtx: 0, exact: 0, pos: 0 }); else textMatch.push(e);
    }
    for (const r of rankFull(textMatch, exps)) out.push(r);
    out.sort(compare);
    const kept = toks.filter((t) => !FILLER_WORDS.includes(t));
    if (!out.length && kept.length && kept.length < toks.length) return search(kept.join(" "), index);
    if (!out.length && toks.length > 1) {
      const groups = rankGroups(index, toks, exps);
      if (groups.length) return { toks, groups, items: uniq(groups.flatMap((g) => g.items)) };
    }
    if (!out.length && toks.length > 1) {
      const partial = rankPartial(index, exps);
      if (partial.length) return { toks, partial: true, items: partial };
    }
    return { toks, items: out.map((x) => x.e) };
  }

  const API = { norm, words, tokenize, expand, alts, hit, buildIndex, search, SYN, SCORE, compare };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.KodySearch = API;
})(typeof self !== "undefined" ? self : this);
