# LEON PROJECT

Everything for Leon Gold (a gold and jewellery business in Tehran) lives here, one folder per part. Each part has its own `CLAUDE.md` with its details; this file holds what is shared.

- **New laptop?** Read `_laptop-move/README.md` first (restore steps for memory, skills, tools; state at move time).

## The owner

- Writes in Persian and works from an iPhone (Safari). Reply in Persian; the phone layout is first-class.
- Act without asking first, then report briefly. Test before every push.
- Ask before any irreversible change to live business data. Customer data is never committed to git.

## The parts

| Folder | What it is | Live at |
|---|---|---|
| `leon-gold` | «دفتر لئون», the ledger app (one `index.html`), plus its build scripts | built into `leon-gold-app` |
| `leon-gold-app` | Built output only: the phone app on GitHub Pages, the gold price feed (Action, `price` branch), and the site preview in `site/` | https://leon-gold.github.io/leon-gold-app/ |
| `leon-gold-site` | The public showcase site (Next.js), and the CRM panel at `/panel` (skill `leon-crm`; signs in to the sync server, writes only `crm_*` collections) | preview at https://leon-gold.github.io/leon-gold-app/site/ (panel: `site/panel/`) |
| `leon-gold-server` | Sync server: one shared copy of the ledger data for all devices (Node + SQLite) | https://api.leongold.net (Liara app `leon-gold`, auto-deploys on push to `main`; the old *.liara.run address is gone) |
| `leon-gold-hosting` | Builds site + panel + ledger (`/daftar/`) into one web root for the owner's domain and ships it to a Liara static app; move-day steps in `CHECKLIST.md` | not live yet (waits for the domain) |
| `leon-gold-social` | Instagram plan and ready-to-post visuals (captions, carousels, stories, the daily price story); built into `leon-gold-app/social/`. Never posts; the owner posts | https://leon-gold.github.io/leon-gold-app/social/ |

- The folders must stay siblings: the scripts reach each other with `..\leon-gold-app` and `..\leon-gold-server`.
- A new part (for example the CRM back end) gets its own new folder here, its own git repo under the LEON-Gold GitHub account, and its own `CLAUDE.md`. Add it to the table above.
- The path has a space (`LEON PROJECT`): quote it in every script.
- Skills not needed for Leon (Anthropic brand, Slack, slides, MCP building, duplicate animation/design packs) were moved to `.skills-archive` on 2026-10-28 so tabs load fewer skill descriptions. Move one back into `.claude/skills` if a task really needs it.
- Backups live outside this folder, in `../Backup` (Mac: `leon-backup.sh`, launchd daily 13:00; PC: `leon-backup.ps1`): full-history mirrors of every repo, daily copies of uncommitted work, skills and Claude memory, and the live ledger DB once the owner has logged the backup tool in. Never delete it.
- Shared Claude skills live in `.claude/skills` here at the root (copied from `leon-gold/.claude/skills`), so they load when VS Code opens LEON PROJECT. Add new skills here.

## Shared look

The full design system is in [DESIGN.md](DESIGN.md) (colours, type, components, motion, rules, and a prompt for agents). Read it before building or restyling any screen, and keep it in step with the code.

All parts use the ledger's "Assay Ledger" style: emerald vault greens, gold leaf gradient text, ivory paper cards with a gold hairline and corner ornaments, guilloché patterns, Amiri for titles, Vazirmatn for text, Persian digits.

## Plans not yet done

- Real hosting on an Iranian service (Liara or ArvanCloud) once the owner has an account and a domain: site at `/`, CRM at `/panel`, ledger at `/daftar` (ledger data moves by backup and restore; the old link stays until then).
- Site contacts are real (2026-10-27: owner's mobile for calls and WhatsApp, Instagram, hours; no landline, no address, no founding year by choice). The collection, ajrat and profit are still SAMPLE.
- No online payment yet.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost). Every repo's git post-commit hook also does it in the background.
- The ledger is one big `leon-gold/index.html`, which graphify can't parse. `.graphify-mirror.py` copies its inline scripts to `.graph-mirror/leon-gold/index.html.js` with the SAME line numbers: a node there at line N is `leon-gold/index.html` line N. Read and edit `index.html` itself, never the mirror. The post-commit hook refreshes the mirror; after editing index.html without committing, run `python3 -I .graphify-mirror.py && graphify update .`.
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
