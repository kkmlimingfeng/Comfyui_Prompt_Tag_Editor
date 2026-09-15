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
  cursor:grab; user-select:none; font-size:13px; }
.pte-tag:hover { filter:brightness(1.25); border-color:var(--input-text,#999); z-index:10000; }
.pte-tag.pte-missing { opacity:.45; border-style:dashed; }
.pte-tag.pte-dragging { opacity:.35; }
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

  return { id: uid(), text: body, translation: "", weight };
}

function serialize(tags) {
  return tags.map(t => {
    const s = (t.text || "").trim();
    if (!s) return "";
    const w = Number(t.weight ?? 1);
    return Math.abs(w - 1) < 1e-6 ? s : `(${s}:${w.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")})`;
  }).filter(Boolean).join(", ");
}

function serializeTranslations(tags) {
  return tags.map(t => (t.translation || "").trim()).filter(Boolean).join(", ");
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
  const label = translated ? (tag.translation || tag.text) : tag.text;
  const missing = translated && !(tag.translation || "").trim();
  if (missing) el.classList.add("pte-missing");
  el.textContent = label;
  el.title = missing ? "未翻译" : label;

  let holdTimer = null;
  let startX = 0;
  let startY = 0;

  // Long-press (~350ms) enables dragging.
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      el.draggable = true;
      el.classList.add("pte-dragging");
    }, 350);
  });

  const clearHold = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  };
  el.addEventListener("pointerup", clearHold);
  el.addEventListener("pointercancel", clearHold);
  el.addEventListener("pointermove", e => {
    if (!holdTimer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) clearHold();
  });

  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
    node.__pte.dragIndex = index;
    node.__pte.root.classList.add("pte-drag-active");
  });

  const clearIndicators = () => {
    node.__pte.root.querySelectorAll(".pte-insert-left, .pte-insert-right")
      .forEach(el2 => el2.classList.remove("pte-insert-left", "pte-insert-right"));
  };

  el.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = el.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    el.classList.toggle("pte-insert-left", before);
    el.classList.toggle("pte-insert-right", !before);
  });

  el.addEventListener("dragleave", () => {
    el.classList.remove("pte-insert-left", "pte-insert-right");
  });

  el.addEventListener("drop", e => {
    e.preventDefault();
    e.stopPropagation();
    clearIndicators();
    const from = node.__pte.dragIndex ?? Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isInteger(from) || from < 0) return;

    const rect = el.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    let to = before ? index : index + 1;
    if (from < to) to -= 1;

    const tags = node.__pte.tags;
    if (to !== from) {
      const [item] = tags.splice(from, 1);
      tags.splice(to, 0, item);
    }
    node.__pte.render();
  });

  el.addEventListener("dragend", () => {
    el.draggable = false;
    el.classList.remove("pte-dragging");
    clearIndicators();
    node.__pte.root.classList.remove("pte-drag-active");
    node.__pte.dragIndex = null;
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
  // arrows), pointerdown would arm the long-press drag.
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
  state.syncText = () => {
    const text = serialize(state.tags);
    if (state.prompt.value !== text) {
      state.suppressInput = true;
      state.prompt.value = text;
      state.suppressInput = false;
    }
    if (nativePrompt) nativePrompt.value = text;
    if (nativeTranslated) nativeTranslated.value = serializeTranslations(state.tags);
  };

  state.render = (opts = {}) => {
    state.original.replaceChildren();
    state.translated.replaceChildren();

    state.tags.forEach((tag, i) => {
      state.original.appendChild(createTag(node, tag, i, false));
      state.translated.appendChild(createTag(node, tag, i, true));
    });

    if (opts.keepRaw) {
      // Keep the textarea exactly as typed; only push values to hidden widgets.
      if (nativePrompt) nativePrompt.value = state.prompt.value;
      if (nativeTranslated) nativeTranslated.value = serializeTranslations(state.tags);
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
      const hasMissing = state.tags.some(t => !(t.translation || "").trim());
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
    state.tags = parsePrompt(state.prompt.value);
    state.render({ keepRaw: true });
    scheduleAuto(900);
  });

  // External value changes (e.g. workflow load) → resync the editor.
  if (nativePrompt) {
    nativePrompt.callback = (v) => {
      const text = String(v ?? "");
      if (state.prompt.value === text) return;
      state.suppressInput = true;
      state.prompt.value = text;
      state.suppressInput = false;
      state.tags = parsePrompt(text);
      state.render();
      scheduleAuto(900);
    };
  }

  // Allow dropping into the empty padding of a tags box (moves to end).
  for (const box of [state.original, state.translated]) {
    box.addEventListener("dragover", e => e.preventDefault());
    box.addEventListener("drop", e => {
      if (e.target !== box) return;
      e.preventDefault();
      const from = state.dragIndex;
      if (!Number.isInteger(from)) return;
      const [item] = state.tags.splice(from, 1);
      state.tags.push(item);
      state.render();
    });
  }

  // Initial sync from the native widgets + re-sync after workflow loads.
  const resyncFromNative = () => {
    if (nativePrompt) {
      const text = String(nativePrompt.value ?? "");
      state.suppressInput = true;
      state.prompt.value = text;
      state.suppressInput = false;
      state.tags = parsePrompt(text);
    }
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
