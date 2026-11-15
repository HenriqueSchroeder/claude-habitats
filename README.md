# claude-habitats

Living backdrops for Claude Code that grow with your session. Each scene is its own plugin, so you install only the ones you like. They all read the same signals from a shared core: what tools Claude runs, which files it edits, errors, how full the context window is, compactions, cost and the rate-limit window. Each scene keeps its world per repository, so it picks up tomorrow where it stopped today.

Backdrops are drawn by the Claude desktop app (and other surfaces that draw backdrops); the terminal ignores them.

## Plugins

| Plugin | What it is |
| --- | --- |
| `habitat-core` | The shared engine: session signals, per-repo memory and the `/habitat` command. Every scene needs it. |
| `habitat-city` | An isometric city. Every file Claude edits raises a building in the district of its top folder, and more edits make it taller. |

More scenes are on the way: a tree whose seasons follow the context window, and an anthill.

### How the city lives

| In the session | In the city |
| --- | --- |
| Claude edits a file | A building rises, or grows taller |
| Shell commands | The factory smokes harder |
| Reading and searching | The library glows |
| Web fetches and searches | A plane flies over |
| A subagent starts | A truck drives down the main road |
| A tool fails or is refused | A building catches fire |
| The context window fills | Traffic thickens and smog browns the sky |
| The conversation is compacted | Old districts turn to grey stone, the air clears |
| The five-hour usage window runs | Day turns to night (the clock's hour without a subscription) |
| Cost adds up | The far skyline lights up |

The city is kept per repository and grows across sessions.

## Install

```
/plugin install habitat-core --marketplace HenriqueSchroeder/claude-habitats
/plugin install habitat-city --marketplace HenriqueSchroeder/claude-habitats
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `HenriqueSchroeder/claude-habitats`, then Add plugin.

## Use

- `/habitat` shows the signals the scenes read right now.
- `/habitat <scene>` switches the backdrop to that scene.
- `/habitat off` takes the backdrop off, and it stays off across sessions.

## License

MIT
