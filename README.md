# review-queue

A Claude Code mod that keeps a side pane of a PR's review findings and comments, so you can work them one at a time. It reads GitHub and never posts to it: you post your own replies.

## Install

At the prompt of a terminal session:

```
/plugin install review-queue --marketplace pksublime/review-queue
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```bash
claude plugin install review-queue --marketplace pksublime/review-queue
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `pksublime/review-queue`, then Add plugin.

It needs the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`.

## Use

- `/review-queue [PR number or URL]` opens the pane for that PR, or for the current branch's PR if you give none.
- `/next-comment` moves to the next open item. Claude shows the code, drafts a reply you can paste, and checks whether another open PR already addresses it.
- Findings Claude reports in a code review join the queue on their own.
- In the pane, **Refresh** re-reads GitHub, and **drop** or **undo** takes an item out of the queue or puts it back.
