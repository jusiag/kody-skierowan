/* Testy wyszukiwania (bez przeglądarki).
 * Uruchomienie z głównego folderu projektu:   node tests/search.test.js
 * Odświeżenie zapisanej kolejności wzorców (TYLKO po świadomej zmianie rankingu):
 *                                             node tests/search.test.js --zapisz-wzorce
 */
"use strict";
const fs = require("fs");
const path = require("path");
const S = require(path.join(__dirname, "..", "search.js"));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "icd9.json"), "utf8"));
const IDX = S.createIndex(data);
const WZORCE_PLIK = path.join(__dirname, "wzorce.json");

let ok = 0, bad = 0;
function test(name, fn) {
  try { fn(); ok++; console.log("  OK    " + name); }
  catch (e) { bad++; console.log("  BŁĄD  " + name + "\n        " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const run = (q) => S.search(IDX, q);
const codes = (q, n) => { const r = run(q); return r ? r.items.slice(0, n || Infinity).map((e) => e.code) : null; };
const top = (q, n) => run(q).items.slice(0, n);
const show = (items) => items.map((e) => e.code + " " + e.name).join("\n        ");
const has = (e, re) => re.test(S.norm(e.name));

console.log("Słownik: wersja " + data.version + ", " + IDX.entries.length + " kodów\n");

/* ---------- Stawy: kolano ---------- */
console.log("Stawy");
const UPPER_RE = /konczyn\w* gorn/;
const LOWER_RE = /konczyn\w* doln/;
for (const q of ["kolano", "kolana", "kolano zdjecie", "zdjecie kolana", "kolano zdjęcie", "Kolano zdjecie"]) {
  test(`„${q}”: w top 20 brak kończyny górnej i „kolagen”`, () => {
    const t = top(q, 20);
    const badOnes = t.filter((e) => has(e, UPPER_RE) || has(e, /kolagen/));
    assert(!badOnes.length, "znalezione:\n        " + show(badOnes));
    assert(!codes(q).includes("G50"), "G50 (kolagen) w wynikach");
  });
}
for (const q of ["kolano zdjecie", "zdjecie kolana", "kolano zdjęcie", "kolana rtg"]) {
  test(`„${q}”: pierwszy 88.27`, () => assert(codes(q, 1)[0] === "88.27", "pierwszy: " + codes(q, 3)));
}
test("„bark rtg”: pierwszy 88.21, brak kończyny dolnej w top 20", () => {
  assert(codes("bark rtg", 1)[0] === "88.21", "pierwszy: " + codes("bark rtg", 3));
  const b = top("bark rtg", 20).filter((e) => has(e, LOWER_RE));
  assert(!b.length, show(b));
});
for (const q of ["lokiec usg", "łokieć usg", "usg łokcia", "usg lokcia"]) {
  test(`„${q}”: pierwszy 88.795`, () => assert(codes(q, 1)[0] === "88.795", "pierwszy: " + codes(q, 3)));
}

/* Reguła ogólna dla KAŻDEGO stawu (żeby błąd nie wrócił przy innym stawie):
 * w top 20 kod, który nie zawiera tego stawu, nie może nazywać innego stawu ani drugiej kończyny. */
const JOINT_QUERIES = {
  kolano: ["kolan"], biodro: ["biodr"], kostka: ["kostk"], skokowy: ["skokow"],
  bark: ["bark"], "łokieć": ["lokc", "lokie"], nadgarstek: ["nadgar"], "dłoń": ["dlon"]
};
const ALL_ROOTS = ["kolan", "biodr", "kostk", "skokow", "bark", "lokc", "lokie", "nadgar", "dlon"];
const LOWER_Q = new Set(["kolano", "biodro", "kostka", "skokowy"]);
for (const [jq, roots] of Object.entries(JOINT_QUERIES)) {
  for (const extra of ["", " rtg", " usg", " zdjecie", " rezonans"]) {
    const q = jq + extra;
    test(`„${q}”: brak innego stawu i drugiej kończyny w top 20 (gdy kod nie zawiera „${jq}”)`, () => {
      const r = run(q); if (!r || r.groups) return; /* grupy per słowo: zasada nie dotyczy */
      const wrong = r.items.slice(0, 20).filter((e) => {
        const w = S.words(e.name);
        if (w.some((x) => roots.some((rt) => x.startsWith(rt)))) return false; /* trafienie konkretne */
        const other = ALL_ROOTS.filter((rt) => !roots.includes(rt)).some((rt) => w.some((x) => x.startsWith(rt)));
        /* druga kończyna jest dozwolona tylko razem z właściwą („kończyn górnych lub dolnych”) */
        const side = LOWER_Q.has(jq) ? has(e, UPPER_RE) && !has(e, /doln/) : has(e, LOWER_RE) && !has(e, /gorn/);
        return other || side;
      });
      assert(!wrong.length, show(wrong));
    });
  }
}
test("Wariant ogólny nigdy nie wyprzedza konkretnego (kolano, bark, łokieć usg, biodro rtg)", () => {
  for (const q of ["kolano", "bark", "łokieć usg", "biodro rtg", "kolano zdjecie"]) {
    const xs = S.tokens(S.norm(q)).map(S.expand);
    let seenGeneric = false;
    for (const e of run(q).items) {
      const generic = xs.some((x) => { const m = S.matchToken(e, x); return m && m.generic; });
      if (generic) seenGeneric = true;
      else assert(!seenGeneric, `„${q}”: ${e.code} (konkretny) stoi za wynikiem ogólnym`);
    }
  }
});

/* ---------- Konkretne badania ---------- */
console.log("\nBadania");
test("„usg tarczycy”: tylko 88.713", () => assert(codes("usg tarczycy").join() === "88.713", codes("usg tarczycy").join()));
test("„rtg klatki”: pierwszy 87.440", () => assert(codes("rtg klatki", 1)[0] === "87.440", codes("rtg klatki", 3).join()));
test("„konsultacja kardiologiczna”: tylko 89.002", () => assert(codes("konsultacja kardiologiczna").join() === "89.002", codes("konsultacja kardiologiczna").join()));
test("„fizjoterapia”: pierwszy 89.0021", () => assert(codes("fizjoterapia", 1)[0] === "89.0021", codes("fizjoterapia", 3).join()));
test("„fizjoterapia”: w top 3 tylko kody końcowe (do skopiowania)", () => {
  const k = top("fizjoterapia", 3).filter((e) => e.hasKids);
  assert(!k.length, show(k));
});

/* ---------- Pisanie: niedokończone słowa ---------- */
console.log("\nPisanie");
test("„zdjec”, „zdjeci”, „zdjecie”, „zdjęcie”: te same wyniki w tej samej kolejności", () => {
  const ref = codes("zdjecie").join();
  for (const q of ["zdjec", "zdjeci", "zdjęcie", "ZDJĘCIE"]) assert(codes(q).join() === ref, `„${q}” różni się od „zdjecie”`);
});
test("Prefiks skrótu działa jak skrót (rezo = rezonans, ultra = ultrasonografia, rehab = rehabilitacja)", () => {
  assert(codes("rezo").join() === codes("rezonans").join(), "rezo");
  assert(codes("rezon kolana").join() === codes("rezonans kolana").join(), "rezon kolana");
  assert(codes("ultrasonog").join() === codes("ultrasonografia").join(), "ultrasonog");
  assert(codes("rehab").join() === codes("rehabilitacja").join(), "rehab");
});
test("Prefiks skrótu nie gubi innych słów (ren łapie też „renina”)", () => {
  assert(run("ren").items.some((e) => /renin/i.test(e.name)), "brak reniny dla „ren”");
});
test("Podświetlanie: alts(„zdjeci”) zawiera „rtg”", () => assert(S.alts("zdjeci").includes("rtg"), S.alts("zdjeci").join()));

/* ---------- Ranking: terapia, badanie krwi ---------- */
console.log("\nRanking");
test("„badanie krwi”: kody ze wszystkimi słowami we własnej nazwie stoją przed trafionymi przez nazwy nadrzędne", () => {
  const xs = S.tokens(S.norm("badanie krwi")).map(S.expand);
  let seenCtx = false;
  for (const e of run("badanie krwi").items) {
    const ownAll = xs.every((x) => { const m = S.matchToken(e, x); return m && m.own; });
    if (!ownAll) seenCtx = true; else assert(!seenCtx, e.code + " (pełne trafienie) stoi za trafieniem częściowym");
  }
});
test("„badanie krwi”: 00.9603 ma „krwi” we własnej nazwie (to nie trafienie z nazw nadrzędnych)", () => {
  const e = IDX.byCode.get("00.9603");
  assert(e.own.includes("krwi"), e.name);
});

/* ---------- Kody i krótkie zapytania ---------- */
console.log("\nKody i krótkie zapytania");
test("„88”: 88, 88.0, 88.1, 88.2… (kolejność numerów, jak dotąd), wszystkie zaczynają się od 88", () => {
  const c = codes("88"); assert(c.slice(0, 5).join() === "88,88.0,88.1,88.2,88.3" && c.every((x) => x.startsWith("88")), c.slice(0, 5).join());
});
test("„łokieć usg”: zostaje 88.793 „USG kończyn górnych lub dolnych” (obejmuje obie kończyny)", () => assert(codes("łokieć usg").includes("88.793"), codes("łokieć usg").join()));
test("„93.11”: 93.11, 93.119, 93.1121… (jak dotąd)", () => {
  const c = codes("93.11"); assert(c.slice(0, 4).join() === "93.11,93.119,93.1121,93.1122" && c.every((x) => x.startsWith("93.11")), c.slice(0, 5).join());
});
test("„g50” i „G50”: tylko G50", () => { assert(codes("g50").join() === "G50"); assert(codes("G50").join() === "G50"); });
test("„o” (1 znak): komunikat „wpisz co najmniej 2 znaki”", () => { assert(S.isTooShort("o") && S.isTooShort(" o ")); assert(!S.isTooShort("oo") && !S.isTooShort("")); });
test("„zzzz”: brak wyników", () => assert(run("zzzz").items.length === 0));
test("4 cyfry (kod resortowy, np. 1234): wyszukiwarka ICD-9 nie zgłasza błędu", () => assert(Array.isArray(run("1234").items)));
test("Grupy per słowo, gdy żaden kod nie ma wszystkich słów („usg kolagen”)", () => {
  const r = run("usg kolagen"); assert(r.groups && r.groups.length >= 1, JSON.stringify(r && r.groups && r.groups.map((g) => g.label)));
  assert(r.groups.every((g) => g.items.length <= 10), "grupa > 10");
});
test("Wyniki częściowe, gdy brak grup („tk zz”)", () => { const r = run("tk zz"); assert(r.partial && r.items.length > 0 && r.items.length <= 40, JSON.stringify(r && r.items.length)); });

/* ---------- Odporność ---------- */
console.log("\nOdporność i wydajność");
test("Brak wyjątków dla dziwnych zapytań", () => {
  const weird = ["", "   ", "\t\n", "!@#$%^&*()", "<script>alert(1)</script>", "...", ".", "-", "88.", "..88",
    "ąęśćżźńół", "ŁÓDŹ", "😀 usg", "a".repeat(5000), ("usg kolano ".repeat(400)), "0", "00", "z9", "1".repeat(50), null, undefined, 42];
  for (const q of weird) {
    const r = S.search(IDX, q);
    assert(r === null || Array.isArray(r.items), "zły wynik dla " + JSON.stringify(String(q).slice(0, 30)));
    S.isTooShort(q);
  }
  assert(S.search(IDX, "") === null && S.search(IDX, "   ") === null, "puste zapytanie powinno dać null");
});
test("Wydajność: pojedyncze wyszukiwanie znacznie poniżej 100 ms (mediana < 40 ms, maks. < 100 ms)", () => {
  const qs = ["kolano", "kolano zdjecie", "terapia", "badanie krwi", "usg", "88", "zdje", "fizjoterapia", "rtg klatki piersiowej", "a".repeat(500)];
  const times = [];
  for (const q of qs) for (let i = 0; i < 5; i++) { const t = process.hrtime.bigint(); run(q); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)], max = times[times.length - 1];
  console.log(`        czasy: mediana ${med.toFixed(1)} ms, maks. ${max.toFixed(1)} ms (${times.length} wyszukiwań)`);
  assert(med < 40 && max < 100, `mediana ${med.toFixed(1)} ms, maks. ${max.toFixed(1)} ms`);
});

/* ---------- Zapisana kolejność wzorców ----------
 * Każda zmiana kolejności top 10 dla tych zapytań musi być świadoma: test pokaże różnicę,
 * a po akceptacji odświeża się ją poleceniem z --zapisz-wzorce. */
const WZORCE = ["kolano", "kolana", "kolano zdjecie", "zdjecie kolana", "bark rtg", "lokiec usg", "łokieć usg", "usg tarczycy",
  "rtg klatki", "konsultacja kardiologiczna", "fizjoterapia", "zdjec", "zdjeci", "zdjecie", "terapia", "badanie krwi",
  "88", "93.11", "g50", "zzzz", "usg", "rtg", "tk glowy", "rezonans kolana", "ekg", "echo serca", "morfologia", "gastroskopia",
  "kolonoskopia", "usg jamy brzusznej", "rehabilitacja", "biodro", "nadgarstek", "kregoslup", "spirometria", "holter", "mammografia",
  "densytometria", "konsultacja", "porada"];
/* ---------- ICD-10 (rozpoznania) ---------- */
const data10 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "icd10.json"), "utf8"));
const IDX10 = S.createIndex(data10, { kind: "icd10" });
const run10 = (q) => S.search(IDX10, q);
const codes10 = (q, n) => { const r = run10(q); return r ? r.items.slice(0, n || Infinity).map((e) => e.code) : null; };
const pos10 = (q, code) => codes10(q).indexOf(code) + 1; /* 0 = brak */
const top10has = (q, code, n) => { const p = pos10(q, code); return p > 0 && p <= n; };

console.log("\nICD-10: dane");
test("Słownik ICD-10: 12 010 kodów, 22 rozdziały, bez powtórzeń i bez „sierot”", () => {
  const codesAll = data10.codes.map((c) => c[0]);
  assert(data10.count === 12010, "count = " + data10.count);
  assert(new Set(codesAll).size === codesAll.length, "powtórzone kody");
  assert(data10.codes.filter((c) => c[2] === 0).length === 22, "rozdziały");
  const set = new Set(codesAll);
  const orph = data10.codes.filter((c) => c[3] && !set.has(c[3])); assert(!orph.length, "bez rodzica: " + orph.slice(0, 3).map((c) => c[0]));
});
test("Kody ICD-10 mają poprawną postać (A00, A00.0; rozdziały/bloki A00–B99), bez † i * w kodzie", () => {
  const bad = data10.codes.filter((c) => !/^[A-Z]\d\d(\.\d)?$|^[A-Z]\d\d–[A-Z]\d\d$/.test(c[0]));
  assert(!bad.length, bad.slice(0, 5).map((c) => c[0]).join(", "));
});
test("Podkategorie ze schematu: E11.9 = „Cukrzyca insulinoniezależna – Bez powikłań”, E10.2 ma znak †", () => {
  const e = IDX10.byCode.get("E11.9"); assert(e && e.name === "Cukrzyca insulinoniezależna – Bez powikłań", e && e.name);
  assert(IDX10.byCode.get("E10.2").mark === "†", "E10.2 bez †");
  assert(IDX10.byCode.get("G63.2").mark === "*", "G63.2 bez *");
});
test("Bloki jednokodowe (B99, F99, C50, C97) występują raz, jako kategoria", () => {
  for (const c of ["B99", "F99", "C50", "C97"]) assert(data10.codes.filter((x) => x[0] === c).length === 1, c);
});
test("Kody kluczowe obecne: J45, I10, E11, U07.1, Z00.0, M54.5, J06.9, N39.0", () => {
  for (const c of ["J45", "I10", "E11", "U07.1", "Z00.0", "M54.5", "J06.9", "N39.0"]) assert(IDX10.byCode.has(c), c);
});

console.log("\nICD-10: wyszukiwanie");
test("„astma”: pierwsze wyniki to J45.x", () => assert(codes10("astma", 4).every((c) => c.startsWith("J45")), codes10("astma", 4).join()));
test("„J45”, „j45”: najpierw J45, potem J45.0 … (po numerze)", () => {
  assert(codes10("J45", 3).join() === "J45,J45.0,J45.1", codes10("J45", 3).join());
  assert(codes10("j45").join() === codes10("J45").join(), "wielkość liter");
});
test("„j45.0”, „J450”: J45.0 na pierwszym miejscu", () => {
  assert(codes10("j45.0", 1)[0] === "J45.0", codes10("j45.0", 2).join());
  assert(codes10("J450", 1)[0] === "J45.0", codes10("J450", 2).join());
});
test("„e119” i „E11.9”: tylko E11.9", () => { assert(codes10("e119").join() === "E11.9"); assert(codes10("E11.9").join() === "E11.9"); });
test("„cukrzyca typu 2” → E11.x, „cukrzyca typu 1” → E10.x (w top 5)", () => {
  assert(codes10("cukrzyca typu 2", 5).every((c) => c.startsWith("E11")), codes10("cukrzyca typu 2", 5).join());
  assert(codes10("cukrzyca typu 1", 5).every((c) => c.startsWith("E10")), codes10("cukrzyca typu 1", 5).join());
});
test("„nadciśnienie”: I10 pierwszy", () => assert(codes10("nadciśnienie", 1)[0] === "I10", codes10("nadciśnienie", 3).join()));
test("„hashimoto”: E06.3 (przez określenie włączone „Zapalenie tarczycy Hashimoto”)", () => {
  assert(codes10("hashimoto", 1)[0] === "E06.3", codes10("hashimoto", 3).join());
  const inc = S.matchedInclusions(IDX10.byCode.get("E06.3"), ["hashimoto"]); assert(inc.some((t) => /Hashimoto/.test(t)), inc.join());
});
test("Częste rozpoznania na górze: zakażenie układu moczowego → N39.0, infekcja górnych dróg oddechowych → J06.9, ból brzucha → R10", () => {
  assert(codes10("zakażenie układu moczowego", 1)[0] === "N39.0", codes10("zakażenie układu moczowego", 3).join());
  assert(codes10("infekcja górnych dróg oddechowych", 1)[0] === "J06.9", codes10("infekcja górnych dróg oddechowych", 3).join());
  assert(codes10("ból brzucha", 1)[0] === "R10", codes10("ból brzucha", 3).join());
});
test("Skróty: pochp → J44, angina → J03 w top 5, dyskopatia → M51 w top 5, covid → U07.1 pierwszy", () => {
  assert(top10has("pochp", "J44", 5) || codes10("pochp", 5).some((c) => c.startsWith("J44")), codes10("pochp", 5).join());
  assert(codes10("angina", 5).some((c) => c.startsWith("J03")), codes10("angina", 5).join());
  assert(codes10("dyskopatia", 5).some((c) => c.startsWith("M51")), codes10("dyskopatia", 5).join());
  assert(codes10("covid", 1)[0] === "U07.1", codes10("covid", 2).join());
});
test("Premia „częste” nie działa przy trafieniu tylko w określeniu włączonym („kolano” nie daje półpaśca B02.2 w top 5)", () => {
  assert(!codes10("kolano", 5).includes("B02.2"), codes10("kolano", 5).join());
  assert(codes10("kolano", 1)[0] === "M17", codes10("kolano", 3).join());
});
test("Zapytania o procedury nie dają pełnych trafień ICD-10 (sekcja rozpoznań się nie pokaże)", () => {
  for (const q of ["usg tarczycy", "rtg klatki", "konsultacja kardiologiczna", "fizjoterapia", "88", "93.11", "4308"]) {
    const r = run10(q); assert(!r || !r.items.length || r.groups || r.partial, q + ": " + (r && r.items.slice(0, 3).map((e) => e.code).join()));
  }
});
test("ICD-10: brak wyjątków dla dziwnych zapytań i szybkość (maks. < 100 ms)", () => {
  for (const q of ["", "  ", "!!!", "<b>", "a".repeat(3000), "j", "j4", "j45.", "Z", "ąę", null, 7]) { const r = S.search(IDX10, q); assert(r === null || Array.isArray(r.items), String(q)); }
  let max = 0;
  for (const q of ["astma", "zapalenie płuc", "kolano", "ból", "cukrzyca typu 2", "J45", "nadciśnienie tętnicze"]) {
    for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); run10(q); max = Math.max(max, Number(process.hrtime.bigint() - t) / 1e6); }
  }
  console.log(`        ICD-10 maks. czas: ${max.toFixed(1)} ms`);
  assert(max < 100, max.toFixed(1) + " ms");
});

/* Wzorce ICD-10 zapisywane w tym samym pliku, z przedrostkiem „ICD-10: ”. */
const WZORCE10 = ["astma", "nadciśnienie", "cukrzyca typu 2", "zapalenie płuc", "ból głowy", "depresja", "kolano", "J45", "E11",
  "hashimoto", "covid", "niedoczynność tarczycy", "zawał", "ból pleców", "ciąża", "badanie kontrolne"];

console.log("\nZapisana kolejność wzorców (top 10)");
if (process.argv.includes("--zapisz-wzorce")) {
  const snap = {}; for (const q of WZORCE) snap[q] = codes(q, 10);
  for (const q of WZORCE10) snap["ICD-10: " + q] = codes10(q, 10);
  fs.writeFileSync(WZORCE_PLIK, JSON.stringify(snap, null, 1) + "\n");
  console.log("  Zapisano " + (WZORCE.length + WZORCE10.length) + " wzorców do tests/wzorce.json");
} else if (fs.existsSync(WZORCE_PLIK)) {
  const snap = JSON.parse(fs.readFileSync(WZORCE_PLIK, "utf8"));
  const cmp = (label, now, was) => test(`„${label}”: kolejność jak zapisana`, () => {
    assert(was, "brak wzorca: uruchom z --zapisz-wzorce");
    assert(now.join() === was.join(), "\n        było:  " + was.join(", ") + "\n        jest:  " + now.join(", "));
  });
  for (const q of WZORCE) cmp(q, codes(q, 10), snap[q]);
  for (const q of WZORCE10) cmp("ICD-10: " + q, codes10(q, 10), snap["ICD-10: " + q]);
} else console.log("  Brak tests/wzorce.json (uruchom z --zapisz-wzorce)");

console.log(`\nWynik: ${ok} OK, ${bad} BŁĄD`);
process.exit(bad ? 1 : 0);
