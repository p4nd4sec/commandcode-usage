# commandcode-usage

A [Command Code](https://commandcode.ai) mod that draws a live usage readout **right under the prompt**:

```
Model: claude-opus-5 | 5h:[#-------]14%(1h30m) wk:[########]97%(2d11h) | session:18m | ctx:[#---------]9%
```

- **Model** — the active model, read straight from the harness.
- **5h / wk** — the 5-hour and weekly limit windows: percent **used** (the `#` bar) plus time left until reset.
- **session** — how long the current session has been running.
- **ctx** — percent of the context window used.

The bars change color by usage level: green (< 50%), yellow (≥ 50%), red (≥ 80%).

## Requirements

- Command Code CLI installed (`cmdc`).
- Logged in (an API key in `~/.commandcode/auth.json`), or `COMMAND_CODE_API_KEY` set in the environment.

## Installation

### Option 1 — from GitHub (recommended)

```bash
cmdc mods add p4nd4sec/commandcode-usage
```

This installs at **project** scope by default. To install for **all projects** (user scope), add `-g`:

```bash
cmdc mods add p4nd4sec/commandcode-usage -g
```

### Option 2 — manual (drop-in)

It is a single file. Download `usage-status.ts` and drop it into the mods directory:

```bash
# global — every project
cp usage-status.ts ~/.commandcode/mods/

# or just the current project
cp usage-status.ts ./.commandcode/mods/
```

The mod loads on the next session. Open the mods directory with `cmdc mods open` (add `--user` for `~/.commandcode/mods`).

### Option 3 — try it without installing

```bash
cmdc --mod ./usage-status.ts
```

`--mod` loads the file ahead of installed mods and needs no build step — jiti compiles the TypeScript at load.

## Verify

```bash
cmdc mods list
```

The readout must appear under the input line. `cmdc mods list` must show `commandcode-usage` (GitHub install) or `usage-status` (manual drop-in) with **no** load warnings. Inside a running session, type `/reload` to reload the mod.

## Configuration

| Environment variable | Meaning |
| --- | --- |
| `COMMAND_CODE_API_KEY` | API key; takes precedence over `auth.json` |
| `COMMANDCODE_API_URL` | Override the API base URL |
| `COMMANDCODE_API_ENV` | `local` \| `staging` \| `prod` (default `prod`) |
| `CMD_LOCAL_ONLY=1` | Skip the API; show only model / session / ctx |

You can also pick the environment with the CLI flags `--local` or `--staging`.

## Uninstall

```bash
cmdc mods remove p4nd4sec/commandcode-usage   # GitHub install
cmdc mods rm usage-status                     # manual drop-in file
```

## How it works

The mod registers a `below-editor` widget via `cmd.ui.widget(...)` and repaints it every 10 seconds. Model and context come straight from the harness (`cmd.getModel`, `cmd.getContextUsage`); the 5h/weekly windows come from the billing API (`/alpha/billing/credits`) authenticated with your own API key, refreshed every 60 seconds. If an API call fails, the readout keeps the last known values instead of blanking out.

## License

No license — all rights reserved by the author.
