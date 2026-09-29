import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "PromptTagEditor";

const STYLE = `
.pte-root { font-family: sans-serif; width:100%; height:100%; box-sizing:border-box;
  color: var(--fg-color,#ccc); display:flex; flex-direction:column; }
.pte-inner { display:block; }
.pte-label { font-weight:600; margin:6px 0 3px; }
.pte-row { display:flex; align-items:center; gap:6px; margin:6px 0 3px; }
.pte-row .pte-label { margin:0; }
.pte-auto { display:flex; align-items:center; gap:3px; font-size:12px; opacity:.85; cursor:pointer; }
.pte-lang { margin-left:auto; background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
  border:1px solid var(--border-color,#444); border-radius:5px; padding:2px 4px; }
.pte-translate { background:var(--comfy-input-bg,#333); color:var(--input-text,#ddd);
  border:1px solid var(--border-color,#555); border-radius:5px; padding:2px 8px; cursor:pointer; }
.pte-translate:hover { filter:brightness(1.25); }
.pte-translate:disabled { opacity:.5; cursor:default; }
.pte-textarea { width:100%; box-sizing:border-box; resize:vertical; min-height:64px;
  background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
  border:1px solid var(--border-color,#444); border-radius:5px; padding:7px; outline:none;
  font-family:inherit; font-size:13px; }
.pte-box { min-height:50px; width:100%; box-sizing:border-box; padding:7px;
  border:1px solid var(--border-color,#444); border-radius:5px;
  background:var(--comfy-input-bg,#222);
  display:flex; flex-wrap:wrap; align-content:flex-start; gap:5px; }
.pte-tag { position:relative; display:inline-flex; align-items:center;
  min-height:24px; padding:2px 7px; box-sizing:border-box;
  border:1px solid var(--border-color,#666); border-radius:4px;
  background:var(--comfy-input-bg,#303030); color:var(--input-text,#ddd);
  cursor:grab; user-select:none; font-size:13px; touch-action:none; }
.pte-tag:hover { filter:brightness(1.25); border-color:var(--input-text,#999); z-index:10000; }
.pte-tag.pte-missing { opacity:.45; border-style:dashed; }
.pte-tag.pte-dragging { opacity:.35; cursor:grabbing; }
.pte-tag.pte-disabled { opacity:.5; filter:grayscale(.9);
  border-style:dashed; text-decoration:line-through; }
/* Keep popups out of the way while a drag is in progress. */
.pte-tag.pte-dragging .pte-pop,
.pte-root.pte-drag-active .pte-pop { display:none !important; }
/* Zone colors: original = light yellow, translated = light red. */
.pte-box.pte-original .pte-tag { background:#fff3bf; color:#333; }
.pte-box.pte-translated .pte-tag { background:#ffdbdb; color:#333; }
.pte-tag.pte-insert-left::before,
.pte-tag.pte-insert-right::after {
  content:""; position:absolute; top:-3px; bottom:-3px; width:3px;
  background:#4a9eff; border-radius:2px; pointer-events:none; }
.pte-tag.pte-insert-left::before { left:-5px; }
.pte-tag.pte-insert-right::after { right:-5px; }
/* Popup: transparent padding bridges the gap so :hover is kept while the
   pointer travels from the tag to the popup content. */
.pte-pop { position:absolute; left:0; top:100%; padding:5px 0 0; z-index:10000;
  display:none; background:transparent; border:none; }
.pte-tag:hover .pte-pop { display:block; }
.pte-pop.pte-pop-up { top:auto; bottom:100%; padding:0 0 5px; }
.pte-pop-box { min-width:150px; padding:6px;
  border:1px solid var(--border-color,#666); border-radius:5px;
  background:var(--comfy-input-bg,#202020); color:var(--input-text,#ddd);
  box-shadow:0 4px 12px #0008; }
.pte-pop-title { font-weight:600; margin-bottom:4px; max-width:220px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pte-pop-row { display:flex; align-items:center; gap:5px; white-space:nowrap; }
.pte-pop input { width:60px; background:var(--comfy-input-bg,#151515); color:var(--input-text,#ddd);
  border:1px solid var(--border-color,#555); border-radius:3px; }
.pte-pop button { background:var(--comfy-input-bg,#333); color:var(--input-text,#ddd);
  border:1px solid var(--border-color,#555); border-radius:3px; cursor:pointer; }
.pte-status { font-size:11px; opacity:.6; margin-top:5px; min-height:14px; }
.pte-hint { font-size:11px; opacity:.5; margin-top:3px; }
`;

const LANGS = [
  ["Chinese", "中文"],
  ["Japanese", "日语"],
  ["Korean", "韩语"],
  ["English", "英语"],
  ["French", "法语"],
  ["German", "德语"],
  ["Spanish", "西班牙语"],
  ["Russian", "俄语"],
];

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parsePrompt(text) {
  const result = [];
  let buf = "";
  let depth = 0;

  for (const ch of text || "") {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth = Math.max(0, depth - 1);

    if (ch === "," && depth === 0) {
      const s = buf.trim();
      if (s) result.push(parseTag(s));
      buf = "";
    } else {
      buf += ch;
    }
  }

  const s = buf.trim();
  if (s) result.push(parseTag(s));
  return result;
}

function parseTag(text) {
  let body = text.trim();
  let weight = 1.0;

  let m = body.match(/^\((.*):([0-9]*\.?[0-9]+)\)$/);
  if (m) {
    body = m[1].trim();
    weight = Number(m[2]);
  } else if (body.startsWith("((") && body.endsWith("))")) {
    body = body.slice(2, -2).trim();
    weight = 1.21;
  } else if (body.startsWith("(") && body.endsWith(")")) {
    body = body.slice(1, -1).trim();
    weight = 1.1;
  }

  return { id: uid(), text: body, translation: "", weight, disabled: false };
}

function serialize(tags) {
  return tags.map(t => {
    const s = (t.text || "").trim();
    if (!s || t.disabled) return "";
    const w = Number(t.weight ?? 1);
    return Math.abs(w - 1) < 1e-6 ? s : `(${s}:${w.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")})`;
  }).filter(Boolean).join(", ");
}

function serializeTranslations(tags) {
  return tags.filter(t => !t.disabled)
    .map(t => (t.translation || "").trim())
    .filter(Boolean).join(", ");
}

// If the raw text ends with a comma (at bracket depth 0), keep a ", " at the
// end so the user can directly continue typing the next tag.
function trailingSeparator(raw) {
  if (!/,\s*$/.test(raw || "")) return "";
  let depth = 0;
  for (const ch of raw) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
  }
  return depth === 0 ? ", " : "";
}

function installStyle() {
  if (!document.getElementById("pte-style")) {
    const s = document.createElement("style");
    s.id = "pte-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

// Hide a native schema widget visually while keeping it as the value holder
// (workflow save/load and prompt serialization still go through it).
function hideWidget(node, name) {
  const w = node.widgets?.find(w => w.name === name);
  if (!w) return null;
  w.computeSize = () => [0, -4];
  w.hidden = true;
  return w;
}

function createTag(node, tag, index, translated) {
  const el = document.createElement("div");
  el.className = "pte-tag";
  el.dataset.index = String(index);
  el.dataset.uid = tag.id;
  const label = translated ? (tag.translation || tag.text) : tag.text;
  const missing = translated && !(tag.translation || "").trim();
  if (missing) el.classList.add("pte-missing");
  if (tag.disabled) el.classList.add("pte-disabled");
  el.textContent = label;
  el.title = missing ? "未翻译" : label;

  const pte = node.__pte;

  // Pointer-based reordering: press a tag and move — dragging starts right
  // away (no long-press wait). A release without movement is a plain click,
  // which toggles the tag's disabled state.
  let pointerId = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let dropTarget = null; // {index, before} or {append: true}

  const clearIndicators = () => {
    pte.root.querySelectorAll(".pte-insert-left, .pte-insert-right")
      .forEach(el2 => el2.classList.remove("pte-insert-left", "pte-insert-right"));
  };

  // Locate the drop position by scanning tags in visual order: rows fully
  // above the pointer are passed (fallback = after the row's last tag); the
  // row containing the pointer is split left/right at each tag's midpoint.
  const updateDropTarget = (x, y) => {
    dropTarget = null;
    clearIndicators();
    for (const box of [pte.original, pte.translated]) {
      const br = box.getBoundingClientRect();
      if (x < br.left || x > br.right || y < br.top - 6 || y > br.bottom + 6) continue;

      let idx = null;
      let before = false;
      let fallback = null;
      for (const t of box.querySelectorAll(".pte-tag")) {
        if (t === el) continue;
        const r = t.getBoundingClientRect();
        if (y > r.bottom + 4) {
          fallback = Number(t.dataset.index);
          continue;
        }
        if (y < r.top - 4) {
          idx = Number(t.dataset.index);
          before = true;
          break;
        }
        if (x < r.left + r.width / 2) {
          idx = Number(t.dataset.index);
          before = true;
          break;
        }
        fallback = Number(t.dataset.index);
      }
      if (idx === null && fallback !== null) {
        idx = fallback;
        before = false;
      }
      if (idx === null) {
        dropTarget = { append: true };
      } else {
        dropTarget = { index: idx, before };
        const target = box.querySelector(`.pte-tag[data-index="${idx}"]`);
        if (target) target.classList.add(before ? "pte-insert-left" : "pte-insert-right");
      }
      return;
    }
  };

  const endDrag = (cancel) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("pte-dragging");
    pte.root.classList.remove("pte-drag-active");
    clearIndicators();
    const from = pte.dragIndex;
    if (!cancel && dropTarget && Number.isInteger(from)) {
      let to;
      if (dropTarget.append) {
        to = pte.tags.length - 1;
      } else {
        to = dropTarget.before ? dropTarget.index : dropTarget.index + 1;
        if (from < to) to -= 1;
      }
      if (to !== from && to >= 0) {
        const [item] = pte.tags.splice(from, 1);
        pte.tags.splice(to, 0, item);
        pte.render();
      }
    }
    pte.dragIndex = null;
    dropTarget = null;
  };

  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener("pointermove", e => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      dragging = true;
      pte.dragIndex = index;
      el.classList.add("pte-dragging");
      pte.root.classList.add("pte-drag-active");
    }
    e.preventDefault();
    updateDropTarget(e.clientX, e.clientY);
  });

  el.addEventListener("pointerup", e => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (dragging) { endDrag(false); return; }
    if (e.button !== 0) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) return;

    // Plain click: toggle the disabled state. The twin element in the other
    // box is updated in place (no re-render) so a fast double-click still
    // lands on the same element and the edit prompt keeps working.
    tag.disabled = !tag.disabled;
    for (const box of [pte.original, pte.translated]) {
      const twin = box.querySelector(`.pte-tag[data-uid="${tag.id}"]`);
      if (twin) twin.classList.toggle("pte-disabled", !!tag.disabled);
    }
    pte.syncText();
  });

  el.addEventListener("pointercancel", e => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    endDrag(true);
  });

  // Hover popup: tag text + weight + delete. Flip above when near the bottom.
  el.addEventListener("mouseenter", () => {
    const pop = el.querySelector(".pte-pop");
    const rootR = node.__pte.root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    pop.classList.toggle("pte-pop-up", r.bottom + 130 > rootR.bottom);
  });

  const pop = document.createElement("div");
  pop.className = "pte-pop";
  pop.innerHTML = `
    <div class="pte-pop-box">
      <div class="pte-pop-title"></div>
      <div class="pte-pop-row">
        <span>Weight</span>
        <input type="number" min="0.1" max="10" step="0.05">
        <button type="button" title="删除">×</button>
      </div>
    </div>
  `;
  pop.querySelector(".pte-pop-title").textContent = label;

  // Interactions inside the popup must not reach the tag itself:
  // dblclick would open the edit prompt (e.g. double-clicking the spinner
  // arrows), pointerdown would start the press/drag tracking.
  pop.addEventListener("dblclick", e => e.stopPropagation());
  pop.addEventListener("pointerdown", e => e.stopPropagation());

  const weightInput = pop.querySelector("input");
  weightInput.value = Number(tag.weight).toFixed(2);
  // Only sync text here (no rebuild): rebuilding would destroy the popup DOM
  // under the pointer and close it while the spinner arrows are clicked.
  weightInput.addEventListener("input", e => {
    tag.weight = Number(e.target.value) || 1;
    node.__pte.syncText();
  });

  pop.querySelector("button").addEventListener("click", e => {
    e.stopPropagation();
    node.__pte.tags.splice(index, 1);
    node.__pte.render();
  });

  // Double click edits the tag text.
  el.addEventListener("dblclick", e => {
    e.stopPropagation();
    const value = window.prompt("编辑 Tag", label);
    if (value == null) return;
    if (translated) tag.translation = value.trim();
    else tag.text = value.trim();
    node.__pte.render();
  });

  el.appendChild(pop);
  return el;
}

function build(node) {
  if (node.__pte) return;
  installStyle();

  const nativePrompt = hideWidget(node, "prompt");
  const nativeLang = hideWidget(node, "target_language");
  const nativeTranslated = hideWidget(node, "translated_prompt");
  const nativeState = hideWidget(node, "tags_state");

  const root = document.createElement("div");
  root.className = "pte-root";
  // .pte-inner wraps the content so its natural height can be measured even
  // though the frontend stretches the widget element (h-full) to the slot.
  root.innerHTML = `
    <div class="pte-inner">
      <div class="pte-label">原始提示词</div>
      <textarea class="pte-textarea" rows="3" placeholder="1girl, long hair, blue eyes, white dress..."></textarea>

      <div class="pte-label">Tags</div>
      <div class="pte-box pte-original"></div>

      <div class="pte-row">
        <div class="pte-label">翻译结果 Tags</div>
        <label class="pte-auto" title="输入或修改标签后自动翻译">
          <input type="checkbox" class="pte-auto-check" checked>自动</label>
        <select class="pte-lang">${LANGS.map(([v, l]) =>
          `<option value="${v}">${l}</option>`).join("")}</select>
        <button class="pte-translate" type="button" title="翻译全部标签">↻</button>
      </div>
      <div class="pte-box pte-translated"></div>
      <div class="pte-status"></div>
      <div class="pte-hint">悬停：权重 / 删除 · 拖动：排序 · 单击：停用 / 启用 · 双击：编辑</div>
    </div>
  `;

  const inner = root.querySelector(".pte-inner");

  const widget = node.addDOMWidget?.("pte_editor", "PTE_EDITOR", root, {
    serialize: false,
    hideOnZoom: false,
    // Report the real content height so the node body grows/shrinks with it
    // (frontend default is a fixed 50px min-height slot).
    getMinHeight: () => (inner.offsetHeight || 0) + 20,
    getHeight: () => (inner.offsetHeight || 0) + 20,
    afterResize: () => fitNodeSize(true),
  });
  if (widget) widget.serialize = false;

  node.__pte = {
    root,
    inner,
    prompt: root.querySelector(".pte-textarea"),
    original: root.querySelector(".pte-original"),
    translated: root.querySelector(".pte-translated"),
    lang: root.querySelector(".pte-lang"),
    autoCheck: root.querySelector(".pte-auto-check"),
    translateButton: root.querySelector(".pte-translate"),
    status: root.querySelector(".pte-status"),
    tags: [],
    dragIndex: null,
    suppressInput: false,
    translating: false,
    autoPending: false,
    widget,
  };

  const state = node.__pte;

  // Keep the node height in sync with the DOM content.
  let fitPending = false;
  const fitNodeSize = (growOnly = false) => {
    if (!node.graph || !node.size) return;
    const cs = node.computeSize?.([...node.size]);
    if (!cs) return;
    const h = Math.max(cs[1], 160);
    const cur = node.size[1];
    if (growOnly ? h > cur + 2 : Math.abs(cur - h) > 2) {
      node.setSize?.([node.size[0], h]);
      node.setDirtyCanvas?.(true, true);
    }
  };
  state.fitNodeSize = fitNodeSize;

  const ro = new ResizeObserver(() => {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(() => {
      fitPending = false;
      fitNodeSize(false);
    });
  });
  ro.observe(inner);

  // Push current tags/translations into the native (hidden) value widgets.
  // Writing .value goes through the widget's own setter, which updates the
  // frontend widget store (options.setValue) used by queue/save.
  const tagsStateJson = () => JSON.stringify(state.tags.map(t => ({
    text: t.text || "",
    translation: t.translation || "",
    weight: Number(t.weight) || 1,
    disabled: !!t.disabled,
  })));

  state.syncText = () => {
    const base = serialize(state.tags);
    const text = base + trailingSeparator(state.prompt.value);
    if (state.prompt.value !== text) {
      state.suppressInput = true;
      state.prompt.value = text;
      state.suppressInput = false;
    }
    if (nativePrompt) nativePrompt.value = base;
    if (nativeTranslated) nativeTranslated.value = serializeTranslations(state.tags);
    if (nativeState) nativeState.value = tagsStateJson();
  };

  // Rebuild tags from textarea text while keeping disabled tags (which are
  // not part of the text anymore). Re-typing the same text re-enables it.
  state.rebuildFromText = (text) => {
    const parsed = parsePrompt(text);
    const kept = state.tags.filter(t =>
      t.disabled && !parsed.some(p => p.text === (t.text || "").trim()));
    state.tags = parsed.concat(kept);
  };

  state.render = (opts = {}) => {
    state.original.replaceChildren();
    state.translated.replaceChildren();

    state.tags.forEach((tag, i) => {
      state.original.appendChild(createTag(node, tag, i, false));
      state.translated.appendChild(createTag(node, tag, i, true));
    });

    if (opts.keepRaw) {
      // Keep the textarea exactly as typed; only push values to hidden
      // widgets (the prompt widget gets the canonical serialized text so
      // save/load stays consistent even with a trailing comma mid-typing).
      if (nativePrompt) nativePrompt.value = serialize(state.tags);
      if (nativeTranslated) nativeTranslated.value = serializeTranslations(state.tags);
      if (nativeState) nativeState.value = tagsStateJson();
    } else {
      state.syncText();
    }
    fitNodeSize(true);
    node.setDirtyCanvas?.(true, true);
  };

  const setStatus = (text) => {
    if (state.status) state.status.textContent = text || "";
  };

  // ---- translation ------------------------------------------------------
  const doTranslate = async () => {
    if (state.translating || !state.tags.length) return;
    state.translating = true;
    const button = state.translateButton;
    button.disabled = true;
    button.textContent = "…";
    setStatus("翻译中…");

    // While the request runs, surface model download progress if any.
    const dlTimer = setInterval(async () => {
      try {
        const res = await api.fetchApi("/prompt_tag_editor/status");
        const s = await res.json();
        if (s.download?.downloading) {
          const mb = n => (n / 1048576).toFixed(0);
          setStatus(`正在下载翻译模型… ${mb(s.download.downloaded)}/${mb(s.download.total)} MB`);
        }
      } catch (err) { /* status polling is best-effort */ }
    }, 1000);

    try {
      const response = await api.fetchApi("/prompt_tag_editor/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_language: state.lang.value,
          tags: state.tags.map(t => ({ text: t.text })),
        }),
      });

      const data = await response.json().catch(() => ({}));
      console.log("[PromptTagEditor] translate response:", data);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status} ${response.statusText}`);
      }

      let filled = 0;
      state.tags.forEach((tag, i) => {
        const tr = String(data.translations?.[i] ?? "").trim();
        tag.translation = tr;
        if (tr) filled++;
      });
      state.render();
      setStatus(`翻译完成 · ${filled}/${state.tags.length} 个标签`);
    } catch (err) {
      console.error("[PromptTagEditor]", err);
      setStatus("翻译失败：" + err.message);
      window.alert("翻译失败：\n" + err.message);
    } finally {
      clearInterval(dlTimer);
      state.translating = false;
      button.disabled = false;
      button.textContent = "↻";
      if (state.autoPending) {
        state.autoPending = false;
        scheduleAuto(200);
      }
    }
  };

  let autoTimer = null;
  const scheduleAuto = (delay = 900) => {
    if (autoTimer) clearTimeout(autoTimer);
    if (!state.autoCheck?.checked || !state.tags.length) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (state.translating) {
        state.autoPending = true;
        return;
      }
      const hasMissing = state.tags.some(t => !t.disabled && !(t.translation || "").trim());
      if (hasMissing) doTranslate();
    }, delay);
  };
  state.scheduleAuto = scheduleAuto;

  state.translateButton.addEventListener("click", () => doTranslate());
  state.lang.addEventListener("change", () => {
    if (nativeLang) nativeLang.value = state.lang.value;
    state.tags.forEach(t => { t.translation = ""; });
    state.render();
    scheduleAuto(300);
  });
  state.autoCheck?.addEventListener("change", () => {
    if (state.autoCheck.checked) scheduleAuto(200);
  });

  // Typing keeps raw text (no cursor fighting); tag ops rebuild everything.
  state.prompt.addEventListener("input", () => {
    if (state.suppressInput) return;
    state.rebuildFromText(state.prompt.value);
    state.render({ keepRaw: true });
    scheduleAuto(900);
  });

  // External value changes (e.g. workflow load) → resync the editor.
  if (nativePrompt) {
    nativePrompt.callback = (v) => {
      const text = String(v ?? "");
      // Assigning the native widget's value echoes back through this
      // callback. Ignore echoes describing the tags we already have (e.g.
      // the canonical text pushed while typing), otherwise the rewrite
      // would eat spaces/trailing commas mid-edit.
      if (serialize(parsePrompt(text)) === serialize(state.tags)) return;
      state.suppressInput = true;
      state.prompt.value = text;
      state.suppressInput = false;
      state.rebuildFromText(text);
      state.render();
      scheduleAuto(900);
    };
  }

  // Initial sync from the native widgets + re-sync after workflow loads.
  const resyncFromNative = () => {
    const text = String(nativePrompt?.value ?? "");
    let saved = null;
    try { saved = JSON.parse(nativeState?.value || "null"); } catch (err) { saved = null; }

    if (Array.isArray(saved) &&
        serialize(saved.filter(t => t && !t.disabled)) === serialize(parsePrompt(text))) {
      // tags_state matches the prompt text: restore the full editor state
      // (order, weights, translations and disabled flags).
      state.tags = saved
        .filter(t => t && typeof t === "object")
        .map(t => ({
          id: uid(),
          text: String(t.text ?? ""),
          translation: String(t.translation ?? ""),
          weight: Number(t.weight) || 1,
          disabled: !!t.disabled,
        }));
    } else {
      // External/legacy prompt text: parse it fresh.
      state.tags = parsePrompt(text);
    }
    state.suppressInput = true;
    state.prompt.value = text;
    state.suppressInput = false;
    if (nativeLang && nativeLang.value) state.lang.value = nativeLang.value;
    state.render();
    scheduleAuto(1200);
  };
  resyncFromNative();

  const origConfigure = node.onConfigure;
  node.onConfigure = function () {
    origConfigure?.apply(this, arguments);
    resyncFromNative();
  };

  if (node.size && node.size[0] < 420) {
    node.setSize?.([420, node.size[1]]);
  }
  requestAnimationFrame(() => fitNodeSize(false));
}

app.registerExtension({
  name: EXTENSION_NAME,
  async nodeCreated(node) {
    if (node.comfyClass === "PromptTagEditor") {
      try {
        build(node);
      } catch (err) {
        console.error("[PromptTagEditor] build failed:", err);
      }
    }
  },
});
