'use strict';
// Pure graph-builder + layered-layout math for the dependency map view (card
// #19). No DOM here — same dual-environment pattern as search.js/column-*.js:
// loaded as a plain <script> in the browser (app.js calls these as bare
// globals) AND required directly by node --test.
//
// Mirrors the kanban-cli skill's Mermaid semantics exactly: an
// edge A -> B means "B waits for A" (B has A in its waiting_for) — same
// direction as that skill's `n<depId> --> n<id>` output, so the two views
// read the same graph the same way.
//
// The waiting/blocked predicates come from waiting-blocked.js (epic #137's
// one shared home) — in Node via require, in the browser off window, where
// waiting-blocked.js loads first (app.html order). Namespace object rather
// than destructured consts, same shared-scope reasoning as gantt-model's CAL.
const WB = (typeof module !== 'undefined' && module.exports)
  ? require('./waiting-blocked')
  : window;

// card #107 gave the node its precomputed gate flags; epic #137 split them:
// `waiting` (some waiting_for dep not done — the amber stroke) and `blocked`
// (the manual sticker — the red pill), with `blockedReason` riding along for
// the pill's tooltip.
function cardToNode(c, waiting) {
  return {
    id: c.id, title: c.title, status: c.status, archived: !!c.archived, epic: !!c.epic,
    priority: c.priority || '', waiting: !!waiting,
    blocked: WB.isBlockedValue(c.blocked), blockedReason: WB.blockedReason(c.blocked),
  };
}

// Same derived-waiting rule as the board's own isWaiting() (app.js) — both
// are thin wrappers over the shared unresolvedWaits; byId is the caller's
// own full active+archived lookup (waiting is location-independent).
function isCardWaiting(c, byId) {
  return WB.unresolvedWaits(c.waiting_for, byId).length > 0;
}

// Build the node/edge/ghost-stub set for the map from the full card list
// (active + archived — waiting is location-independent, same as the board's
// own isWaiting() check) and the ids currently matching the search box
// (`visibleIds`: a Set, or null/undefined meaning "no active query — every
// card is visible", mirroring search.js's own "empty query matches
// everything").
//
// Design decisions (see card #19):
// - An edge with NEITHER endpoint visible is dropped entirely — only
//   matching cards are "the slice you're looking at"; an edge floating
//   between two invisible cards has nothing on-screen to anchor it to.
// - An edge with exactly one endpoint hidden keeps the edge and turns the
//   hidden endpoint into a dimmed ghost stub — in EITHER direction (a hidden
//   dep of a visible card, or a hidden card that waits on a visible one):
//   "a hidden dep is exactly what you're looking for," and the same
//   courtesy applies symmetrically.
// - A waiting_for id with no matching card at all (stale/deleted reference)
//   still gets a ghost stub, marked `missing: true`, rather than silently
//   vanishing.
// - Isolated cards (no waiting_for edge in either direction) are reported
//   separately so the caller can render them in a detached cluster instead
//   of mixing them into the layered graph.
function buildDependencyGraph(cards, visibleIds) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  // A ghost placeholder from a dangling reference has no card behind it, so
  // "visible" must require actual existence — not just query-membership —
  // or an unfiltered board would wrongly treat a stale id as a real node.
  const isVisible = (id) => byId.has(id) && (!visibleIds || visibleIds.has(id));

  const nodes = cards.filter((c) => isVisible(c.id)).map((c) => cardToNode(c, isCardWaiting(c, byId)));
  const nodeIds = new Set(nodes.map((n) => n.id));

  const seenEdges = new Set();
  const edges = [];
  const ghostIds = new Set();
  for (const c of cards) {
    for (const depId of c.waiting_for || []) {
      const key = `${depId}->${c.id}`;
      if (seenEdges.has(key)) continue; // de-dupe a repeated waiting_for entry
      const depVisible = isVisible(depId);
      const waiterVisible = isVisible(c.id);
      if (!depVisible && !waiterVisible) continue; // neither endpoint on screen — drop
      seenEdges.add(key);
      if (!depVisible) ghostIds.add(depId);
      if (!waiterVisible) ghostIds.add(c.id);
      edges.push({ from: depId, to: c.id, fromGhost: !depVisible, toGhost: !waiterVisible });
    }
  }

  const ghosts = [...ghostIds].filter((id) => !nodeIds.has(id))
    .sort((a, b) => a - b)
    .map((id) => (byId.has(id) ? cardToNode(byId.get(id), isCardWaiting(byId.get(id), byId))
      : { id, title: null, status: null, archived: false, epic: false, priority: '', waiting: false, blocked: false, blockedReason: '', missing: true }));

  const touchedIds = new Set();
  for (const e of edges) { touchedIds.add(e.from); touchedIds.add(e.to); }
  const isolated = nodes.filter((n) => !touchedIds.has(n.id)).map((n) => n.id);

  return { nodes, edges, ghosts, isolated };
}

// Assign a top-down layer index (0 = topmost / least-waited-on) to every id
// that participates in at least one edge, via Kahn's algorithm — with a
// deterministic cycle-break: when no remaining node has in-degree 0 (a
// cycle), force the lowest remaining id into the current layer rather than
// waiting forever for an in-degree that can never reach 0. `remaining`
// strictly shrinks by at least one id every outer-loop iteration (the normal
// path removes every ready node, the cycle-break path removes exactly one),
// so this always terminates in O(V+E) regardless of how many/how large the
// cycles are — the "must not hang on a cycle" half of card #19's requirement.
function layerNodes(nodeIds, edges) {
  const remaining = new Set(nodeIds);
  const inDegree = new Map(nodeIds.map((id) => [id, 0]));
  const successors = new Map(nodeIds.map((id) => [id, []]));
  for (const { from, to } of edges) {
    if (from === to) continue; // self-loop: no layering constraint, drawn separately as a back-edge
    if (!remaining.has(from) || !remaining.has(to)) continue;
    successors.get(from).push(to);
    inDegree.set(to, inDegree.get(to) + 1);
  }

  const layer = new Map();
  let current = 0;
  while (remaining.size) {
    let ready = [...remaining].filter((id) => inDegree.get(id) === 0);
    if (!ready.length) ready = [Math.min(...remaining)]; // break a cycle deterministically (lowest id)
    ready.sort((a, b) => a - b);
    for (const id of ready) { layer.set(id, current); remaining.delete(id); }
    for (const id of ready) {
      for (const succ of successors.get(id)) {
        if (remaining.has(succ)) inDegree.set(succ, inDegree.get(succ) - 1);
      }
    }
    current++;
  }
  return layer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildDependencyGraph, layerNodes };
} else {
  window.buildDependencyGraph = buildDependencyGraph;
  window.layerNodes = layerNodes;
}
