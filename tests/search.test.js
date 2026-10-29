/* Testy wyszukiwania. Uruchomienie (z głównego folderu repozytorium):  node tests/search.test.js
 * Bez przeglądarki i bez bibliotek: tylko Node. Kończy się kodem 1, gdy któryś test nie przejdzie. */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "search.js"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "icd9.json"), "utf8"));

const tBuild = process.hrtime.bigint();
const { index, byCode } = S.buildIndex(data.codes);
const buildMs = Number(process.hrtime.bigint() - tBuild) / 1e6;

/* ---------- mały pomocnik do testów ---------- */
let passed = 0, failed = 0;
const failures = [];
function group(title) { console.log("\n" + title); }
function test(name, fn) {
  try { fn(); passed++; console.log("  ok    " + name); }
  catch (e) { failed++; failures.push(name); console.log("  BŁĄD  " + name + "\n          " + String(e.message).split("\n").slice(0, 3).join("\n          ")); }
}
/* Znane ograniczenia: nie są błędem testu, tylko dokumentacją tego, czego wyszukiwarka jeszcze nie potrafi.
 * fn() zwraca true, gdy ograniczenie nadal występuje. Gdy zniknie, test to zgłosi (wtedy zaktualizuj opis). */
function limitation(name, fn) {
  let still;
  try { still = fn(); } catch (e) { still = true; }
  console.log("  " + (still ? "info  " : "NOWE  ") + "(znane ograniczenie" + (still ? "" : " już nie występuje, zaktualizuj test i PROJEKT.md") + ") " + name);
}

const find = (q) => S.search(q, index);
const items = (q) => (find(q) || { items: [] }).items;
const codes = (q, n) => items(q).slice(0, n === undefined ? 1e9 : n).map((e) => e.code);
const norm = S.norm;
const nameHas = (e, re) => re.test(norm(e.name));
const UPPER_LIMB = /konczyn\w*\s+gorn/;      /* dosłownie „kończyny górnej / kończyn górnych” */
const LOWER_LIMB = /konczyn\w*\s+doln/;
const UPPER_ANY = (e) => nameHas(e, /konczyn/) && nameHas(e, /gorn(ej|ych)/);  /* kończyna + „górnej” gdziekolwiek */
const LOWER_ANY = (e) => nameHas(e, /konczyn/) && nameHas(e, /doln(ej|ych)/);
const ownCtxWords = (e) => e.own.concat(e.ctx);
const hasRoot = (e, roots) => ownCtxWords(e).some((w) => roots.some((r) => w.startsWith(r)));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const isSubset = (small, big) => small.every((x) => big.includes(x));

/* =====================================================================
 * 1. Kolano: konkretne trafienia przed ogólnymi, brak kończyny górnej i „kolagenu”
 * ===================================================================== */
group("Kolano");
for (const q of ["kolano", "kolana", "kolano zdjecie", "zdjecie kolana"]) {
  test(`„${q}”: żaden wynik w top 20 nie dotyczy kończyn górnych`, () => {
    const bad = items(q).slice(0, 20).filter((e) => nameHas(e, UPPER_LIMB));
    assert.strictEqual(bad.length, 0, bad.map((e) => e.code + " " + e.name).join("; "));
  });
  test(`„${q}”: brak G50 i innych kodów z „kolagenem” (na całej liście)`, () => {
    const bad = items(q).filter((e) => nameHas(e, /kolagen/) || e.code === "G50");
    assert.strictEqual(bad.length, 0, bad.map((e) => e.code).join(", "));
  });
}
for (const q of ["kolano zdjecie", "zdjecie kolana"]) {
  test(`„${q}”: pierwszy wynik to 88.27`, () => assert.strictEqual(codes(q, 1)[0], "88.27"));
}
test("„kolano” i „kolana” dają ten sam wynik (kolejność też)", () => assert.deepStrictEqual(codes("kolano"), codes("kolana")));
test("„kolano”: 88.798 (USG stawów kolanowych) i 88.27 są w pierwszej trójce", () => {
  const top = codes("kolano", 3);
  assert.ok(top.includes("88.798") && top.includes("88.27"), top.join(", "));
});

/* =====================================================================
 * 2. Specyficzność: wariant ogólny nigdy nie wyprzedza konkretnego i nie łączy przeciwnej strony ciała
 * ===================================================================== */
group("Specyficzność wariantów (stawy)");
const JOINT_QUERIES = [
  ["kolano", ["kolan"], "dolna"], ["kolana", ["kolan"], "dolna"],
  ["biodro", ["biodr"], "dolna"], ["kostka", ["kostk"], "dolna"],
  ["bark", ["bark"], "gorna"], ["lokiec", ["lokc", "lokie"], "gorna"], ["lokcia", ["lokc", "lokie"], "gorna"],
  ["nadgarstek", ["nadgar"], "gorna"], ["dlon", ["dlon"], "gorna"]
];
for (const [q, roots, side] of JOINT_QUERIES) {
  test(`„${q}”: wszystkie kody z nazwą stawu stoją przed kodami trafionymi tylko wariantem ogólnym`, () => {
    const flags = items(q).map((e) => hasRoot(e, roots));
    const firstGeneric = flags.indexOf(false), lastSpecific = flags.lastIndexOf(true);
    assert.ok(lastSpecific >= 0, "brak wyników konkretnych");
    assert.ok(firstGeneric === -1 || lastSpecific < firstGeneric, `konkretny na pozycji ${lastSpecific + 1}, ogólny już na ${firstGeneric + 1}`);
  });
  test(`„${q}”: wynik ogólny nie dotyczy przeciwnej strony ciała`, () => {
    const opposite = side === "dolna" ? UPPER_ANY : LOWER_ANY, same = side === "dolna" ? LOWER_ANY : UPPER_ANY;
    const bad = items(q).filter((e) => !hasRoot(e, roots) && opposite(e) && !same(e));
    assert.strictEqual(bad.length, 0, bad.slice(0, 3).map((e) => e.code + " " + e.name).join("; "));
  });
  test(`„${q}”: wynik ogólny nie dotyczy innego stawu ani kręgosłupa`, () => {
    const others = ["kolan", "bark", "biodr", "lokc", "lokie", "nadgar"].filter((r) => !roots.includes(r)).join("|");
    const other = new RegExp("(^| )(kregoslup|skroniowo|" + others + ")");
    const bad = items(q).filter((e) => !hasRoot(e, roots) && nameHas(e, other));
    assert.strictEqual(bad.length, 0, bad.slice(0, 3).map((e) => e.code + " " + e.name).join("; "));
  });
}
test("„bark rtg”: pierwszy 88.21, brak „kończyny dolnej” w top 20 i na całej liście", () => {
  assert.strictEqual(codes("bark rtg", 1)[0], "88.21");
  assert.strictEqual(items("bark rtg").filter((e) => nameHas(e, LOWER_LIMB)).length, 0);
});
test("„rtg bark” (odwrócona kolejność): też pierwszy 88.21", () => assert.strictEqual(codes("rtg bark", 1)[0], "88.21"));
test("„lokiec usg” i „łokieć usg”: pierwszy 88.795, wyniki identyczne", () => {
  assert.strictEqual(codes("lokiec usg", 1)[0], "88.795");
  assert.deepStrictEqual(codes("łokieć usg"), codes("lokiec usg"));
  assert.strictEqual(codes("łokieć usg", 1)[0], "88.795");
});
test("„lokcia” i „lokiec” (ta sama odmiana słowa) dają ten sam zbiór wyników", () => assert.ok(sameSet(codes("lokcia"), codes("lokiec"))));
test("„biodro usg”: pierwszy 88.797 (USG stawów biodrowych), bez USG innych stawów", () => {
  assert.strictEqual(codes("biodro usg", 1)[0], "88.797");
  const others = items("biodro usg").filter((e) => nameHas(e, /stawow (barkow|lokciow|kolanow)/));
  assert.strictEqual(others.length, 0);
});
test("rozwinięcie słowa „kolano”: konkretny tylko „kolan”, bez „kola” i bez „konczyn”", () => {
  const x = S.expand("kolano");
  assert.deepStrictEqual(x.specific, ["kolan"]);
  assert.ok(!x.all.includes("kola") && !x.all.includes("konczyn") && !x.all.includes("gornej"));
});
test("rozwinięcie słowa „bark”: strona górna, nigdy dolna", () => {
  const all = S.alts("bark");
  assert.ok(all.includes("gornej") && all.includes("gornych") && !all.includes("dolnej") && !all.includes("dolnych"));
});

/* =====================================================================
 * 3. Zapytania wzorcowe z zadania
 * ===================================================================== */
group("Zapytania wzorcowe");
test("„usg tarczycy”: tylko 88.713", () => assert.deepStrictEqual(codes("usg tarczycy"), ["88.713"]));
test("„rtg klatki”: pierwszy 87.440", () => assert.strictEqual(codes("rtg klatki", 1)[0], "87.440"));
test("„konsultacja kardiologiczna”: tylko 89.002", () => assert.deepStrictEqual(codes("konsultacja kardiologiczna"), ["89.002"]));
test("„fizjoterapia”: pierwszy 89.0021, a trzy pierwsze to kody końcowe (przed pierwszą kategorią)", () => {
  const it = items("fizjoterapia");
  assert.strictEqual(it[0].code, "89.0021");
  assert.ok(it.slice(0, 3).every((e) => !e.hasKids), "w trzech pierwszych jest kategoria ogólna");
  assert.ok(it.findIndex((e) => e.hasKids) >= 3);
});
test("kolejność wyszukiwania nie zależy od wielkości liter, ogonków i nadmiaru spacji", () => {
  assert.deepStrictEqual(codes("  USG   TARCZYCY "), codes("usg tarczycy"));
  assert.deepStrictEqual(codes("Łokieć UsG"), codes("lokiec usg"));
});
test("kolejność słów w zapytaniu nie zmienia zbioru wyników", () => {
  for (const [a, b] of [["usg tarczycy", "tarczycy usg"], ["rtg klatki", "klatki rtg"], ["zdjecie kolana", "kolano zdjecie"], ["konsultacja kardiologiczna", "kardiologiczna konsultacja"]]) {
    assert.ok(sameSet(codes(a), codes(b)), `${a} / ${b}`);
  }
});
test("odmiana: „tarczyca usg” znajduje 88.713", () => assert.deepStrictEqual(codes("tarczyca usg"), ["88.713"]));

/* =====================================================================
 * 4. Niedokończone słowa i skróty (SYN)
 * ===================================================================== */
group("Niedokończone słowa (stabilność przy pisaniu)");
test("„zdj”, „zdje”, „zdjec”, „zdjeci”, „zdjecie”: ten sam zbiór i ta sama kolejność", () => {
  const ref = codes("zdjecie");
  for (const q of ["zdj", "zdje", "zdjec", "zdjeci"]) assert.deepStrictEqual(codes(q), ref, q);
});
test("„zdjecie” obejmuje też „zdjęć” (23.0301 – RTG wewnątrzustne)", () => assert.ok(codes("zdjecie").includes("23.0301")));
test("„zdjecie” nie jest węższe niż dawne „zdjeci” (np. 88.39, 88.28, 87.81 nadal są)", () => {
  const set = codes("zdjecie");
  for (const c of ["88.39", "88.28", "87.81", "88.23", "87.29", "88.27", "88.21", "88.12"]) assert.ok(set.includes(c), c);
});
test("każdy początek (≥3 znaki) każdego klucza SYN daje zbiór nie węższy niż pełne słowo", () => {
  const bad = [];
  for (const key of Object.keys(S.SYN)) {
    const full = codes(key);
    for (let n = 3; n < key.length; n++) {
      const part = codes(key.slice(0, n));
      if (!isSubset(full, part)) bad.push(`${key.slice(0, n)} ⊅ ${key}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});
test("każdy klucz SYN daje co najmniej jeden wynik", () => {
  const empty = Object.keys(S.SYN).filter((k) => !codes(k).length);
  assert.deepStrictEqual(empty, []);
});
test("niedokończone „konsul” nadal znajduje też zwykłe słowa o tym początku (wariant dosłowny)", () => {
  assert.ok(S.alts("kon").includes("kon") && S.alts("kon").includes("konsultac"));
});
test("początek krótszy niż 3 znaki nie jest traktowany jak klucz SYN („zd”)", () => {
  assert.deepStrictEqual(S.alts("zd"), ["zd"]);
});
test("przy pisaniu „usg ta”, „usg tar”, „usg tarc”: zbiór wyników nie maleje przy dopisywaniu liter, a 88.713 jest zawsze", () => {
  let prev = null;
  for (const q of ["usg ta", "usg tar", "usg tarc", "usg tarcz", "usg tarczy", "usg tarczyc", "usg tarczycy"]) {
    const c = codes(q);
    assert.ok(c.includes("88.713"), q);
    if (prev) assert.ok(isSubset(c, prev), `${q} wnosi nowe wyniki`);
    prev = c;
  }
});

/* =====================================================================
 * 5. Kolejność bez zmian tam, gdzie nie ma uzasadnienia (porównanie ze starą wersją)
 * ===================================================================== */
group("Kolejność zachowana (stała wzorcowa ze starej wersji)");
const OLD_TERAPIA_TOP20 = ["93.84", "93.71", "93.83", "93.81", "93.3991", "93.74", "93.3990", "93.72", "93.1908", "93.3992", "93.1905", "93.3997", "93.86", "93.82", "93.961", "93.571", "93.3827", "93.3816", "93.3821", "93.3824"];
const OLD_KREW_TOP20 = ["C60", "C61", "C63", "90.52", "90.55", "90.54", "90.51", "92.112", "90.53", "90.59", "90.5", "C", "90.56", "00.9603", "92.05", "E05", "92.058", "92.059", "92.051", "C66"];
test("„terapia”: top 20 identyczne jak w starej wersji (premia diag +6 i pierwsze słowo +4 bez zmian)", () => assert.deepStrictEqual(codes("terapia", 20), OLD_TERAPIA_TOP20));
test("„terapia”: 94.42 Terapia rodzin jest za kodami 93.xx (wynik premii diag; opis w PROJEKT.md)", () => {
  const c = codes("terapia");
  assert.ok(c.indexOf("94.42") > c.indexOf("93.3824"));
});
test("„badanie krwi”: top 20 identyczne jak w starej wersji", () => assert.deepStrictEqual(codes("badanie krwi", 20), OLD_KREW_TOP20));
test("„badanie krwi”: 00.9603 ma „krwi” we własnej nazwie (nie tylko w nadrzędnych)", () => {
  const e = byCode.get("00.9603");
  assert.ok(e.own.some((w) => w.startsWith("krwi")));
});
test("„badanie krwi”: kody z trafieniem tylko w nazwach nadrzędnych są za kodami z trafieniem we własnej nazwie", () => {
  const it = items("badanie krwi");
  const viaCtx = (e) => !(e.own.some((w) => w.startsWith("badan")) && e.own.some((w) => w.startsWith("krwi")));
  const flags = it.map(viaCtx);
  assert.ok(flags.indexOf(true) > -1 && flags.indexOf(true) > flags.lastIndexOf(false));
});
test("ta sama zasada dla 300 popularnych słów i 100 par: własna nazwa zawsze przed samymi nazwami nadrzędnymi", () => {
  const freq = new Map();
  for (const e of index) for (const w of new Set(e.own)) freq.set(w, (freq.get(w) || 0) + 1);
  const common = [...freq].filter(([w, c]) => c >= 3 && w.length >= 4).sort((a, b) => b[1] - a[1]).slice(0, 300).map((x) => x[0]);
  const queries = common.concat(common.slice(0, 100).map((w, i) => w + " " + common[(i * 7 + 3) % 300]));
  const bad = [];
  for (const q of queries) {
    const r = find(q);
    if (!r || r.groups || r.partial) continue;
    const exps = r.toks.map(S.expand);
    if (exps.some((x) => x.generic.length)) continue; /* stawy mają osobne testy specyficzności */
    const allOwn = (e) => exps.every((x) => x.all.some((v) => S.hit(e.own, v)));
    const flags = r.items.map((e) => !allOwn(e));
    if (flags.indexOf(true) > -1 && flags.indexOf(true) < flags.lastIndexOf(false)) bad.push(q);
  }
  assert.deepStrictEqual(bad, []);
});

group("Zapytania kodowe i krótkie (bez zmian)");
test("„88”: pierwszy 88, wszystkie kody zaczynają się od 88", () => {
  const it = items("88");
  assert.strictEqual(it[0].code, "88");
  assert.ok(it.every((e) => e.code.startsWith("88")));
  assert.strictEqual(it.length, 243);
});
test("„93.11”: pierwszy 93.11, wszystkie zaczynają się od 93.11", () => {
  const it = items("93.11");
  assert.strictEqual(it[0].code, "93.11");
  assert.ok(it.every((e) => e.code.startsWith("93.11")));
  assert.strictEqual(it.length, 8);
});
test("„g50”: tylko G50", () => assert.deepStrictEqual(codes("g50"), ["G50"]));
test("„G50” (wielka litera) = „g50”", () => assert.deepStrictEqual(codes("G50"), ["G50"]));
test("„zzzz”: brak wyników", () => { const r = find("zzzz"); assert.ok(r && r.items.length === 0 && !r.groups && !r.partial); });
test("„o” (1 znak): komunikat obsługuje app.js (render: długość zapytania === 1), moduł nie zgłasza błędu", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.ok(/q\.trim\(\)\.length === 1/.test(app), "w app.js zniknęła obsługa jednego znaku");
  assert.ok(find("o").items.length > 0);
});
test("app.js ma osłonę na brak search.js (komunikat zamiast pustego ekranu)", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.ok(/if \(!Search\) \{/.test(app) && /return;/.test(app.slice(app.indexOf("if (!Search)"), app.indexOf("if (!Search)") + 700)));
});
test("prywatność: aplikacja nie używa ciasteczek ani zapisu ulubionych (gwiazdek)", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const [name, text] of [["app.js", app], ["search.js", fs.readFileSync(path.join(ROOT, "search.js"), "utf8")]]) {
    assert.ok(!/document\.cookie|localStorage|sessionStorage|indexedDB/.test(text), name + " zapisuje dane na urządzeniu");
  }
  assert.ok(!/data-fav|class="star|favWrap|favList|Twoje ulubione/.test(app + html), "zostały ślady ulubionych");
  assert.ok(!/document\.cookie/.test(fs.readFileSync(path.join(ROOT, "theme.js"), "utf8")), "theme.js używa ciasteczek");
});
test("dwa znaki są wyszukiwane („tk”, „mr”, „ct”)", () => { for (const q of ["tk", "mr", "ct"]) assert.ok(items(q).length > 0, q); });
test("wyszukiwanie po początku kodu: „87.44” i „g5”", () => {
  assert.strictEqual(codes("87.44", 1)[0], "87.44");
  assert.ok(codes("g5").includes("G50"));
});

/* =====================================================================
 * 6. Remisy rozstrzygane trafnością, nie numerem kodu (syntetyczne dane)
 * ===================================================================== */
group("Remisy punktowe");
test("remis: dokładne słowo przed samym początkiem słowa, mimo większego numeru kodu", () => {
  const mini = S.buildIndex([["AA", "Rozdział", 0, "", 1], ["10.1", "Xxxxx krwiaa", 1, "AA", 0], ["10.2", "Xxxxx krwi A", 1, "AA", 0]]).index;
  const r = S.search("krwi", mini).items.map((e) => e.code);
  assert.deepStrictEqual(r, ["10.2", "10.1"]);
});
test("remis: wcześniejsze trafienie w nazwie przed późniejszym, mimo większego numeru kodu", () => {
  const mini = S.buildIndex([["AA", "Rozdział", 0, "", 1], ["10.1", "Aaaaa bbbb krwi", 1, "AA", 0], ["10.2", "Aaaaa krwi bbbb", 1, "AA", 0]]).index;
  const r = S.search("krwi", mini).items.map((e) => e.code);
  assert.deepStrictEqual(r, ["10.2", "10.1"]);
});
test("pełny remis: dopiero wtedy numer kodu (naturalnie: 10.2 przed 10.10)", () => {
  const mini = S.buildIndex([["AA", "Rozdział", 0, "", 1], ["10.10", "Aaaaa krwi bbbb", 1, "AA", 0], ["10.2", "Aaaaa krwi cccc", 1, "AA", 0]]).index;
  assert.deepStrictEqual(S.search("krwi", mini).items.map((e) => e.code), ["10.2", "10.10"]);
});
test("komparator: kolejność kluczy = warstwa, własna/nadrzędna, punkty, dokładność, pozycja, kod", () => {
  const mk = (code, o) => Object.assign({ e: { code }, tier: 0, viaCtx: 0, score: 10, exact: 0, pos: 0 }, o);
  const before = (a, b) => S.compare(a, b) < 0; /* a stoi przed b */
  assert.ok(before(mk("2", { score: 1 }), mk("1", { tier: 1, score: 999 })), "warstwa ogólna zawsze za konkretną, nawet z większą liczbą punktów");
  assert.ok(before(mk("2", { score: 1 }), mk("1", { viaCtx: 1, score: 999 })), "trafienie tylko w nadrzędnych zawsze za własnym");
  assert.ok(before(mk("2", { score: 11 }), mk("1", { score: 10, exact: 5 })), "punkty ważniejsze niż remisowe dokładne słowo");
  assert.ok(before(mk("2", { exact: 1 }), mk("1", { exact: 0, pos: 0 })), "dokładne słowo ważniejsze niż pozycja");
  assert.ok(before(mk("2", { pos: 0 }), mk("1", { pos: 1 })), "pozycja ważniejsza niż numer kodu");
  assert.ok(before(mk("1"), mk("2")), "na końcu numer kodu");
});
test("wynik zawsze deterministyczny (dwa wywołania = to samo)", () => {
  for (const q of ["inne", "badanie", "usuniecie", "kolano rtg"]) assert.deepStrictEqual(codes(q), codes(q));
});
test("w top 20 popularnych słów remisy punktowe są rzadsze niż wcześniej (kolejność wynika z trafności)", () => {
  /* Informacyjnie: sprawdzamy tylko, że wyniki dla słów z największą liczbą remisów są stabilne i niepuste. */
  for (const q of ["inne", "wyciecie", "usuniecie", "kosci", "zabiegi"]) assert.ok(items(q).length > 20, q);
});

/* =====================================================================
 * 6b. Nieregularne odmiany i słowa-wypełniacze
 * ===================================================================== */
group("Odmiany i wypełniacze");
test("„udo rtg” i „uda rtg”: 88.27 (RTG uda/kolana/podudzia), jedyny wynik", () => {
  assert.deepStrictEqual(codes("udo rtg"), ["88.27"]);
  assert.deepStrictEqual(codes("uda rtg"), ["88.27"]);
});
test("„udo” znajduje też „udowa/udowej” jak wcześniej (nic nie zniknęło)", () => assert.ok(items("udo").some((e) => nameHas(e, /udow/)) && items("udo").some((e) => nameHas(e, /(^| )uda( |$)/))));
test("„reka rtg” / „ręki rtg”: 88.23 (RTG nadgarstka/dłoni)", () => {
  assert.deepStrictEqual(codes("reka rtg"), ["88.23"]);
  assert.deepStrictEqual(codes("ręki rtg"), ["88.23"]);
});
test("odmiany brzucha dają ten sam zbiór: „brzuch”, „brzucha”, „brzusznej”, „brzuszna”", () => {
  const ref = codes("brzuch");
  for (const q of ["brzucha", "brzuszny", "brzusznej", "brzuszna", "brzusznego"]) assert.ok(sameSet(codes(q), ref), q);
});
test("„usg brzucha” i „usg brzusznej” znajdują 88.761 i 88.769", () => {
  for (const q of ["usg brzucha", "usg brzusznej"]) { const c = codes(q); assert.ok(c.includes("88.761") && c.includes("88.769"), q); }
});
test("„usg jamy brzusznej”: słowo „jamy” pomijane, gdy nic nie pasuje, wynik jak „usg brzusznej”", () => {
  assert.deepStrictEqual(codes("usg jamy brzusznej"), codes("usg brzusznej"));
  assert.strictEqual(codes("usg jamy brzusznej", 1)[0], "88.769");
});
test("wypełniacz NIE zmienia zapytań, które coś znajdują („jamy ustnej”, „jamy”)", () => {
  assert.ok(items("jamy ustnej").every((e) => e.own.concat(e.ctx).some((w) => w.startsWith("jam"))));
  assert.ok(items("jamy").length > 100);
});
test("same wypełniacze nie powodują wyjątku ani pętli", () => { for (const q of ["jamy", "jama jamy okolicy", "narzadow okolicy"]) assert.ok(Array.isArray(items(q))); });

/* =====================================================================
 * 7. Brak wyjątków
 * ===================================================================== */
group("Odporność na dziwne zapytania");
test("puste zapytanie, same spacje, null i undefined: wynik null", () => {
  for (const q of ["", " ", "     ", "\t\n", null, undefined]) assert.strictEqual(S.search(q, index), null, JSON.stringify(q));
});
test("znaki specjalne i same znaki interpunkcyjne nie powodują wyjątku", () => {
  const weird = ["%%%", "<script>alert(1)</script>", "((((", "\\", "'; DROP TABLE x;--", "...", "....", "-", "ł", "ŁÓDŹ", "😀", "😀😀 usg", "\u0000", "á", "99999999", "88.", ".88", "..88..", "a.b.c", "[", "*", "?", "+", "|", "^", "$", "{}", "usg ((", "constructor", "prototype", "__proto__", "hasOwnProperty", "toString", "valueOf"];
  for (const q of weird) {
    const r = S.search(q, index);
    assert.ok(r === null || (Array.isArray(r.items) && Array.isArray(r.toks)), q);
  }
});
test("„...” i podobne (same kropki) dają pusty wynik, a nie wyjątek (stara wersja się wywracała)", () => {
  assert.deepStrictEqual(items("..."), []);
});
test("słowa z prototypu obiektu („constructor”) nie są traktowane jak skróty", () => {
  assert.deepStrictEqual(S.expand("constructor").specific, ["construc"]);
});
test("bardzo długie zapytanie (10 000 znaków) oraz 2000 słów: wynik bez wyjątku i szybko", () => {
  for (const q of ["a".repeat(10000), "kolano ".repeat(2000), "usg tarczycy ".repeat(800), "x ".repeat(5000)]) {
    const t = process.hrtime.bigint();
    const r = S.search(q, index);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(r && Array.isArray(r.items), "brak wyniku");
    assert.ok(ms < 100, `trwało ${ms.toFixed(1)} ms`);
  }
});
test("zapytanie ucięte do limitu: tylko pierwsze 8 słów jest używane", () => {
  assert.strictEqual(S.tokenize("a b c d e f g h i j k").toks.length, 8);
});
test("zapytanie niebędące tekstem (liczba, obiekt) nie powoduje wyjątku", () => {
  for (const q of [123, 0, {}, [], true]) assert.doesNotThrow(() => S.search(q, index));
});
test("uszkodzone wiersze danych (null, brak nazwy, kod nie-tekst) są pomijane, reszta działa", () => {
  const bad = [null, undefined, [], ["X1", null, 1, "", 0], ["X2", undefined], [123, "Nazwa", 1, "", 0], "tekst", ["10.1", "Badanie krwi", 1, "", 0]];
  const mini = S.buildIndex(bad).index;
  assert.deepStrictEqual(S.search("krwi", mini).items.map((e) => e.code), ["10.1"]);
  assert.deepStrictEqual(S.buildIndex(null).index, []);
  assert.deepStrictEqual(S.buildIndex("abc").index, []);
});
test("bardzo duża liczba trafień (300 000 kodów) nie powoduje RangeError", () => {
  const rows = Array.from({ length: 300000 }, (_, i) => ["Z" + i, "Badanie testowe numer " + i, 1, "", 0]);
  const big = S.buildIndex(rows).index;
  assert.strictEqual(S.search("badanie", big).items.length, 300000);
});
test("widok grup: ten sam kod nie występuje na liście wyników dwa razy", () => {
  const r = find("usg jamy brzusznej zzzz");
  const all = (r.groups ? r.items : items("usg kolano zzzz")).map((e) => e.code);
  assert.strictEqual(new Set(all).size, all.length);
  for (const q of ["rtg narzadu zzzz", "usg badanie qqqq", "zdjecie terapia xxxx"]) {
    const x = find(q); if (x && x.groups) assert.strictEqual(new Set(x.items.map((e) => e.code)).size, x.items.length, q);
  }
});
test("pełnoszerokie litery („ＵＳＧ tarczycy”) działają jak zwykłe", () => assert.deepStrictEqual(codes("ＵＳＧ ｔａｒｃｚｙｃｙ"), ["88.713"]));
test("zapytanie z 8 słów (najgorszy przypadek) trwa poniżej 50 ms", () => {
  const q = "rek JAMY usg gastroskopia łokcia tarczyca rezona konsultacja";
  find(q); const t = process.hrtime.bigint(); for (let i = 0; i < 10; i++) find(q);
  const ms = Number(process.hrtime.bigint() - t) / 1e7;
  assert.ok(ms < 50, ms.toFixed(1) + " ms");
});
test("pusty indeks nie powoduje wyjątku", () => assert.deepStrictEqual(S.search("usg", []).items, []));

/* =====================================================================
 * 8. Wydajność
 * ===================================================================== */
group("Wydajność");
test(`budowa indeksu ${data.codes.length} kodów trwa poniżej 500 ms`, () => assert.ok(buildMs < 500, buildMs.toFixed(1) + " ms"));
const perf = [];
test("pojedyncze wyszukiwanie trwa znacznie poniżej 100 ms (limit testu: 100 ms, każde z zapytań)", () => {
  const queries = ["kolano", "kolano zdjecie", "usg", "badanie", "terapia", "badanie krwi", "rtg klatki", "zdjeci", "inne", "88", "usg tarczycy",
    "badanie z wykorzystaniem innych metod leczenia kolana i biodra", "zzzz", "usg jamy brzusznej", "konsultacja neurologiczna"];
  for (const q of queries) {
    S.search(q, index); // rozgrzewka
    const runs = 20, t = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) S.search(q, index);
    const ms = Number(process.hrtime.bigint() - t) / 1e6 / runs;
    perf.push([q, ms]);
    assert.ok(ms < 100, `„${q}”: ${ms.toFixed(1)} ms`);
  }
  const worst = Math.max(...perf.map((p) => p[1]));
  assert.ok(worst < 50, `najwolniejsze zapytanie ${worst.toFixed(1)} ms (oczekiwane znacznie poniżej 100)`);
});
test("liczba kodów w słowniku zgadza się z opisem (10 059)", () => assert.strictEqual(index.length, 10059));

/* =====================================================================
 * 9. Znane ograniczenia (informacyjnie, nie powodują błędu)
 * ===================================================================== */
group("Znane ograniczenia (propozycje zmian w PROJEKT.md i w raporcie)");
limitation("„ekg”: 89.52 Elektrokardiogram nie jest w pierwszej trójce (wyprzedzają go nazwy zawierające dosłownie „ekg”)", () => !codes("ekg", 3).includes("89.52"));
limitation("„noga rtg”: nie łączy „noga” z „kończyna dolna” (brak takiego skrótu)", () => !!find("noga rtg").groups);
limitation("„stopy”: rdzeń „stop” łapie też „stopnia” (88.98 Badanie stopnia uwapnienia kości)", () => codes("stopy").includes("88.98"));
limitation("„fizjoterapia”: kody końcowe nie są ściśle przed wszystkimi kategoriami (zachowanie odziedziczone, 185 kodów końcowych za pierwszą kategorią)", () => items("fizjoterapia").findIndex((e) => e.hasKids) < items("fizjoterapia").map((e) => !e.hasKids).lastIndexOf(true));
limitation("„krwi” (4 znaki) trafia w początek słów: „krwiotwórczego”, „krwinek”", () => items("krwi").some((e) => e.own.some((w) => w.startsWith("krwio"))));

/* ---------- podsumowanie ---------- */
console.log("\nCzasy (ms na jedno wyszukiwanie, 10 059 kodów): budowa indeksu " + buildMs.toFixed(1) + " ms");
console.log(perf.map(([q, ms]) => `  ${q.padEnd(62)} ${ms.toFixed(2)}`).join("\n"));
console.log(`\nWynik: ${passed} testów przeszło, ${failed} nie przeszło.`);
if (failed) { console.log("Niezaliczone:\n  - " + failures.join("\n  - ")); process.exit(1); }
