// The agent kinds, as lib/kinds.json has them. Written by bin/sync-shared: edit lib/kinds.json, never this.
// Shared core: core/agents.js reads it; bin/sync-shared copies it into the mods in lib/COPIES.
export const KINDS = {
  "claude": {
    "name": "Claude Code",
    "run": [
      "claude"
    ],
    "model": "--model",
    "effort": {
      "flag": "--effort",
      "style": "flag",
      "levels": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    "resume": {
      "style": "flag",
      "flag": "--resume"
    },
    "fork": "--fork-session",
    "full": [
      "--dangerously-skip-permissions"
    ],
    "perms": [
      {
        "id": "manual",
        "label": "Ask"
      },
      {
        "id": "auto",
        "label": "Auto"
      },
      {
        "id": "acceptEdits",
        "label": "Accept edits"
      },
      {
        "id": "plan",
        "label": "Plan"
      },
      {
        "id": "bypassPermissions",
        "label": "Full access"
      }
    ],
    "models": [
      {
        "id": "opus",
        "name": "Opus 5.5",
        "match": [
          "opus",
          "claude-opus-5-5"
        ]
      },
      {
        "id": "opus[1m]",
        "name": "Opus 5.5 · 1M",
        "match": [
          "opus[1m]",
          "claude-opus-5-5[1m]"
        ]
      },
      {
        "id": "claude-fable-5-1",
        "name": "Fable 5.1",
        "match": [
          "fable",
          "claude-fable-5-1"
        ]
      },
      {
        "id": "sonnet",
        "name": "Sonnet 5.5",
        "match": [
          "sonnet",
          "claude-sonnet-5-5"
        ]
      },
      {
        "id": "haiku",
        "name": "Haiku 5.5",
        "match": [
          "haiku",
          "claude-haiku-5-5"
        ]
      }
    ],
    "sessions": {
      "dir": "~/.claude/projects",
      "id": "([0-9a-f-]{36})\\.jsonl$"
    },
    "status": "settings"
  },
  "codex": {
    "name": "Codex",
    "run": [
      "codex",
      "--no-daemon"
    ],
    "model": "-m",
    "effort": {
      "flag": "model_reasoning_effort",
      "style": "config",
      "levels": [
        "low",
        "medium",
        "high",
        "xhigh"
      ]
    },
    "resume": {
      "style": "sub",
      "sub": "resume"
    },
    "fork": null,
    "full": [
      "--dangerously-bypass-approvals-and-sandbox"
    ],
    "perms": [
      {
        "id": "read-only",
        "label": "Read only"
      },
      {
        "id": "auto",
        "label": "Auto"
      },
      {
        "id": "full",
        "label": "Full access"
      }
    ],
    "models": [],
    "sessions": {
      "dir": "~/.codex/sessions",
      "id": "rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.jsonl$"
    },
    "status": "hook"
  },
  "pi": {
    "name": "Pi",
    "run": [
      "pi"
    ],
    "model": "--model",
    "effort": {
      "flag": "--thinking",
      "style": "flag",
      "levels": [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    "resume": {
      "style": "flag",
      "flag": "--session"
    },
    "fork": "--fork",
    "full": [],
    "perms": [],
    "models": [
      {
        "id": "clawrouter/claude-opus-5-5-200k",
        "name": "Opus 5.5 · ClawRouter"
      },
      {
        "id": "clawrouter/claude-fable-5-1",
        "name": "Fable 5.1 · ClawRouter"
      },
      {
        "id": "clawrouter/claude-haiku-5-5-100k",
        "name": "Haiku 5.5 · ClawRouter"
      },
      {
        "id": "clawrouter/gpt-6.1-sol",
        "name": "GPT-6.1 Sol · ClawRouter"
      },
      {
        "id": "clawrouter/gpt-6-luna",
        "name": "GPT-6 Luna · ClawRouter"
      },
      {
        "id": "clawrouter/xai/grok-4.6",
        "name": "Grok 4.6 · ClawRouter"
      }
    ],
    "defaultEffort": "medium",
    "sessions": {
      "dir": "~/.pi/agent/sessions",
      "byCwd": true,
      "id": "_([0-9a-f-]{36})\\.jsonl$"
    },
    "status": "none"
  },
  "pii": {
    "name": "Pi (fork)",
    "run": [
      "pii"
    ],
    "model": "--model",
    "effort": {
      "flag": "--thinking",
      "style": "flag",
      "levels": [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    "resume": {
      "style": "flag",
      "flag": "--session"
    },
    "fork": "--fork",
    "full": [],
    "perms": [],
    "models": [
      {
        "id": "clawrouter/claude-opus-5-5-200k",
        "name": "Opus 5.5 · ClawRouter"
      },
      {
        "id": "clawrouter/claude-fable-5-1",
        "name": "Fable 5.1 · ClawRouter"
      },
      {
        "id": "clawrouter/claude-haiku-5-5-100k",
        "name": "Haiku 5.5 · ClawRouter"
      },
      {
        "id": "clawrouter/gpt-6.1-sol",
        "name": "GPT-6.1 Sol · ClawRouter"
      },
      {
        "id": "clawrouter/gpt-6-luna",
        "name": "GPT-6 Luna · ClawRouter"
      },
      {
        "id": "clawrouter/xai/grok-4.6",
        "name": "Grok 4.6 · ClawRouter"
      }
    ],
    "defaultEffort": "medium",
    "sessions": {
      "dir": "~/.pi/pii/sessions",
      "byCwd": true,
      "id": "_([0-9a-f-]{36})\\.jsonl$"
    },
    "status": "none"
  },
  "grok": {
    "name": "Grok",
    "run": [
      "grok"
    ],
    "model": "--model",
    "effort": {
      "flag": "--reasoning-effort",
      "style": "flag",
      "levels": [
        "low",
        "medium",
        "high"
      ]
    },
    "resume": {
      "style": "flag",
      "flag": "--resume"
    },
    "fork": {
      "flag": "--fork-session",
      "style": "switch"
    },
    "full": [
      "--always-approve"
    ],
    "perms": [
      {
        "id": "manual",
        "label": "Ask"
      },
      {
        "id": "full",
        "label": "Full access"
      }
    ],
    "models": [],
    "sessions": null,
    "status": "none"
  },
  "hermes": {
    "name": "Hermes",
    "run": [
      "hermes"
    ],
    "model": "-m",
    "effort": {
      "flag": "--reasoning",
      "style": "flag",
      "levels": [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra"
      ]
    },
    "resume": {
      "style": "flag",
      "flag": "--resume"
    },
    "fork": null,
    "full": [
      "--yolo"
    ],
    "perms": [
      {
        "id": "manual",
        "label": "Ask"
      },
      {
        "id": "full",
        "label": "Full access"
      }
    ],
    "models": [],
    "sessions": null,
    "status": "none"
  },
  "amp": {
    "name": "Amp",
    "run": [
      "amp"
    ],
    "model": null,
    "effort": {
      "flag": "--mode",
      "style": "flag",
      "levels": [
        "low",
        "medium",
        "high",
        "ultra"
      ]
    },
    "resume": {
      "style": "thread",
      "sub": [
        "threads",
        "continue"
      ]
    },
    "fork": null,
    "full": [],
    "perms": [],
    "models": [],
    "sessions": null,
    "status": "none"
  },
  "cursor": {
    "name": "Cursor",
    "run": [
      "cursor-agent"
    ],
    "model": "--model",
    "effort": {
      "flag": null,
      "style": "bracket",
      "levels": [
        "low",
        "medium",
        "high"
      ]
    },
    "resume": {
      "style": "flag",
      "flag": "--resume"
    },
    "fork": null,
    "full": [],
    "perms": [
      {
        "id": "manual",
        "label": "Ask"
      },
      {
        "id": "plan",
        "label": "Plan"
      }
    ],
    "models": [],
    "sessions": null,
    "status": "none"
  }
};
