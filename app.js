(() => {
  "use strict";
  /* Wyszukiwanie jest w osobnym pliku search.js (KodySearch). Tu zostaje widok.
   * Dwa słowniki: ICD-9 (procedury, NFZ) i ICD-10 (rozpoznania, Centrum e-Zdrowia). Każdy ma własny indeks,
   * a wiersze na stronie niosą atrybut data-ds="9" albo "10", żeby kliknięcia trafiały do właściwego słownika. */
  const KS = window.KodySearch;
  const $ = (id) => document.getElementById(id);

  let META = null;
  try { META = JSON.parse(document.getElementById("nfzmeta").textContent) || null; if (META && !META.version) META = null; } catch { META = null; }

  /* Słowniki. valid() chroni przed uszkodzonym albo niepełnym plikiem. */
  const DS = {
    9: {
      key: "9", kind: "icd9", url: "data/icd9.json", cache: "icd9-data", data: null, idx: null, notesLabel: "Uwagi NFZ",
      valid: (d) => !!(d && Array.isArray(d.codes) && d.codes.length > 5000 && d.codes.some((c) => c[0] === "89.00")),
      serverVersion: () => (META && META.version) || null
    },
    10: {
      key: "10", kind: "icd10", url: "data/icd10.json", cache: "icd10-data", data: null, idx: null, notesLabel: "Obejmuje i uwagi",
      valid: (d) => !!(d && Array.isArray(d.codes) && d.codes.length > 10000 && d.codes.some((c) => c[0] === "J45")),
      serverVersion: () => (META && META.icd10 && META.icd10.version) || null
    }
  };
  const D9 = DS[9], D10 = DS[10];
  const dsOf = (el) => DS[(el && el.closest("[data-ds]") && el.closest("[data-ds]").dataset.ds) || "9"];

  const norm = KS.norm;
  const vparts = (v) => String(v || "0").split(/[._]/).map((n) => parseInt(n, 10) || 0);
  const vcmp = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function load(ds, data) {
    ds.data = data;
    ds.idx = KS.createIndex(data, { kind: ds.kind });
    if (ds === D9) { buildCats(D9, "catList", "catCount", "catToggle", "catTop"); buildResCat(); $("loadMsg").hidden = true; }
    else { buildCats(D10, "cat10List", "cat10Count", "cat10Toggle", "cat10Top"); $("cat10").hidden = false; }
    updateInfo(); render();
  }

  const altsFor = (ds) => (ds === D10 ? KS.alts10 : KS.alts);

  function highlight(name, toks, ds) {
    if (!toks || !toks.length) return esc(name);
    const alts = altsFor(ds || D9);
    const parts = name.split(/(\s+|[-,()\/])/);
    return parts.map((p) => {
      const w = norm(p);
      if (w && toks.some((t) => alts(t).some((a) => a.length > 1 ? w.startsWith(a) : w === a))) return "<mark>" + esc(p) + "</mark>";
      return esc(p);
    }).join("");
  }

  /* Kopiować można tylko kody końcowe. Kategoria ogólna (ma kody szczegółowe) jest tylko etykietą.
   * Znak † lub * (ICD-10) jest pokazany przy kodzie, ale nie jest kopiowany: nie należy do kodu. */
  const COPY_ICON = '<svg class="ci" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><svg class="ck" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const markHTML = (mark) => (mark ? `<span class="mk" title="${mark === "†" ? "Kod przyczynowy (sztylet)" : "Kod objawowy (gwiazdka)"}">${esc(mark)}</span>` : "");
  const copyBtn = (code, mark) => `<button class="code" type="button" data-copy="${esc(code)}" title="Kopiuj kod" aria-label="Kopiuj kod ${esc(code)}"><span class="ct">${esc(code)}</span>${markHTML(mark)}${COPY_ICON}</button>`;
  const codeBtn = (e, final) => final
    ? copyBtn(e.code, e.mark)
    : `<span class="code nocopy" title="Kategoria ogólna: wybierz kod szczegółowy">${esc(e.code)}${markHTML(e.mark)}</span>`;

  function rowHTML(ds, e, toks, compact) {
    const n = ds.data.notes[e.code];
    const nk = ds.idx.kids.get(e.code)?.length || 0;
    /* W ICD-10 pomijamy rozdział (długa nazwa); blok i kategoria wystarczą, rozdział widać w drzewie. */
    const chain = ds === D10 && e.chain.length > 1 ? e.chain.slice(1) : e.chain;
    const path = compact ? "" : chain.map((c) => `<button type="button" data-browse="${esc(c.code)}">${esc(c.code)} ${esc(c.name)}</button>`).join(" › ");
    const inc = ds === D10 && toks ? KS.matchedInclusions(e, toks, 2) : [];
    const incHTML = inc.length ? `<span class="incl">Obejmuje: ${inc.map((t) => highlight(t, toks, ds)).join("; ")}</span>` : "";
    const meta = [];
    if (nk) meta.push(`<button type="button" data-kids="${esc(e.code)}" aria-expanded="false">Rozwiń: Kody szczegółowe (${nk})</button>`);
    if (n) meta.push(`<button type="button" data-notes="${esc(e.code)}" aria-expanded="false">${esc(ds.notesLabel)}</button>`);
    if (nk && !compact) meta.push(`<span class="tag">kategoria ogólna</span>`);
    return `<div class="row" data-ds="${ds.key}" data-code="${esc(e.code)}">
      ${codeBtn(e, !nk)}
      <div class="body"><span class="name">${highlight(e.name, toks, ds)}</span>${incHTML}${path ? `<span class="path">${path}</span>` : ""}${meta.length ? `<span class="meta">${meta.join("")}</span>` : ""}</div>
    </div>`;
  }

  /* Drzewo kategorii: rozdział > blok/podrozdział > kategoria > kod szczegółowy. Dzieci tworzone dopiero po rozwinięciu. */
  function nodeHTML(ds, e) {
    const n = ds.idx.kids.get(e.code)?.length || 0;
    if (!n) return rowHTML(ds, e, null, true);
    return `<div class="node" data-ds="${ds.key}"><div class="nhead">${codeBtn(e, false)}<button class="nname" type="button" data-toggle="${esc(e.code)}" aria-expanded="false"><span class="chev" aria-hidden="true">▸</span><span class="nt">${esc(e.name)}</span><span class="cnt">${n}</span></button></div><div class="nkids" hidden></div></div>`;
  }
  function buildCats(ds, listId, countId, toggleId, topId) {
    const top = ds.idx.entries.filter((e) => e.lvl === 0);
    $(countId).textContent = top.length;
    $(listId).innerHTML = top.map((e) => nodeHTML(ds, e)).join("");
    $(listId).hidden = $(toggleId).getAttribute("aria-expanded") !== "true"; $(topId).hidden = $(listId).hidden;
  }

  /* ---------- kody resortowe (część VIII systemu), osobno od kodów procedur ---------- */
  const RES = window.RESORT && Array.isArray(window.RESORT.codes) ? window.RESORT : null;
  const resIdx = RES ? RES.codes.map((c) => ({ code: c[0], name: c[1], sec: RES.sections[c[2]] || "", n: norm(c[1]).split(" ") })) : [];
  const RALIAS = { fizjoter: "rehabilit", fizykoter: "rehabilit", kardio: "kardiolog" };
  function resRow(r, toks) {
    return `<div class="row rrow">${copyBtn(r.code)}<div class="body"><span class="name">${highlight(r.name, toks || null)}</span><span class="path">${esc(r.sec)}${r.derived ? " · kod wyliczony wg § 9 ust. 4 rozporządzenia: komórka dla dzieci = kod dla dorosłych (" + esc(r.derived) + ") + 1" : ""}</span></div></div>`;
  }
  function resSearch(q) {
    if (!RES) return [];
    const qn = norm(q); if (!qn) return [];
    if (/^\d{4}$/.test(qn)) {
      const f = resIdx.filter((r) => r.code === qn);
      if (f.length || Number(qn) % 2 === 0) return f;
      /* § 9 ust. 4 rozporządzenia: komórka dla dzieci ma kod nieparzysty, o 1 wyższy niż kod dla dorosłych */
      const base = resIdx.find((r) => r.code === String(Number(qn) - 1));
      return base ? [{ code: qn, name: base.name + " (dla dzieci)", sec: base.sec, n: [], derived: base.code }] : [];
    }
    if (/^\d{2,3}$/.test(qn)) return resIdx.filter((r) => r.code.startsWith(qn));
    if (/\d/.test(qn)) return [];
    const toks = qn.split(" ").filter((t) => t.length >= 2 && !/^(kod|kody|resortow\w*)$/.test(t));
    if (!toks.length) return /resort/.test(qn) ? resIdx : [];
    const stem = (t) => (t.length >= 8 ? t.slice(0, t.length - 3) : t.length >= 5 ? t.slice(0, Math.max(4, t.length - 2)) : t);
    const alt = toks.map((t) => { for (const k in RALIAS) if (t.startsWith(k)) return [stem(t), RALIAS[k]]; return [stem(t)]; });
    return resIdx.filter((r) => alt.every((a2) => a2.some((x) => r.n.some((w) => w.startsWith(x))))).slice(0, 60);
  }
  const RES_AGE_WARN_DAYS = 3;
  const ELI_LINK = '<a href="https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20120000594" target="_blank" rel="noopener">ISAP: rozporządzenie z 2012 r. (zakładka „Akty zmieniające”)</a> · <a href="https://eli.gov.pl/api/acts/DU/2019/173/text.html" target="_blank" rel="noopener">tekst jednolity z 2019 r.</a> · <a href="https://www.nfz.gov.pl/aktualnosci/aktualnosci-centrali/rozszerzenie-listy-specjalnosci-z-rehabilitacji-w-warunkach-stacjonarnych-sprawozdawanych-w-aplikacji-ap-kolce,8682.html" target="_blank" rel="noopener">komunikat NFZ (AP-KOLCE)</a>';
  /* Źródło kodów resortowych: jedna notka pod wynikami, drobnym tekstem, bez ramki (tak jak przy ICD-10 i ICD-9). */
  const RES_SRC = 'Kody komórki organizacyjnej (poradni, oddziału), nie kody procedur. Rozporządzenie Ministra Zdrowia z 17.05.2012 r. w sprawie systemu resortowych kodów identyfikacyjnych, załącznik nr 2, część VIII (tekst jednolity: Dz. U. 2019 poz. 173; jedyna późniejsza zmiana, z 2017 r., jest w nim uwzględniona). Kod dla dzieci = kod dla dorosłych + 1 (§ 9 ust. 4).';
  /* Informacja o aktualności: dane z automatu (META.resort) albo, gdy ich brak, data ręcznego sprawdzenia. */
  function resStatus() {
    const r = META && META.resort;
    if (!r || !r.checkedAt) return "Tabela sprawdzona ręcznie w ISAP dnia 26.10.2026: brak aktów zmieniających nowszych niż z 2017 r.";
    let t = "Automat sprawdził w Dzienniku Ustaw (API Sejmu) dnia " + fmtStamp(r.checkedAt) + ": brak aktów zmieniających poza tym z 2017 r.";
    const age = (Date.now() - new Date(r.checkedAt).getTime()) / 86400000;
    if (age > RES_AGE_WARN_DAYS) t += " Uwaga: od " + Math.floor(age) + " dni nie ma świeższego sprawdzenia, sprawdź sam w ISAP.";
    return t;
  }
  const resNote = () => '<div class="resnote"><b>Źródło.</b> ' + esc(RES_SRC) + ' <b>Aktualność.</b> ' + esc(resStatus()) + ' NFZ podaje własne rozszerzenia w komunikatach (np. AP-KOLCE). Kod zawsze dobiera i potwierdza lekarz.<br>' + ELI_LINK + '</div>';
  let resLimit = 8;
  function resortBlock(q) {
    const found = resSearch(q.trim());
    if (!found.length) return "";
    const toks = norm(q).split(" ");
    const shown = found.slice(0, resLimit);
    const more = found.length > resLimit ? `<div class="tobar"><button class="btn ghost" type="button" data-resmore>Pokaż wszystkie kody resortowe (${found.length - resLimit} więcej)</button></div>` : "";
    return secHead("resort", "Kody resortowe (poradnie, oddziały; nie procedury)", found.length)
      + secBody("resort", `<div class="list" style="margin-top:12px">${shown.map((r) => resRow(r, toks)).join("")}</div>${more}${resNote()}`) + '<div class="sep"></div>';
  }
  function buildResCat() {
    if (!RES || !$("resList")) return;
    $("resCat").hidden = false;
    $("resCount2").textContent = RES.codes.length;
    $("resList").innerHTML = RES.sections.map((s, i) => `<div class="grp">${esc(s)}</div>` + resIdx.filter((r, k) => RES.codes[k][2] === i).map((r) => resRow(r)).join("")).join("") + resNote();
  }

  /* ---------- rozpoznania ICD-10: sekcja nad kodami resortowymi i procedurami ---------- */
  const ICD10_FIRST = 5; /* tyle rozpoznań widać od razu; resztę po „Pokaż więcej” */
  let limit10 = ICD10_FIRST;
  const src10Note = () => '<div class="resnote"><b>Źródło.</b> Polska wersja klasyfikacji ICD-10 (WHO), wydawca: Centrum e-Zdrowia'
    + (D10.data ? ", " + esc(D10.data.version) : "") + '. Znaki † i * stoją przy kodzie, ale nie są kopiowane. Kod zawsze dobiera i potwierdza lekarz.</div>';
  /* Sekcję pokazujemy tylko wtedy, gdy rozpoznanie pasuje do WSZYSTKICH słów. Kody „do pojedynczych słów”
   * i „najbliższe” byłyby tu szumem nad właściwą procedurą (np. „usg tarczycy” → 88.713). */
  function icd10Block(q) {
    if (!D10.idx) return "";
    const r = KS.search(D10.idx, q);
    if (!r || !r.items.length || r.groups || r.partial) return "";
    const title = "Rozpoznania ICD-10 (choroby, nie procedury)";
    const body = r.items.slice(0, limit10).map((e) => rowHTML(D10, e, r.toks)).join("");
    const left = r.items.length - limit10;
    const more = left > 0 ? `<div class="tobar"><button class="btn ghost" type="button" data-more10>Pokaż więcej rozpoznań (${left})</button></div>` : "";
    return secHead("icd10", title, r.items.length.toLocaleString("pl-PL"))
      + secBody("icd10", `<div class="list" style="margin-top:12px">${body}</div>${more}${src10Note()}`) + '<div class="sep"></div>';
  }

  /* ---------- zwijanie sekcji wyników ----------
   * Stan trzymany tylko w pamięci strony: zwinięta sekcja zostaje zwinięta przy kolejnych hasłach,
   * a po ponownym otwarciu aplikacji wszystko jest znów rozwinięte. Nic nie zapisujemy w telefonie. */
  const collapsed = { icd10: false, resort: false, icd9: false };
  const secHead = (sec, title, count) => {
    const c = collapsed[sec];
    return `<button class="sechead" type="button" data-sec="${sec}" aria-expanded="${!c}"><span class="st">${title}</span><span class="cnt">${count}</span><span class="tgl">${c ? "Rozwiń" : "Zwiń"}</span></button>`;
  };
  const secBody = (sec, html) => `<div class="secbody" data-secbody="${sec}"${collapsed[sec] ? " hidden" : ""}>${html}</div>`;
  function setHead(btn, open) {
    btn.setAttribute("aria-expanded", String(open));
    btn.querySelector(".tgl").textContent = open ? "Zwiń" : "Rozwiń";
  }
  /* Nagłówek procedur ICD-9 jest w index.html. Zwijany tylko wtedy, gdy nad nim są inne sekcje;
   * w trybie przeglądania kategorii i przy komunikacie „wpisz 2 znaki” jest zwykłym napisem. */
  function setSec9(collapsible) {
    const h = $("sec9head");
    h.classList.toggle("static", !collapsible);
    h.disabled = !collapsible;
    const open = !collapsible || !collapsed.icd9;
    setHead(h, open);
    $("sec9body").hidden = !open;
  }
  function toggleSec(btn) {
    const sec = btn.dataset.sec;
    collapsed[sec] = !collapsed[sec];
    const open = !collapsed[sec];
    setHead(btn, open);
    const body = sec === "icd9" ? $("sec9body") : document.querySelector(`[data-secbody="${sec}"]`);
    if (body) body.hidden = !open;
  }

  let limit = 60;
  function render() {
    if (!D9.data) return;
    const q = $("q").value;
    $("clear").hidden = !q;
    const short = KS.isTooShort(q);
    const res = short ? { toks: [], items: [], short: true } : KS.search(D9.idx, q);
    $("catWrap").hidden = !!res;
    $("resWrap").hidden = !res;
    $("icd10Out").innerHTML = ""; $("resortOut").innerHTML = ""; $("resBack").innerHTML = "";
    if (!res) return;
    const items = res.items;
    if (!res.short) { $("icd10Out").innerHTML = icd10Block(q); $("resortOut").innerHTML = resortBlock(q); }
    const above = !!($("resortOut").innerHTML || $("icd10Out").innerHTML);
    const pre = above ? "Procedury ICD-9: " : "";
    setSec9(above && !res.short);
    if (res.short) {
      $("resTitle").textContent = "Wpisz co najmniej 2 znaki";
      $("resCount").textContent = "";
      $("results").innerHTML = '<div class="empty">Jedna litera pasuje do zbyt wielu kodów. Wpisz słowo, np. „usg”, „astma”, „kolano” albo początek kodu, np. „88” lub „J45”.</div>';
      return;
    }
    $("resTitle").textContent = pre + (res.partial ? "Brak dokładnego kodu. Najbliższe kody ogólne" : items.length ? "Wyniki" : "Brak wyników");
    $("resCount").textContent = items.length.toLocaleString("pl-PL");
    if (res.groups) {
      $("resTitle").textContent = pre + "Brak kodu ze wszystkimi słowami. Kody pasujące do pojedynczych słów";
      $("results").innerHTML = res.groups.map((g) => `<div class="grp">Pasuje do „${esc(g.label)}”</div>` + g.items.map((e) => rowHTML(D9, e, [g.label])).join("")).join("")
        + `<div class="empty">Żaden kod w słowniku nie opisuje dokładnie „${esc(q.trim())}”. Wybierz najbliższy albo wpisz jedno słowo. Kod zawsze dobiera lekarz.</div><div class="tobar"><button class="btn ghost" type="button" data-top>↑ Na górę</button></div>`;
      return;
    }
    const shown = items.slice(0, limit);
    $("results").innerHTML = shown.length
      ? shown.map((e) => rowHTML(D9, e, res.toks)).join("") + `<div class="tobar">${items.length > limit ? `<button class="btn ghost" type="button" data-more>Pokaż więcej (${items.length - limit})</button>` : ""}<button class="btn ghost" type="button" data-top>↑ Na górę</button></div>`
      : /^\d{4}$/.test(q.trim())
        ? `<div class="empty">${resSearch(q.trim()).length ? "Numeru „"+esc(q.trim())+"” nie ma wśród kodów procedur ICD-9 PL. To kod resortowy, patrz wyżej." : "Numeru „"+esc(q.trim())+"” nie ma w słowniku ICD-9 PL ani w tabeli kodów resortowych. Kody procedur wyglądają np. tak: 93.11 albo 89.00. Spróbuj wpisać nazwę badania lub zabiegu."}</div>`
        : $("icd10Out").innerHTML
          ? `<div class="empty">Brak procedur ICD-9 dla „${esc(q.trim())}”. Rozpoznania ICD-10 są wyżej.</div>`
          : `<div class="empty">Nic nie znaleziono dla „${esc(q)}”. Spróbuj krótszego słowa, np. „tarczyc” albo „kolan”, lub wpisz początek kodu.</div>`;
  }

  function browse(ds, code) {
    const e = ds.idx.byCode.get(code); if (!e) return;
    $("q").value = ""; $("clear").hidden = true;
    $("catWrap").hidden = true; $("resWrap").hidden = false;
    $("icd10Out").innerHTML = ""; $("resortOut").innerHTML = "";
    setSec9(false);
    $("resTitle").textContent = (ds === D10 ? "ICD-10: " : "") + e.code + " " + e.name;
    const list = (ds.idx.kids.get(code) || []).map((c) => ds.idx.byCode.get(c));
    $("resCount").textContent = "";
    $("resBack").innerHTML = '<button type="button" class="linkbtn" data-back>Wróć do listy kategorii</button>';
    $("results").innerHTML = rowHTML(ds, e, null) + list.map((k) => rowHTML(ds, k, null, true)).join("") + `<div class="tobar"><button class="btn ghost" type="button" data-top>↑ Na górę</button></div>`;
    window.scrollTo({ top: 0 });
  }

  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 1600); }
  async function copy(code, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; } catch {}
    if (!ok) {
      const r = document.createRange(); r.selectNodeContents(btn.querySelector(".ct") || btn); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      try { ok = document.execCommand("copy"); } catch {}
    }
    btn.classList.add("copied"); setTimeout(() => btn.classList.remove("copied"), 900);
    toast(ok ? "Skopiowano " + code : "Kod zaznaczony, skopiuj go ręcznie");
  }

  function toggleSection(b, listId, topId) {
    const open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open)); $(listId).hidden = open; $(topId).hidden = open;
  }

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button,a"); if (!b) return;
    if (b.dataset.copy) return copy(b.dataset.copy, b);
    if (b.dataset.sec) return toggleSec(b);
    if ("top" in b.dataset) return window.scrollTo({ top: 0, behavior: "smooth" });
    if (b.dataset.browse) return browse(dsOf(b), b.dataset.browse);
    if ("back" in b.dataset) return render();
    if (b.id === "resToggle") return toggleSection(b, "resList", "resTop");
    if (b.id === "catToggle") return toggleSection(b, "catList", "catTop");
    if (b.id === "cat10Toggle") return toggleSection(b, "cat10List", "cat10Top");
    if (b.dataset.toggle) {
      const ds = dsOf(b);
      const box = b.closest(".node").querySelector(":scope > .nkids");
      if (b.getAttribute("aria-expanded") === "true") { box.hidden = true; b.setAttribute("aria-expanded", "false"); return; }
      if (!box.dataset.filled) { box.innerHTML = ds.idx.kids.get(b.dataset.toggle).map((c) => nodeHTML(ds, ds.idx.byCode.get(c))).join(""); box.dataset.filled = "1"; }
      box.hidden = false; b.setAttribute("aria-expanded", "true");
      return;
    }
    if ("more" in b.dataset) { limit += 60; return render(); }
    if ("more10" in b.dataset) { limit10 += 40; return render(); }
    if ("resmore" in b.dataset) { resLimit = 1000; return render(); }
    if (b.dataset.kids || b.dataset.notes) {
      const ds = dsOf(b);
      const row = b.closest(".row"); const kind = b.dataset.kids ? "kids" : "notes";
      const host = kind === "kids" ? row : row.querySelector(".body");
      const setLabel = (open) => { if (kind === "kids") b.textContent = b.textContent.replace(/^(Rozwiń|Zwiń):/, open ? "Zwiń:" : "Rozwiń:"); };
      const existing = host.querySelector(":scope > ." + kind);
      if (existing) { existing.remove(); b.setAttribute("aria-expanded", "false"); setLabel(false); return; }
      b.setAttribute("aria-expanded", "true"); setLabel(true);
      const el = document.createElement("div");
      if (kind === "kids") {
        el.className = "kids";
        el.innerHTML = ds.idx.kids.get(b.dataset.kids).map((c) => rowHTML(ds, ds.idx.byCode.get(c), null, true)).join("");
        row.appendChild(el);
      } else {
        const n = ds.data.notes[b.dataset.notes]; el.className = "notes";
        el.innerHTML = [["i", "Obejmuje"], ["x", "Nie obejmuje"], ["u", "Uwagi"]].filter(([k]) => n[k]).map(([k, l]) => `<div><b>${l}:</b> ${n[k].map(esc).join("; ")}</div>`).join("");
        row.querySelector(".body").appendChild(el);
      }
    }
  });

  let qt;
  $("q").addEventListener("input", () => { clearTimeout(qt); limit = 60; limit10 = ICD10_FIRST; resLimit = 8; qt = setTimeout(render, 120); });
  $("clear").addEventListener("click", () => { $("q").value = ""; render(); $("q").focus(); });

  /* ---------- dane, aktualizacje, offline ---------- */
  const dataUrl = (ds) => new URL(ds.url, location.href).href;
  async function cachedData(ds) {
    try { const c = await caches.open(ds.cache); const r = await c.match(dataUrl(ds)); if (r) return await r.json(); } catch {}
    return null;
  }
  async function saveData(ds, res) { try { const c = await caches.open(ds.cache); await c.put(dataUrl(ds), res); } catch {} }

  const TZ = "Europe/Warsaw";
  const fmtStamp = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pl-PL", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }) + ", godz. " + d.toLocaleTimeString("pl-PL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  };
  /* Tekst informacyjny. Dane o sprawdzeniu są wpisane w stronę przy publikacji (automat robi to codziennie),
     więc aplikacja nie wysyła żadnych dodatkowych zapytań o aktualność. */
  function updateInfo() {
    const cur = D9.data && D9.data.version;
    $("srcVer").textContent = cur ? "Użyta wersja: " + cur + " (" + D9.data.codes.length.toLocaleString("pl-PL") + " kodów)." : "";
    if (cur) $("src9note").innerHTML = "<b>Źródło.</b> Słownik ICD-9 PL CM, Narodowy Fundusz Zdrowia, wersja " + esc(cur) + ". Kod zawsze dobiera i potwierdza lekarz.";
    if (D10.data) $("src10Ver").textContent = "Użyta wersja: " + D10.data.version + " (" + D10.data.count.toLocaleString("pl-PL") + " kodów rozpoznań).";
    const m10 = META && META.icd10;
    if (m10 && m10.checkedAt) {
      let t = "Automat sprawdził w portalu dane.gov.pl dnia " + fmtStamp(m10.checkedAt) + ".";
      const age = (Date.now() - new Date(m10.checkedAt).getTime()) / 86400000;
      if (age > 3) t += " Uwaga: od " + Math.floor(age) + " dni nie ma świeższego sprawdzenia.";
      $("check10Info").textContent = t;
    }
    if (!META || !META.checkedAt) { $("checkInfo").textContent = ""; return; }
    let t = "Baza sprawdzona: " + fmtStamp(META.checkedAt) + ".";
    if (META.latestFile) t += " Ostatnia nazwa pliku na stronie NFZ: " + META.latestFile + ".";
    const age = (Date.now() - new Date(META.checkedAt).getTime()) / 86400000;
    if (age > 3) t += " Uwaga: od " + Math.floor(age) + " dni nie ma świeższego sprawdzenia (otwórz stronę z internetem).";
    $("checkInfo").textContent = t;
  }
  function updateResInfo() { if ($("resInfo")) $("resInfo").textContent = resStatus(); }

  /* Wczytanie słownika: najpierw kopia z urządzenia; z serwera tylko wtedy, gdy kopii brak albo serwer ma inną (nowszą) wersję. */
  async function fetchData(ds, bust) {
    try {
      const r = await fetch(dataUrl(ds) + (bust ? "?v=" + encodeURIComponent(bust) : ""), { cache: bust ? "reload" : "no-cache" });
      if (r.ok) { const copy = r.clone(); const d = await r.json(); if (ds.valid(d)) { await saveData(ds, copy); return d; } }
    } catch {}
    return null;
  }
  async function loadDs(ds) {
    let data = await cachedData(ds), updated = false;
    const sv = ds.serverVersion();
    if (!ds.valid(data)) data = await fetchData(ds, null);
    else if (sv && (ds === D9 ? vcmp(sv, data.version) > 0 : sv !== data.version)) {
      /* Nowa wersja na serwerze: pobierana cicho, tylko wtedy, gdy rzeczywiście jest inna. */
      const d = await fetchData(ds, sv); if (d) { data = d; updated = true; }
    }
    return { data, updated };
  }

  async function boot() {
    const r9 = await loadDs(D9);
    if (r9.data) load(D9, r9.data);
    else $("loadMsg").textContent = "Nie udało się wczytać słownika. Połącz się z internetem i odśwież stronę.";
    if (r9.updated) toast("Zaktualizowano kody do wersji " + r9.data.version);
    updateInfo(); updateResInfo();
    /* ICD-10 wczytujemy po ICD-9: brak ICD-10 nie blokuje reszty aplikacji. */
    const r10 = await loadDs(D10);
    if (r10.data) load(D10, r10.data);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot();
})();
