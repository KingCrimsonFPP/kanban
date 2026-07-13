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
//
// card #151 — epic membership edges: a child card's `parent: <epic-id>`
// becomes an epic->child edge with `kind: 'epic'` (waiting_for edges carry
// `kind: 'dep'`). Membership is not sequencing: it feeds the layered layout
// (the epic lands above its children) and gets the same ghost-stub courtesy,
// but it never makes anyone `waiting` and — deliberately — does NOT count for
// the isolated row. "No dependencies" means no SEQUENCING deps, so an epic
// whose only edges are membership appears in the graph AND the detached row,
// exactly as asked ("is ok to appear in the no dependencies list but belongs
// to the dependency graph as well"). A self-parent is nonsense and adds no
// edge; a dangling parent id ghosts as missing, same as a dangling dep.
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
  // One shared endpoint-visibility rule for both edge kinds: drop when neither
  // endpoint is on screen, ghost a hidden-but-real endpoint, ghost a missing id.
  const addEdge = (from, to, kind) => {
    const key = `${from}->${to}:${kind}`;
    if (seenEdges.has(key)) return; // de-dupe a repeated entry
    const fromVisible = isVisible(from);
    const toVisible = isVisible(to);
    if (!fromVisible && !toVisible) return;
    seenEdges.add(key);
    if (!fromVisible) ghostIds.add(from);
    if (!toVisible) ghostIds.add(to);
    edges.push({ from, to, kind, fromGhost: !fromVisible, toGhost: !toVisible });
  };
  for (const c of cards) {
    for (const depId of c.waiting_for || []) addEdge(depId, c.id, 'dep');
    // card #151: membership edge, epic -> member (the epic reads as the tree's
    // root). `parent` is a single id; self-parent adds nothing. When the SAME
    // pair already has a dep edge (the card both belongs to and waits on its
    // epic), sequencing wins the path — the two kinds draw on an identical
    // bezier, and orange-over-grey would hide a real dependency; the
    // membership is still readable from the epic dot + this card's parent.
    if (c.parent != null && c.parent !== c.id && !seenEdges.has(`${c.parent}->${c.id}:dep`)) {
      addEdge(c.parent, c.id, 'epic');
    }
  }

  const ghosts = [...ghostIds].filter((id) => !nodeIds.has(id))
    .sort((a, b) => a - b)
    .map((id) => (byId.has(id) ? cardToNode(byId.get(id), isCardWaiting(byId.get(id), byId))
      : { id, title: null, status: null, archived: false, epic: false, priority: '', waiting: false, blocked: false, blockedReason: '', missing: true }));

  // card #151: the isolated row is keyed off SEQUENCING edges only, while the
  // layered graph lays out every node touched by ANY edge (`participants`) —
  // a node whose only edges are epic membership joins the graph and the row
  // both. Both derivations live here, in the pure module, so their different
  // kind-keying stays unit-pinned rather than re-derived in the view.
  const touchedByDep = new Set();
  const touchedByAny = new Set();
  for (const e of edges) {
    touchedByAny.add(e.from); touchedByAny.add(e.to);
    if (e.kind === 'dep') { touchedByDep.add(e.from); touchedByDep.add(e.to); }
  }
  const isolated = nodes.filter((n) => !touchedByDep.has(n.id)).map((n) => n.id);
  const participants = nodes.filter((n) => touchedByAny.has(n.id)).map((n) => n.id)
    .concat(ghosts.map((g) => g.id));

  return { nodes, edges, ghosts, isolated, participants };
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
