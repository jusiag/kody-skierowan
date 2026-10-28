(() => {
  "use strict";
  const SYN = {
    usg: ["usg","ultrasonogra","ultradzwiek","echokardiogra"], ultrasonografia: ["usg","ultrasonogra"],
    rtg: ["rtg","rentgen","radiogra"], rentgen: ["rtg","rentgen","radiogra"], zdjecie: ["rtg","zdjeci","radiogra"],
    tk: ["tk","tomogra"], ct: ["tk","tomogra"], tomografia: ["tk","tomogra"],
    mr: ["rezonans","rm"], mri: ["rezonans","rm"], rm: ["rezonans","rm"], nmr: ["rezonans","rm"], rezonans: ["rezonans","rm"],
    ekg: ["ekg","elektrokardiogra"], echo: ["echokardiogra","echo"], eeg: ["eeg","elektroencefalogra"], emg: ["emg","elektromiogra"],
    ktg: ["ktg","kardiotokogra"], pet: ["pet","pozytonow"], gastroskopia: ["gastroskop","ezofagogastroduodenoskop"],
    morfologia: ["morfologi"], konsultacja: ["konsultac","porada"], porada: ["porada","konsultac"], fizjoterapia: ["fizjoterap"], rehabilitacja: ["rehabilit","fizjoterap"]
  };
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  let DATA = null;   // {version, codes, notes}
  let byCode = new Map(), kids = new Map(), index = [];
  let favs = new Set(store.get("icd9-favs", []));
  let META = null;
  try { META = JSON.parse(document.getElementById("nfzmeta").textContent) || null; if (META && !META.version) META = null; } catch { META = null; }

  const norm = (s) => (s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
  const words = (s) => norm(s).replace(/\./g, " ").split(" ").filter(Boolean);
  const vparts = (v) => String(v || "0").split(/[._]/).map((n) => parseInt(n, 10) || 0);
  const vcmp = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function load(data) {
    DATA = data; byCode = new Map(); kids = new Map(); index = [];
    for (const [code, name, lvl, parent, hasKids] of data.codes) {
      const e = { code, name, lvl, parent, hasKids };
      byCode.set(code, e);
      if (parent) { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(code); }
    }
    for (const e of byCode.values()) {
      const chain = []; let p = e.parent, guard = 0;
      while (p && byCode.has(p) && guard++ < 6) { chain.unshift(byCode.get(p)); p = byCode.get(p).parent; }
      e.chain = chain;
      e.own = words(e.name);
      e.ctx = chain.flatMap((c) => words(c.name));
      e.diag = /^(8[7-9]|9[0-2]|9[35])/.test(e.code) || /^[A-Z]/.test(e.code);
      index.push(e);
    }
    buildCats(); buildResCat(); $("loadMsg").hidden = true;
    updateInfo(); render();
  }

  const JOINTS = ["kolan", "bark", "biodr", "lokc", "lokie", "nadgar", "skokow", "kostk", "dlon", "nadgarst"];
  function alts(tok) {
    if (SYN[tok]) return SYN[tok];
    const stem = tok.length >= 8 ? tok.slice(0, tok.length - 3) : tok.length >= 5 ? tok.slice(0, Math.max(4, tok.length - 2)) : tok;
    if (tok.length >= 4 && JOINTS.some((j) => tok.startsWith(j))) return [stem, "staw", "konczyn", "miesniowo"];
    return [stem];
  }
  const hit = (list, alt) => list.some((w) => alt.length < 2 ? w === alt : w.startsWith(alt));

  function search(q) {
    const raw = q.trim(); if (!raw) return null;
    const qn = norm(raw);
    const codeLike = /^[0-9]{1,2}(\.[0-9]*)?$|^[a-z]{1,2}[0-9]{0,3}$/.test(qn);
    const toks = qn.replace(/\./g, qn.match(/^[0-9]/) ? "." : " ").split(" ").filter(Boolean);
    const out = [], partial = [];
    for (const e of index) {
      let s = 0;
      const cl = e.code.toLowerCase();
      if (codeLike) {
        if (cl === qn) s += 1000; else if (cl.startsWith(qn)) s += 500 - (cl.length - qn.length) * 10;
      }
      if (!s || !codeLike) {
        let all = true, ownAll = true, t = 0, n = 0, first = false;
        for (let i = 0; i < toks.length; i++) {
          const a = alts(toks[i]);
          const inOwn = a.some((x) => hit(e.own, x));
          const inCtx = !inOwn && a.some((x) => hit(e.ctx, x));
          if (!inOwn && !inCtx) { all = false; continue; }
          n++; if (i === 0) first = true;
          if (!inOwn) ownAll = false;
          t += inOwn ? 10 : 3;
          if (a.length > 1 && hit(e.own, a[0])) t += 4; // the word itself beats a related term
        }
        if (!all && toks.length > 1 && n > 0 && first) {
          partial.push([n * 10 + (e.diag ? 6 : 0) + (e.hasKids ? 4 : 0) - Math.min(8, e.name.length / 18), e]);
        }
        if (all) {
          t += ownAll ? 25 : 0;
          if (e.diag) t += 6;
          if (!e.hasKids) t += 2;
          t -= Math.min(8, e.name.length / 18);
          if (e.own[0] && alts(toks[0]).some((x) => e.own[0].startsWith(x))) t += 4;
          s = Math.max(s, t);
        }
      }
      if (s > 0) out.push([s, e]);
    }
    const cmp = (a, b) => b[0] - a[0] || a[1].code.localeCompare(b[1].code, "pl", { numeric: true });
    if (!out.length && toks.length > 1) {
      /* Żaden kod nie zawiera wszystkich słów: pokazujemy osobno kody pasujące do każdego słowa. */
      const groups = [];
      for (const t of toks) {
        if (t.length < 3) continue;
        const a = alts(t);
        const items = index.filter((e) => a.some((x) => hit(e.own, x)))
          .sort((x, y) => (y.diag - x.diag) || ((x.hasKids ? 1 : 0) - (y.hasKids ? 1 : 0)) || x.name.length - y.name.length)
          .slice(0, 10);
        if (items.length) groups.push({ label: t, items });
      }
      if (groups.length) return { toks, groups, items: groups.flatMap((g) => g.items) };
    }
    if (!out.length && partial.length) { partial.sort(cmp); return { toks, partial: true, items: partial.slice(0, 40).map((x) => x[1]) }; }
    out.sort(cmp);
    return { toks, items: out.map((x) => x[1]) };
  }

  function highlight(name, toks) {
    if (!toks || !toks.length) return esc(name);
    const parts = name.split(/(\s+|[-,()\/])/);
    return parts.map((p) => {
      const w = norm(p);
      if (w && toks.some((t) => alts(t).some((a) => a.length > 1 ? w.startsWith(a) : w === a))) return "<mark>" + esc(p) + "</mark>";
      return esc(p);
    }).join("");
  }

  /* Kopiować można tylko kody końcowe. Kategoria ogólna (ma kody szczegółowe) jest tylko etykietą. */
  const COPY_ICON = '<svg class="ci" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><svg class="ck" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const copyBtn = (code) => `<button class="code" type="button" data-copy="${esc(code)}" title="Kopiuj kod" aria-label="Kopiuj kod ${esc(code)}"><span class="ct">${esc(code)}</span>${COPY_ICON}</button>`;
  const codeBtn = (e, final) => final
    ? copyBtn(e.code)
    : `<span class="code nocopy" title="Kategoria ogólna: wybierz kod szczegółowy">${esc(e.code)}</span>`;

  function rowHTML(e, toks, compact) {
    const n = DATA.notes[e.code];
    const nk = kids.get(e.code)?.length || 0;
    const path = compact ? "" : e.chain.map((c) => `<button type="button" data-browse="${esc(c.code)}">${esc(c.code)} ${esc(c.name)}</button>`).join(" › ");
    const meta = [];
    if (nk) meta.push(`<button type="button" data-kids="${esc(e.code)}" aria-expanded="false">Rozwiń: Kody szczegółowe (${nk})</button>`);
    if (n) meta.push(`<button type="button" data-notes="${esc(e.code)}" aria-expanded="false">Uwagi NFZ</button>`);
    if (nk && !compact) meta.push(`<span class="tag">kategoria ogólna</span>`);
    return `<div class="row" data-code="${esc(e.code)}">
      ${codeBtn(e, !nk)}
      <div class="body"><span class="name">${highlight(e.name, toks)}</span>${path ? `<span class="path">${path}</span>` : ""}${meta.length ? `<span class="meta">${meta.join("")}</span>` : ""}</div>
      <button class="star${favs.has(e.code) ? " on" : ""}" type="button" data-fav="${esc(e.code)}" aria-pressed="${favs.has(e.code)}" aria-label="Ulubione">★</button>
    </div>`;
  }

  /* Lista kategorii ze słownika NFZ: rozdział > podrozdział > kategoria > kod szczegółowy. Dzieci tworzone dopiero po rozwinięciu. */
  function nodeHTML(e) {
    const n = kids.get(e.code)?.length || 0;
    if (!n) return rowHTML(e, null, true);
    return `<div class="node"><div class="nhead">${codeBtn(e, false)}<button class="nname" type="button" data-toggle="${esc(e.code)}" aria-expanded="false"><span class="chev" aria-hidden="true">▸</span><span class="nt">${esc(e.name)}</span><span class="cnt">${n}</span></button></div><div class="nkids" hidden></div></div>`;
  }
  function buildCats() {
    const top = index.filter((e) => e.lvl === 0);
    $("catCount").textContent = top.length;
    $("catList").innerHTML = top.map(nodeHTML).join("");
    $("catList").hidden = $("catToggle").getAttribute("aria-expanded") !== "true"; $("catTop").hidden = $("catList").hidden;
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
  const RES_BANNER = '<div class="resban"><b>Skąd te kody.</b> Zestawienie oparte na <b>rozporządzeniu Ministra Zdrowia z 17.05.2012 r. w sprawie systemu resortowych kodów identyfikacyjnych</b>, załącznik nr 2, część VIII (tekst jednolity z 2019 r., Dz. U. poz. 173; jedyna późniejsza zmiana, z 2017 r., jest w tym tekście uwzględniona). To kody <b>komórki organizacyjnej</b> (poradni, oddziału), nie kody procedur ICD-9. Kody dla dzieci wylicza się wg § 9 ust. 4 (kod dla dorosłych + 1).</div>';
  const RES_BANNER_SHORT = '<div class="resban"><b>Kody komórki organizacyjnej</b> (poradni, oddziału), nie kody procedur ICD-9. Źródło: rozporządzenie Ministra Zdrowia z 17.05.2012 r., załącznik nr 2, część VIII (tekst jednolity: Dz. U. 2019 poz. 173). Kod dla dzieci = kod dla dorosłych + 1 (§ 9 ust. 4).</div>';
  /* Informacja o aktualności: dane z automatu (META.resort) albo, gdy ich brak, data ręcznego sprawdzenia. */
  function resStatus() {
    const r = META && META.resort;
    if (!r || !r.checkedAt) return "Tabela sprawdzona ręcznie w ISAP dnia 26.10.2026: brak aktów zmieniających nowszych niż z 2017 r.";
    let t = "Automat sprawdził w Dzienniku Ustaw (API Sejmu) dnia " + fmtStamp(r.checkedAt) + ": brak aktów zmieniających poza tym z 2017 r.";
    const age = (Date.now() - new Date(r.checkedAt).getTime()) / 86400000;
    if (age > RES_AGE_WARN_DAYS) t += " Uwaga: od " + Math.floor(age) + " dni nie ma świeższego sprawdzenia, sprawdź sam w ISAP.";
    return t;
  }
  const resNote = () => '<div class="resnote"><b>Aktualność.</b> ' + esc(resStatus()) + ' NFZ podaje własne rozszerzenia w komunikatach (np. AP-KOLCE). Kod zawsze dobiera i potwierdza lekarz.<br>' + ELI_LINK + '</div>';
  let resLimit = 8;
  function resortBlock(q) {
    const found = resSearch(q.trim());
    if (!found.length) return "";
    const toks = norm(q).split(" ");
    const shown = found.slice(0, resLimit);
    const more = found.length > resLimit ? `<div class="tobar"><button class="btn ghost" type="button" data-resmore>Pokaż wszystkie kody resortowe (${found.length - resLimit} więcej)</button></div>` : "";
    return `<div class="section-h resh"><span>Kody resortowe (poradnie, oddziały; nie procedury)</span><span>${found.length}</span></div>${RES_BANNER_SHORT}<div class="list" style="margin-top:12px">${shown.map((r) => resRow(r, toks)).join("")}</div>${more}${resNote()}`;
  }
  function buildResCat() {
    if (!RES || !$("resList")) return;
    $("resCat").hidden = false;
    $("resCount2").textContent = RES.codes.length;
    $("resList").innerHTML = RES_BANNER + RES.sections.map((s, i) => `<div class="grp">${esc(s)}</div>` + resIdx.filter((r, k) => RES.codes[k][2] === i).map((r) => resRow(r)).join("")).join("") + resNote();
  }

  let limit = 60;
  function render() {
    if (!DATA) return;
    const q = $("q").value;
    $("clear").hidden = !q;
    const short = q.trim().length === 1;
    const res = short ? { toks: [], items: [], short: true } : search(q);
    const favItems = [...favs].map((c) => byCode.get(c)).filter(Boolean);
    $("favWrap").hidden = !!res || !favItems.length;
    $("favList").innerHTML = favItems.map((e) => rowHTML(e, null)).join("");
    $("catWrap").hidden = !!res;
    $("resWrap").hidden = !res;
    $("resortOut").innerHTML = "";
    if (!res) return;
    const items = res.items;
    if (!res.short) $("resortOut").innerHTML = resortBlock(q);
    const pre = $("resortOut").innerHTML ? "Procedury ICD-9: " : "";
    if (res.short) {
      $("resTitle").textContent = "Wpisz co najmniej 2 znaki";
      $("resCount").textContent = "";
      $("results").innerHTML = '<div class="empty">Jedna litera pasuje do zbyt wielu kodów. Wpisz słowo, np. „usg”, „kolano” albo początek kodu, np. „88”.</div>';
      return;
    }
    $("resTitle").textContent = pre + (res.partial ? "Brak dokładnego kodu. Najbliższe kody ogólne" : items.length ? "Wyniki" : "Brak wyników");
    $("resCount").textContent = items.length.toLocaleString("pl-PL");
    if (res.groups) {
      $("resTitle").textContent = pre + "Brak kodu ze wszystkimi słowami. Kody pasujące do pojedynczych słów";
      $("results").innerHTML = res.groups.map((g) => `<div class="grp">Pasuje do „${esc(g.label)}”</div>` + g.items.map((e) => rowHTML(e, [g.label])).join("")).join("")
        + `<div class="empty">Żaden kod w słowniku nie opisuje dokładnie „${esc(q.trim())}”. Wybierz najbliższy albo wpisz jedno słowo. Kod zawsze dobiera lekarz.</div><div class="tobar"><button class="btn ghost" type="button" data-top>↑ Na górę</button></div>`;
      return;
    }
    const shown = items.slice(0, limit);
    $("results").innerHTML = shown.length
      ? shown.map((e) => rowHTML(e, res.toks)).join("") + `<div class="tobar">${items.length > limit ? `<button class="btn ghost" type="button" data-more>Pokaż więcej (${items.length - limit})</button>` : ""}<button class="btn ghost" type="button" data-top>↑ Na górę</button></div>`
      : /^\d{4}$/.test(q.trim())
        ? `<div class="empty">${resSearch(q.trim()).length ? "Numeru „"+esc(q.trim())+"” nie ma wśród kodów procedur ICD-9 PL. To kod resortowy, patrz wyżej." : "Numeru „"+esc(q.trim())+"” nie ma w słowniku ICD-9 PL ani w tabeli kodów resortowych. Kody procedur wyglądają np. tak: 93.11 albo 89.00. Spróbuj wpisać nazwę badania lub zabiegu."}</div>`
        : `<div class="empty">Nic nie znaleziono dla „${esc(q)}”. Spróbuj krótszego słowa, np. „tarczyc” albo „kolan”, lub wpisz początek kodu.</div>`;
  }

  function browse(code) {
    const e = byCode.get(code); if (!e) return;
    $("q").value = ""; $("clear").hidden = true;
    $("favWrap").hidden = true; $("catWrap").hidden = true; $("resWrap").hidden = false;
    $("resortOut").innerHTML = "";
    $("resTitle").textContent = e.code + " " + e.name;
    const list = (kids.get(code) || []).map((c) => byCode.get(c));
    $("resCount").innerHTML = '<button type="button" class="linkbtn" data-back>Wróć do listy kategorii</button>';
    $("results").innerHTML = rowHTML(e, null) + list.map((k) => rowHTML(k, null, true)).join("") + `<div class="tobar"><button class="btn ghost" type="button" data-top>↑ Na górę</button></div>`;
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

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button,a"); if (!b) return;
    if (b.dataset.copy) return copy(b.dataset.copy, b);
    if (b.dataset.fav) {
      const c = b.dataset.fav; favs.has(c) ? favs.delete(c) : favs.add(c); store.set("icd9-favs", [...favs]);
      document.querySelectorAll(`[data-fav="${CSS.escape(c)}"]`).forEach((x) => { x.classList.toggle("on", favs.has(c)); x.setAttribute("aria-pressed", favs.has(c)); });
      if (!$("q").value && $("resWrap").hidden) { const fi = [...favs].map((x) => byCode.get(x)).filter(Boolean); $("favWrap").hidden = !fi.length; $("favList").innerHTML = fi.map((e) => rowHTML(e, null)).join(""); }
      return;
    }
    if ("top" in b.dataset) return window.scrollTo({ top: 0, behavior: "smooth" });
    if (b.dataset.browse) return browse(b.dataset.browse);
    if ("back" in b.dataset) return render();
    if (b.id === "resToggle") {
      const open = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!open)); $("resList").hidden = open; $("resTop").hidden = open;
      return;
    }
    if (b.id === "catToggle") {
      const open = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!open)); $("catList").hidden = open; $("catTop").hidden = open;
      return;
    }
    if (b.dataset.toggle) {
      const box = b.closest(".node").querySelector(":scope > .nkids");
      if (b.getAttribute("aria-expanded") === "true") { box.hidden = true; b.setAttribute("aria-expanded", "false"); return; }
      if (!box.dataset.filled) { box.innerHTML = kids.get(b.dataset.toggle).map((c) => nodeHTML(byCode.get(c))).join(""); box.dataset.filled = "1"; }
      box.hidden = false; b.setAttribute("aria-expanded", "true");
      return;
    }
    if ("more" in b.dataset) { limit += 60; return render(); }
    if ("resmore" in b.dataset) { resLimit = 1000; return render(); }
    if (b.dataset.kids || b.dataset.notes) {
      const row = b.closest(".row"); const kind = b.dataset.kids ? "kids" : "notes";
      const host = kind === "kids" ? row : row.querySelector(".body");
      const setLabel = (open) => { if (kind === "kids") b.textContent = b.textContent.replace(/^(Rozwiń|Zwiń):/, open ? "Zwiń:" : "Rozwiń:"); };
      const existing = host.querySelector(":scope > ." + kind);
      if (existing) { existing.remove(); b.setAttribute("aria-expanded", "false"); setLabel(false); return; }
      b.setAttribute("aria-expanded", "true"); setLabel(true);
      const el = document.createElement("div");
      if (kind === "kids") {
        el.className = "kids";
        el.innerHTML = kids.get(b.dataset.kids).map((c) => rowHTML(byCode.get(c), null, true)).join("");
        row.appendChild(el);
      } else {
        const n = DATA.notes[b.dataset.notes]; el.className = "notes";
        el.innerHTML = [["i", "Obejmuje"], ["x", "Nie obejmuje"], ["u", "Uwagi"]].filter(([k]) => n[k]).map(([k, l]) => `<div><b>${l}:</b> ${n[k].map(esc).join("; ")}</div>`).join("");
        row.querySelector(".body").appendChild(el);
      }
    }
  });

  let qt;
  $("q").addEventListener("input", () => { clearTimeout(qt); limit = 60; resLimit = 8; qt = setTimeout(render, 120); });
  $("clear").addEventListener("click", () => { $("q").value = ""; render(); $("q").focus(); });

  /* ---------- dane, aktualizacje, offline ---------- */
  const DATA_URL = new URL("data/icd9.json", location.href).href;
  const CACHE = "icd9-data";

  const valid = (d) => !!(d && Array.isArray(d.codes) && d.codes.length > 5000 && d.codes.some((c) => c[0] === "89.00"));
  async function cachedData() {
    try { const c = await caches.open(CACHE); const r = await c.match(DATA_URL); if (r) return await r.json(); } catch {}
    return null;
  }
  async function saveData(res) { try { const c = await caches.open(CACHE); await c.put(DATA_URL, res); } catch {} }

  const TZ = "Europe/Warsaw";
  const fmtStamp = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pl-PL", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }) + ", godz. " + d.toLocaleTimeString("pl-PL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  };
  /* Tekst informacyjny. Dane o sprawdzeniu NFZ są wpisane w stronę przy publikacji (automat robi to codziennie),
     więc aplikacja nie wysyła żadnych dodatkowych zapytań o aktualność. */
  function updateInfo() {
    const cur = DATA && DATA.version;
    $("srcVer").textContent = cur ? "Użyta wersja: " + cur + " (" + DATA.codes.length.toLocaleString("pl-PL") + " kodów)." : "";
    if (!META || !META.checkedAt) { $("checkInfo").textContent = ""; return; }
    let t = "Baza sprawdzona: " + fmtStamp(META.checkedAt) + ".";
    if (META.latestFile) t += " Ostatnia nazwa pliku na stronie NFZ: " + META.latestFile + ".";
    const age = (Date.now() - new Date(META.checkedAt).getTime()) / 86400000;
    if (age > 3) t += " Uwaga: od " + Math.floor(age) + " dni nie ma świeższego sprawdzenia (otwórz stronę z internetem).";
    $("checkInfo").textContent = t;
  }
  function updateResInfo() { if ($("resInfo")) $("resInfo").textContent = resStatus(); }

  async function boot() {
    let data = await cachedData(), updated = false;
    if (!valid(data)) {
      data = null;
      try {
        const r = await fetch(DATA_URL, { cache: "no-cache" });
        if (r.ok) { const copy = r.clone(); const d = await r.json(); if (valid(d)) { data = d; await saveData(copy); } }
      } catch {}
    } else if (META && META.version && vcmp(META.version, data.version) > 0) {
      /* Nowa wersja na serwerze: pobierana cicho, tylko wtedy, gdy rzeczywiście jest nowsza. */
      try {
        const r = await fetch(DATA_URL + "?v=" + encodeURIComponent(META.version), { cache: "reload" });
        if (r.ok) { const copy = r.clone(); const d = await r.json(); if (valid(d)) { data = d; await saveData(copy); updated = true; } }
      } catch {}
    }
    if (data) load(data);
    else $("loadMsg").textContent = "Nie udało się wczytać słownika. Połącz się z internetem i odśwież stronę.";
    if (updated) toast("Zaktualizowano kody do wersji " + data.version);
    updateInfo(); updateResInfo();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot();
})();
