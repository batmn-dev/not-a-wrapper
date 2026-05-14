---
name: sync-agent-skills
description: Sync skills from .agents/skills/ to tool-specific directories (.cursor/, .claude/, .codex/). Use after manually adding skills to .agents/skills/ or when symlinks are missing.
---

# Sync Agent Skills

Ensures all skills in `.agents/skills/` have symlinks in tool-specific directories.

## When to Use

Run the sync script after:
- Manually adding a new skill to `.agents/skills/`
- Cloning the repo (symlinks are not tracked in git)
- Noticing a skill isn't being picked up by a tool

## Quick Sync

```bash
./.agents/skills/sync-agent-skills/scripts/sync-skills.sh
```

## What It Does

1. Creates tool directories if missing (`.cursor/skills/`, `.claude/skills/`, `.codex/skills/`)
2. Creates symlinks from each tool directory to `.agents/skills/<skill-name>`
3. Removes broken symlinks (skills that were deleted)
4. Reports what was created/removed

## Target Directories

| Directory | Tool |
|-----------|------|
| `.cursor/skills/` | Cursor |
| `.claude/skills/` | Claude Code |
| `.codex/skills/` | OpenAI Codex |

## How It Works

The script finds the project root by walking up directories looking for `.agents/skills/`. For each skill directory found, it creates a relative symlink in each tool directory. The relative path `../../.agents/skills/<skill-name>` ensures symlinks work regardless of where the project is located on disk.

When a skill is deleted from `.agents/skills/`, the next sync run detects broken symlinks and removes them automatically.

## Adding New Tool Directories

Edit `.agents/skills/sync-agent-skills/scripts/sync-skills.sh` and add to the `TOOL_DIRS` array:

```bash
TOOL_DIRS=(".cursor/skills" ".claude/skills" ".codex/skills" ".your-tool/skills")
```

Then add the new directory to `.gitignore`:

```gitignore
.your-tool/skills/
```

## Directory Structure

```
.agents/skills/                     # SOURCE OF TRUTH (tracked in git)
├── add-ai-provider/
├── add-model/
├── convex-function/
└── sync-agent-skills/              # This skill
    ├── SKILL.md
    └── scripts/
        └── sync-skills.sh

.cursor/skills/                     # SYMLINKS (gitignored)
├── add-ai-provider -> ../../.agents/skills/add-ai-provider
├── add-model -> ../../.agents/skills/add-model
└── ...

.claude/skills/                     # SYMLINKS (gitignored)
└── (same structure)

.codex/skills/                      # SYMLINKS (gitignored)
└── (same structure)
```

## Troubleshooting

### Symlinks not working

Ensure you're running the script from within the project directory:

```bash
cd /path/to/project
./.agents/skills/sync-agent-skills/scripts/sync-skills.sh
```

### Permission denied

Make the script executable:

```bash
chmod +x .agents/skills/sync-agent-skills/scripts/sync-skills.sh
```

### Tool not finding skills

1. Check symlinks exist: `ls -la .cursor/skills/`
2. Re-run sync: `./.agents/skills/sync-agent-skills/scripts/sync-skills.sh`
3. Restart the AI tool to pick up new skills
