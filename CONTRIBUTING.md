# How we use git

Trunk-based development with short-lived branches and squash merges. The goal is a `main` that reads like a changelog and a branch list that only shows work in flight.

## Current exception: one branch for the Studio table redesign

Until every stage of the Studio table redesign (S2 to S6 and any sub-stage) is finished, all of that work goes on the single branch `phase/studio-redesign`, cut from `main`. Commits are prefixed with the stage (`feat(S2.4): ...`). One pull request is opened when the whole redesign is done, or earlier as a draft to run CI. Once it is merged this exception ends and the rules below apply again.

## Rules

1. **`main` is the only long-lived branch.** It always builds and passes the tests.
2. **One branch per stage or fix, cut from `main`** (or from the previous stage's branch when it truly depends on it, see Stacked work). Names: `phase/<id>-<topic>` for planned stages (for example `phase/s2-type-picker`), `fix/<topic>` for fixes, `chore/<topic>` for housekeeping.
3. **Small commits while working, one squash commit on `main`.** Commit messages follow Conventional Commits: `feat(S2.1): ...`, `fix(S1.3): ...`, `test(S1.4): ...`, `docs(S0): ...`, `chore: ...`. The pull request title becomes the squash commit, so write it as `S2: Type picker with compatible type changes (#NN)`.
4. **One pull request per stage.** The description says what changed, links the stage PRD, and carries before and after screenshots. Nothing merges without Preet's approval.
5. **Merge by squash only.** No merge commits, no rebasing of `main`, never force-push `main`.
6. **Delete the branch when its pull request merges** (GitHub: Settings, General, "Automatically delete head branches"). Local branches are pruned with `git fetch --prune` and `git branch -D` for branches whose pull request is merged (squash merges hide them from `git branch --merged`).

## Stacked work

When stage N+1 needs stage N and N is not merged yet, open N+1 with the base set to N's branch. When N is squash-merged:

```
git fetch origin
git rebase --onto origin/main <old-N-branch-tip> phase/<N+1-branch>
git push --force-with-lease
```

then change the pull request base to `main`. Keep stacks at most three deep; review and merge from the bottom up.

## Daily commands

```
git switch main && git pull --ff-only
git switch -c phase/s2-type-picker
# work, commit small
git push -u origin HEAD
gh pr create --fill           # or the API when gh pr create is blocked
```

## Housekeeping (monthly, or after a batch of merges)

```
git fetch --prune
# list local branches whose pull request is merged, then delete them
gh pr list --state merged --json headRefName -q '.[].headRefName' | sort -u > /tmp/merged.txt
git for-each-ref --format='%(refname:short)' refs/heads | grep -Fxf /tmp/merged.txt | xargs -r git branch -D
```
