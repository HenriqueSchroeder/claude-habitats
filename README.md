# claude-habitats

Living backdrops for Claude Code that grow with your session. Each scene is its own plugin, so you install only the ones you like. They all read the same signals from a shared core: what tools Claude runs, which files it edits, errors, how full the context window is, compactions, cost and the rate-limit window. Each scene keeps its world per repository, so it picks up tomorrow where it stopped today.

Backdrops are drawn by the Claude desktop app (and other surfaces that draw backdrops); the terminal ignores them.

## Plugins

| Plugin | What it is |
| --- | --- |
| `habitat-core` | The shared engine: session signals, per-repo memory and the `/habitat` command. Every scene needs it. |

More scenes are on the way: a city that builds itself from your edits, a tree whose seasons follow the context window, and an anthill.

## Install

```
/plugin install habitat-core --marketplace HenriqueSchroeder/claude-habitats
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `HenriqueSchroeder/claude-habitats`, then Add plugin.

## Use

- `/habitat` shows the signals the scenes read right now.
- `/habitat <scene>` switches the backdrop to that scene.
- `/habitat off` takes the backdrop off, and it stays off across sessions.

## License

MIT
