import { app } from "../../scripts/app.js";

// Multi Reroute frontend: each row is one reroute channel — input "route i"
// on the left, output "route i" on the right, same row, so the node reads as
// a stack of built-in Reroutes.
//
// Row count control: a combo widget below the slot rows (the frontend
// always renders widgets below the slot rows — hard-coded DOM order, so
// above-row placement is not possible). Combo values must be STRINGS: the
// arrow buttons locate the current value with indexOf() — number values
// never match and every arrow click snaps to the first option. Rows are
// only added/removed at the END of both slot lists, so connected links
// keep their slot indices. Height/width follow the content (plain node,
// no DOM widget — computeSize is safe here).
const MAX_ROUTES = 20;
const DEFAULT_ROUTES = 2;
const WIDTH = 120;

const VALUES = Array.from({ length: MAX_ROUTES }, (_, i) => String(i + 1));

const fit = (node) => {
  const s = node.computeSize();
  node.setSize([node.size?.[0] ?? WIDTH, s[1]]);
  node.setDirtyCanvas?.(true, true);
};

const setRoutes = (node, n) => {
  n = Math.max(1, Math.min(MAX_ROUTES, n | 0));
  while (node.inputs.length > n) node.removeInput(node.inputs.length - 1);
  while (node.inputs.length < n)
    node.addInput(`route ${node.inputs.length + 1}`, "*");
  while (node.outputs.length > n) node.removeOutput(node.outputs.length - 1);
  while (node.outputs.length < n)
    node.addOutput(`route ${node.outputs.length + 1}`, "*");
  // Drop stale flags saved by older versions: the frontend draws
  // isOptional sockets as hollow rings (schema-era rows) while dynamic
  // rows are solid — normalize so every row renders the same.
  for (const s of node.inputs) delete s.isOptional;
  for (const s of node.outputs) delete s.isOptional;
  fit(node);
};

// Row naming: an unconnected row keeps its "route i" name; once a typed link
// is connected, both ends of the row are renamed to the link's type
// (MODEL, IMAGE, …). Duplicate types get _1, _2 … in row order. Recomputed
// from scratch on every change so connect / disconnect / workflow load all
// land on the same names.
const linkById = (id) => {
  const links = app.graph._links ?? app.graph.links;
  return links?.get ? links.get(id) : links?.[id];
};

const renameSlots = (node) => {
  const counts = {};
  let changed = false;
  node.inputs.forEach((inp, i) => {
    const link = inp.link != null ? linkById(inp.link) : null;
    const base = link?.type ? String(link.type) : `route ${i + 1}`;
    const n = counts[base] ?? 0;
    counts[base] = n + 1;
    const name = n === 0 ? base : `${base}_${n}`;
    if (inp.name !== name) { inp.name = name; changed = true; }
    if (node.outputs[i] && node.outputs[i].name !== name) {
      node.outputs[i].name = name; changed = true;
    }
  });
  if (changed) fit(node);
};

// Reconcile names on draw instead of trusting connect-time events: whichever
// path changes a link (drag, script, workflow load), the next frame redraws
// — compare a per-node link-type signature and rename only when it moved.
const syncNames = (node) => {
  const sig = node.inputs
    .map((i) => (i.link != null ? linkById(i.link)?.type ?? "?" : ""))
    .join("|");
  if (node.__pteSig === sig) return;
  node.__pteSig = sig;
  renameSlots(node);
};

// Load repair — lifecycle hooks proved unreliable with the V3 adapter
// (onConfigure can fire without the data arg), so the node persists its
// row→link mapping in node.properties (always serialized with the
// workflow) and repairs placement here, on every draw:
//  - a row is unconnected but the hint holds a link id whose target is this
//    node → put it back on its row (fixes both lost links and the +N row
//    shifts caused by core configure trusting stale link.target_slot)
//  - anything else (user disconnect / paste / stale hint) → the hint is
//    overwritten with the live state and never steals foreign links.
const reconcile = (node) => {
  const hintIn = node.properties.__pteIn;
  if (Array.isArray(hintIn)) {
    const holder = new Map();
    node.inputs.forEach((inp, i) => {
      if (inp.link != null) holder.set(inp.link, i);
    });
    hintIn.forEach((lid, i) => {
      if (lid == null || !node.inputs[i] || node.inputs[i].link != null) return;
      const j = holder.get(lid);
      if (j != null && j !== i) {
        // core configure left it on the wrong row — move it back
        node.inputs[j].link = null;
        holder.set(lid, i);
      } else if (j == null) {
        const link = linkById(lid);
        if (!link || link.target_id !== node.id) return;
      }
      const link = linkById(lid);
      if (!link) return;
      node.inputs[i].link = lid;
      link.target_id = node.id;
      link.target_slot = i;
    });
  }
  node.properties.__pteIn = node.inputs.map((i) => i.link ?? null);

  const hintOut = node.properties.__pteOut;
  if (Array.isArray(hintOut)) {
    const holder = new Map();
    node.outputs.forEach((out, i) =>
      (out.links || []).forEach((lid) => holder.set(lid, i)));
    hintOut.forEach((lids, i) => {
      if (!node.outputs[i]) return;
      for (const lid of lids || []) {
        if (node.outputs[i].links.includes(lid)) continue;
        const link = linkById(lid);
        if (!link || link.origin_id !== node.id) continue;
        const j = holder.get(lid);
        if (j != null && j !== i) {
          const other = node.outputs[j].links;
          const k = other.indexOf(lid);
          if (k >= 0) other.splice(k, 1);
          holder.set(lid, i);
        }
        node.outputs[i].links.push(lid);
        link.origin_id = node.id;
        link.origin_slot = i;
      }
    });
  }
  node.properties.__pteOut = node.outputs.map((o) => [...(o.links || [])]);

  syncNames(node);
};

app.registerExtension({
  name: "PromptTagEditor.MultiReroute",
  nodeCreated(node) {
    if (node.comfyClass !== "MultiReroute") return;

    // The Vue frontend renders schema-created slots from the node def and
    // ignores runtime .name changes (root cause of "default rows never
    // rename"), while slots added via addInput/addOutput render from .name.
    // Replace the schema slots with dynamic duplicates — same names, same
    // order — so type-renaming works on every row.
    node.inputs.length = 0;
    node.outputs.length = 0;
    for (let i = 1; i <= MAX_ROUTES; i++) {
      node.addInput(`route ${i}`, "*");
      node.addOutput(`route ${i}`, "*");
    }

    // Fresh node: the backend def ships MAX_ROUTES rows — trim to default
    // and add the row-count widget.
    setRoutes(node, DEFAULT_ROUTES);
    node.addWidget("combo", "routes", VALUES[DEFAULT_ROUTES - 1],
      (v) => setRoutes(node, v), { values: VALUES });
    node.serialize_widgets = true;

    // Snapshot the pristine saved slot order. LiteGraph's node.configure
    // merges serialized slots with LiteGraph.cloneObject(info.inputs,
    // this.inputs) which APPENDS them onto the dynamic nodeCreated rows
    // (leftover "route 1/2" end up ABOVE the saved rows and every link
    // shifts down), and by the time onConfigure fires data.inputs is
    // already the polluted merge. Wrapping the instance method lets us
    // capture the saved order before that happens.
    const origNodeConfigure = node.configure.bind(node);
    node.configure = function (info) {
      this.__pteSnap = {
        inputs: (info?.inputs || []).map((i) => ({
          name: i.name, type: i.type, link: i.link ?? null,
        })),
        outputs: (info?.outputs || []).map((o) => ({
          name: o.name, type: o.type, links: [...(o.links || [])],
        })),
      };
      return origNodeConfigure(info);
    };

    // Rebuild both slot lists exactly in the saved order (undoing the
    // cloneObject append), then normalize the row count to the combo
    // widget: trim unconnected tail rows beyond it, grow if short. Rows
    // the user removed stay removed; phantom rows from buggy older saves
    // do not resurrect.
    const rebuildSlots = (snap, wv) => {
      node.inputs.length = 0;
      node.outputs.length = 0;
      for (const si of snap.inputs) {
        node.addInput(si.name ?? `route ${node.inputs.length + 1}`,
          si.type ?? "*", { link: si.link ?? null });
      }
      for (const so of snap.outputs) {
        node.addOutput(so.name ?? `route ${node.outputs.length + 1}`,
          so.type ?? "*", { links: [...(so.links || [])] });
      }
      let rows = Math.max(node.inputs.length, node.outputs.length, 0);
      // Row count must equal the combo widget value. Extra rows can only be
      // corruption (cloneObject append leftovers, saves from the shifted
      // era) — drop UNCONNECTED rows top-first until the counts match;
      // connected rows are never dropped. An intentional empty row can't
      // exceed the widget count: the widget IS the row-count control.
      const unlinked = (i) =>
        node.inputs[i]?.link == null &&
        !(node.outputs[i]?.links || []).length;
      let guard = rows + 2;
      while (Number.isFinite(wv) && rows > wv && guard-- > 0) {
        const victim = node.inputs.findIndex((_, i) => unlinked(i));
        if (victim < 0) break;
        node.inputs.splice(victim, 1);
        node.outputs.splice(victim, 1);
        rows--;
      }
      while (Number.isFinite(wv) && rows < wv) {
        node.addInput(`route ${rows + 1}`, "*");
        node.addOutput(`route ${rows + 1}`, "*");
        rows++;
      }
    };

    // On workflow load: core configure applies widgets_values by silent
    // assignment (widget.value = v, NO callback) and calls this hook WITH
    // the node data afterwards. data.inputs is already the polluted
    // cloneObject merge, so rebuild from the pristine snapshot instead.
    const origConfigure = node.onConfigure;
    node.onConfigure = function (data) {
      origConfigure?.apply(this, arguments);
      const snap = this.__pteSnap;
      const rawWv = this.widgets?.find((w) => w.name === "routes")?.value ??
        data?.widgets_values?.[0];
      const wv = parseInt(rawWv, 10);
      if (snap) rebuildSlots(snap, wv);
      node.properties.__pteIn = node.inputs.map((i) => i.link ?? null);
      node.properties.__pteOut = node.outputs.map((o) => [...(o.links || [])]);
      node.__pteSig = undefined; // force a name reconcile on next draw
      // The saved node size may date from the pre-heal era (more rows than
      // the widget now asks for) — re-fit height to the healed content.
      // Width is preserved; this node is plain (no DOM widget), so
      // computeSize is reliable here.
      fit(node);
      // onDrawBackground never fires for Vue-rendered nodes, so reconcile
      // cannot ride the draw loop — run a short rAF burst instead to
      // repair placement after async slot-layout flushes settle.
      for (let f = 0; f < 30; f++) requestAnimationFrame(() => reconcile(node));
    };

    // Fast path: connect / disconnect events.
    const origCoc = node.onConnectionsChange;
    node.onConnectionsChange = function (...args) {
      origCoc?.apply(this, args);
      syncNames(node);
    };

    // Guaranteed path: reconcile on every redraw — catches links committed
    // after the event fired, adapter event ordering, workflow loads.
    const origDbg = node.onDrawBackground;
    node.onDrawBackground = function (...args) {
      const r = origDbg?.apply(this, args);
      reconcile(node);
      return r;
    };
  },
});
