# Knowledge Garden

> A personal knowledge exploration, review, and long-term evolution system for Obsidian.

English | [简体中文](./README.md)

Knowledge Garden is not just for organizing notes. It helps you observe how knowledge is captured, refined, connected, reviewed, and evolved over time. It keeps a clear boundary between "AI suggestions" and "knowledge you personally confirmed": AI finds connections worth noticing, while confirmation and accumulation stay with you. Markdown is the only knowledge source; AI is the analysis layer, not a source of truth.

---

## Overview

Knowledge Garden is a desktop Obsidian plugin that provides a personal knowledge system:

- Knowledge dashboard: today state, knowledge areas, recent access, recent reviews, today review
- Local note index and knowledge state inference (new / growing / active / stale / possibly forgotten)
- Periodic reviews: daily / weekly / monthly / quarterly / custom, with optional automatic scheduling (off by default; no tokens consumed on first install)
- AI knowledge connection: today curiosity, today roaming, Query Explorer for vault-wide association exploration
- Capture and refinement: manual / clipboard / URL capture → Inbox → AI refinement → your confirmation → Knowledge
- User confirmed relationships: AI suggests → you confirm → long-lived, recoverable from the vault
- Saved explorations: persist worthwhile AI paths as Markdown; clearing the AI cache does not affect them
- Long-term evolution: weekly local deterministic snapshots to observe how knowledge changes over time
- Diagnostics and self-healing: status panel, corrupt cache isolation and recovery, data migration

## Why Knowledge Garden

Typical plugins either only show dashboard statistics or let AI bulk-generate content. The common problem: the system does not know which connections you truly endorse.

Knowledge Garden differs on three explicit boundaries:

1. **Local computation first, AI second.** Note index, state inference, candidate selection, and review queue are deterministic local computations; AI participates only after candidates are selected, for finding connections / asking questions / analysis.
2. **AI suggestions ≠ knowledge.** AI-generated relationships and insights are suggestions, not authoritative facts. Only after you confirm does a suggestion become part of long-term knowledge structure.
3. **Entire Vault means local discovery scope, not full-vault upload.** The content sent to the AI provider is limited by the current candidate-selection policy; AI features only go online if you configure them.

## Core Features

| Feature | Description |
| --- | --- |
| Dashboard | today state, knowledge areas, today curiosity / roaming, Query Explorer, knowledge evolution, saved chains, recent access, recent reviews, today review |
| Hero / Wallpaper | single image or random folder wallpaper, overlay, title and subtitle |
| Music Player | local audio playback (shuffle / repeat / volume), visible only when you enable it |
| Knowledge Areas | custom areas (name / folder / icon / whether they join AI candidates) |
| AI Provider | preset SiliconFlow (OpenAI-compatible Chat Completions endpoint) |
| AI Cache | 11 cache kinds + fingerprint + request coalescing; repeat requests cost 0 AI |
| Activity | recent access / access count / recent review / review count (local records) |
| Knowledge State | five-state inference: new / growing / active / stale / forgotten |
| Automatic Review Scheduler | daily / weekly / monthly / quarterly / custom cycles, off by default, asks before running |
| Review Center / Session | today review queue, AI review questions, skip penalty |
| AI Knowledge Graph | explainable SVG exploration path (not a generic Graph view) |
| Discovery Scope | curiosity and roaming each have an independent scope: vault / areas / folders / tags / recent / custom |
| Full-Vault Discovery | local candidate selection (relevance + diversity), then AI |
| Query Explorer | question / keywords → local search → candidate ranking → diversity selection → AI relationship reasoning → knowledge graph |
| Saved Exploration | saves full nodes + edges + AI explanations, persisted as Markdown |
| Knowledge Evolution | weekly local snapshots, area trends, cross-area links, long-unresolved questions, AI long-term observation |
| Capture / Inbox / Processing | manual / clipboard / URL capture → Inbox → AI refinement → your confirmation → Knowledge |
| Provenance | capture origin preserved (original kept; archive preserves the source) |
| User Confirmed Relationships | AI suggests → you confirm → long-lived relationships recoverable from the vault |
| Relationship Markdown | confirmed relationships are persisted as Markdown (Relationships/), not only as JSON |
| Diagnostics | status panel and repair actions (rebuild index / search index / saved index / review queue / clear expired cache) |
| Data Migration / Corrupt Recovery | atomic writes, corrupt-file isolation, and recovery from Markdown |
| Offline fallback | AI failures go to error cache; review queue can be rebuilt locally; cache hits cost 0 AI |
| Production Hardening | defensive parsing, path validation, explicit command boundaries, 0-AI local operations |

## Architecture

```
             Obsidian (your vault)
                   |
                   v
              Note Index (local index cache)
                   |
        +---------+----------+
        v                    v
   Activity             Knowledge State
   (recent access)      (new/growing/active/stale/forgotten)
        |                    |
        +---------+----------+
                   v
         Local Discovery Engine (curiosity / roaming candidate selection: whole vault as search space)
                   |
                   v
             SiliconFlow (AI analysis layer: suggestions, not facts)
                   |
        +---------+----------+
        v                    v
    AI Review / Curiosity   AI Connections / Query Explorer
                   |
                   v
             AI Cache (11 kinds, fingerprint + coalescing)
                   |
                   v
        Scheduler → next review cycle (daily / weekly / monthly / quarterly / custom)
```

The key point: **AI is not an auto-summarizer bot.** AI output enters cache and candidates first; the cut "AI suggests → you confirm → long-term structure" keeps your vault from becoming a giant AI-summary dump.

## Discovery & Query Explorer

- **Daily Curiosity**: AI finds "knowledge worth noticing today" among local candidates, with a question and connection explanation.
- **Daily Roaming**: AI produces an explorable knowledge path (nodes + edges + reasons), rendered as an SVG graph.
- **Discovery Scope**: curiosity and roaming each have their own scope (vault / areas / folders / tags / recent / custom). You can do "curiosity: entire vault; roaming: dig deep into a few areas", so discovery (diverging) and exploration (converging) stay separate.
- **Query Explorer**: question / keywords → vault-wide association exploration:

```
Query
  |
  v
Local Search (keyword search, not vector search)
  |
  v
Candidate Ranking (relevance + confirmed-relationship weighting)
  |
  v
Diversity Selection (soft diversity)
  |
  v
AI Relationship Reasoning
  |
  v
Knowledge Graph (explainable exploration path)
```

This is not a simple "AI search": candidates are first selected locally; AI only reasons about relationships among those candidates.

## Knowledge Graph

The graph is not decoration; it is explainable AI output. Each edge carries a relation text and a reason; clicking a node opens the real note. It answers "why did AI connect these today".

- Solid line = user confirmed or wikilink evidence
- Dashed line = AI-inferred potential connection
- Saved chain = full nodes + edges + the AI explanation at that time (not just titles or cache keys)

## Review & Knowledge Evolution

- **Review cycles**: daily / weekly / monthly / quarterly / custom (every N days), each with a configurable time.
- **Automatic scheduling is off by default**: no tokens on first install; it still asks before running once enabled.
- **Review Center**: today review queue (local computation), with optional AI review questions (recall / connection / application / contrast).
- **Mark reviewed**: only updates review data (lastReviewedAt / reviewCount); opening a note only updates recent access (lastAccessedAt / accessCount). The two are not conflated (Phase 3 decision).
- **Knowledge evolution snapshots**: weekly local deterministic snapshots (metrics + area trends + cross-area links + persistent questions); monthly / quarterly use AI for long-term observation over aggregated metrics.
- **Possibly forgotten knowledge**: forgotten judgment (beyond forgotten-day threshold + not reviewed + has knowledge links), viewable with one command.

## Capture & Processing

Capture → refine → confirm → knowledge:

```
Discover information (you choose the sources: RSS / web / API / manual input)
  |
  v
Capture (Manual / Clipboard / URL → Inbox)
  |
  v
AI initial refinement (summary / concepts / claims / questions / suggested links / suggested relationships / suggested tags)
  |
  v
You confirm (Accept / Archive)
  |
  v
Real knowledge (Knowledge area)
  |
  v
AI helps you rediscover (curiosity / roaming / Query Explorer)
```

- Capture never overwrites the original: AI refinement is written into an independent region (`<!-- KG:AI_START -->...<!-- KG:AI_END -->`); reprocessing updates only that region, never your text.
- Archive preserves the source; nothing is deleted.
- autoProcess is off by default: AI refinement requires your explicit trigger.

> The emphasis here is "AI suggestion → human confirmation → knowledge": it prevents the vault from turning into a giant AI-summary dump. The video note stresses auto-summarization and auto-write into Obsidian; this system deliberately keeps the human confirmation step.

## Saved Explorations & Relationships

**Saved Exploration**:

```
AI Result
  |
  v
User likes the chain
  |
  v
Save Exploration
  |
  v
Persistent Markdown (Saved/)
```

It saves full nodes + edges + the AI explanation at the time, i.e., building "how I understood my own knowledge". Clearing the AI cache does not affect saved explorations — they are persistent Markdown, not cache.

**User Confirmed Relationships**:

```
AI suggests (suggestion, dashed)
  |
  v
User confirms (you confirm)
  |
  v
Persistent relationship (Relationships/*.md + cache/relationships.json)
```

- AI-suggested relationships are never auto-written into long-term structure; only your confirmation makes them formal knowledge relationships.
- Confirmed relationships are persisted as Markdown (`Relationships/`), so they survive AI-cache clearing, plugin reinstall, and model upgrades — recoverable from the vault.
- Evidence kinds: `wikilink` / `ai_inferred` / `user_confirmed` (composable).
- WikiLink = "I already connected them", AI Edge = "AI found a possible connection", User Confirmed = "I endorse this connection as long-lived".

## Privacy & Security

- Local index and most state live locally (`.obsidian/plugins/knowledge-garden/cache/`); content sent to the AI provider is limited by the current candidate-selection policy. Whether AI features go online is up to your configuration.
- The API key is kept only in the local plugin config (`data.json`); it is not written into notes or source; the diagnostics panel only shows "configured / not configured", never the key.
- Command boundaries: rebuild index / rebuild search index / rebuild saved index / rebuild review queue / clear expired cache / recover relationships are all 0-AI local operations.
- Clearing the AI cache only touches the AI cache; Reviews / Saved / Relationships / your notes are untouched.

## Offline & Local-first

- Failed AI requests enter the error cache (TIMEOUT / NETWORK / HTTP / parse failure, etc.) while keeping existing cache for continued browsing.
- The review queue can be rebuilt locally; knowledge state, evolution snapshots, and activity are deterministic local computations.
- Repeat / unchanged requests hit the AI cache: 0 AI requests.
- Fingerprint + version + date decide cache invalidation; casually opening a note does not invalidate the whole AI cache (Phase 2.5 / Phase 3 decision).

## Installation

Requirements: Obsidian desktop app (Version ≥ 1.4.0). Desktop only (`isDesktopOnly: true`).

Currently distributed via local development / manual installation:

1. Build: run `npm run build` in the plugin directory (tsc + esbuild, produces `main.js`).
2. Put the `knowledge-garden` directory under your vault's `.obsidian/plugins/`.
3. Obsidian Settings → Third-party plugins → enable "Knowledge Garden (知识花园)".
4. After reloading the plugin, open the Dashboard from the sidebar or the command palette (command: open Knowledge Garden dashboard).

(Not yet released to the community plugin catalog; install as above.)

## Quick Start

1. **Open the Dashboard**: run "Open Knowledge Garden Dashboard" from the command palette; the `Knowledge Garden/` folder structure is created on init.
2. **Configure the AI provider** (optional but recommended): Settings → AI, fill SiliconFlow Base URL / Model / API Key (defaults `https://api.siliconflow.cn/v1`, model `Qwen/Qwen2.5-7B-Instruct`). Run "Test AI connection" to verify.
3. **Generate today curiosity**: command "Generate today knowledge curiosity". First run calls AI; after that, opening the Dashboard reads the cache with 0 AI.
4. **Ask**: open Query Explorer, type a question / keywords; local retrieval + AI relationship reasoning produce an explorable knowledge chain.
5. **Confirm relationships**: when a "maybe related" suggestion appears, confirm it to enter `Relationships/` and long-term structure.
6. **Review**: open Review Center to finish today review; once automatic scheduling is enabled, it reminds you on schedule.

## Configuration

(Settings follow `DEFAULT_SETTINGS` in `src/types.ts`; key items below.)

- **AI**: provider (siliconflow) / baseUrl / model / temperature (0.7) / maxTokens (1500) / timeoutSec (60)
- **Hero**: single image background / random folder / random switch / overlay (0.25)
- **Music**: local audio folder / shuffle / repeat / volume (0.7) / autoplay; off by default
- **Capture**: Inbox / Processing / Knowledge / Archive folders (default under `Knowledge Garden/`); suggest tags / suggest areas / preserve sources
- **Review**: daily / weekly / monthly / quarterly / custom cycles and times (default 20:00)
- **Review Center**: queue 5 / AI questions / up to 5 questions / skip penalty
- **Activity**: new (7d) / stale (14d) / forgotten (30d) / recent limit (8)
- **Automatic Review**: off by default; confirms before running; startup check
- **Evolution**: local snapshots kept 52 weeks; long-term observation default metadata
- **Discovery**: curiosity / roaming each have scope + candidate count (16) + flags (roaming prefers cross-area)
- **Query Explorer**: scope (vault / current discovery scope) / 16 candidates / local limit 50 / history 20

## Commands

Commands registered by this plugin (run from the command palette):

- **Dashboard / Index**: open dashboard; refresh index and dashboard; rebuild index (full scan); test AI connection
- **Today Curiosity / Roaming**: generate today curiosity (or force, skipping cache); generate today roaming connections (or force)
- **Review**: generate daily / weekly / monthly / quarterly review (all support force); mark current note as reviewed; open today review window; force rebuild today review queue (0 AI); view review-schedule status
- **Knowledge Evolution**: generate weekly snapshot (local computation); generate monthly / quarterly evolution (or force)
- **View**: recent access; possibly forgotten knowledge
- **Query Explorer**: open Query Explorer; clear recent exploration history (AI cache untouched)
- **Saved**: open my saved explorations; rebuild saved index (0 AI)
- **Relationships**: open the relationship folder; re-recover relationships via scan (0 AI)
- **Capture**: new manual capture; clipboard capture; URL capture; open Inbox / candidates / confirmed knowledge; process current capture (or force, skipping cache); refine to knowledge (user confirm); archive current capture / candidate
- **Maintenance**: clear AI cache (only cache/, Reviews/ untouched); clear expired AI cache; diagnostics

## Data Storage

All knowledge is Markdown-first; program state and cache live in the plugin directory:

| Path | Content |
| --- | --- |
| `Knowledge Garden/Inbox/` | pending captures (Markdown) |
| `Knowledge Garden/Processing/` | AI-refined knowledge candidates (Markdown, with independent AI region) |
| `Knowledge Garden/Knowledge/` | knowledge you confirmed (Markdown) |
| `Knowledge Garden/Archive/` | archived sources (original kept) |
| `Knowledge Garden/Relationships/` | confirmed relationships (Markdown frontmatter) |
| `Saved/` | saved exploration chains (Markdown) |
| `Reviews/` | reviews (daily / weekly / monthly / quarterly) |
| `cache/index.json` | local note index cache |
| `cache/activity.json` | recent access / review records |
| `cache/discovery.json` | discovery date dedup markers |
| `cache/evolution.json` | evolution snapshots and persistent questions |
| `cache/query-history.json` | Query Explorer history |
| `cache/review-queue.json` / `cache/review-session.json` | review queue and session |
| `cache/saved-explorations.json` | saved index (rebuilt from `Saved/*.md`) |
| `cache/schedule.json` | auto-schedule records |
| `cache/relationships.json` | relationship index (rebuilt from `Relationships/*.md`) |
| `cache/ai-cache.json` | AI cache (11 kinds, fingerprint + coalescing; safe to clear) |
| `data.json` | plugin settings (incl. AI config; no note bodies) |

Clearing the AI cache does not affect: Reviews / Saved / Relationships / Knowledge / any of your notes.

## Development

```
npm install         # install dev dependencies (esbuild / typescript / obsidian typings)
npm run dev         # watch build (esbuild --watch)
npm run build       # type check + build (tsc -noEmit -skipLibCheck && node esbuild.config.mjs)
main.js             # build output (the file Obsidian actually loads)
```

Layout: `src/` holds the source (`main.ts` entry; `types.ts` types & defaults; `ai/` provider & cache; `dashboard/` Hero & music player; other modules by domain). `manifest.json` is the Obsidian plugin manifest (version 1.0.0, `minAppVersion 1.4.0`, desktop only).

## Testing

- Core logic is verified by automated assertions in a Node environment during development (bundle pure functions / storage layer with esbuild, then check with `node` + `assert`; e.g. relationship-store confirm / dedup / corrupt isolation / Markdown recovery, parsing-layer path validation and zero side effects).
- There is no standalone CI test directory in this repo; automated tests are dev-time scripts (not shipped with the plugin).
- Some runtime behaviors still need verification in a real Obsidian vault (dashboard rendering, graph interaction, commands, Hero / Music visuals, real AI requests). This README does not claim "Fully tested in Obsidian".

## Troubleshooting

- **Dashboard does not open**: make sure the plugin is enabled; reload the plugin; run "rebuild knowledge index".
- **AI generation fails**: first run "Test AI connection"; check Base URL / Model / API Key; failed requests go to the error cache without breaking existing cache.
- **Start over**: "Clear AI cache" only clears the AI cache; Reviews / Saved / Relationships and notes stay.
- **Suspect dirty state**: open "Diagnostics" to see status lines; use repair actions (rebuild index / search index / saved index / review queue / clear invalid activity / clear expired cache).
- **Relationship data corrupted**: on startup the plugin isolates the corrupt file and recovers from `Relationships/*.md` (0 AI); you can also run "re-recover relationships" manually.
- **Search returns nothing**: this plugin uses local keyword search, not semantic / vector search; try wording closer to the original text or widen the scope.

## Limitations

- Desktop only; requires Obsidian ≥ 1.4.0.
- No semantic search / Embeddings / vector database (local retrieval is keyword-based). If real use shows "I wrote this idea but with totally different keywords and local search cannot find it", introduce semantic retrieval for that concrete pain point.
- No RSS / YouTube / GitHub / Reddit auto-harvesting; URL capture only stores the link and title into Inbox, it does not fetch page content.
- No autonomous agent; AI only analyzes / suggests; all write actions are triggered by you or explicit commands.
- AI model capability depends on the provider and model you configure; the plugin does not endorse specific model capabilities.
- The graph is an "AI-generated exploration path", not a live Graph View.

## Roadmap

The following are planned directions, **not yet implemented and not claimed as supported**:

- Homepage "knowledge state machine" summary: growing / forgetting / cross-domain connections / long-unresolved questions / AI-suggested next exploration
- Semantic retrieval: introduced only when a real pain point appears (keyword search fails to find synonymous content)
- Further iteration on music and visuals (Hero / theme)

## Contributing

Currently a personal knowledge system project. Feedback from real usage is the most valuable driver: found issues (bugs / interactions / data) matter more than designing features out of nowhere. When contributing: do not invent features, keep README consistent with code, and AI-related changes default to 0 auto-writes.

## License

MIT (per the `license` field in `package.json`).

---

English | [简体中文](./README.md)
