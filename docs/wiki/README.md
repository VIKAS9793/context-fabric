# Wiki Publishing Guide

`docs/wiki/*` is the source set for the project wiki content.

These files do not automatically populate the GitHub Wiki tab because GitHub Wikis are stored in a separate repository:

`https://github.com/<owner>/<repo>.wiki.git`

## Why the Wiki Tab Still Says "Create the first page"

That message appears when one of these is true:

- the repository wiki is not enabled in GitHub settings
- the wiki is enabled, but the separate `.wiki.git` repo has no committed pages yet

Storing markdown under `docs/wiki/` in the main repository is not enough on its own.

## How To Publish the Wiki

1. Enable the repository wiki in GitHub settings.
2. Clone the wiki repository.
3. Copy the files from `docs/wiki/` into that wiki checkout.
4. Commit and push the wiki repository.

Example:

```bash
git clone https://github.com/VIKAS9793/context-fabric.wiki.git
cd context-fabric.wiki
cp ../context-fabric/docs/wiki/Home.md ./Home.md
git add Home.md
git commit -m "docs: publish wiki home page"
git push origin main
```

On Windows PowerShell, use `Copy-Item` instead of `cp`.

## Current State

At release `v1.0.5`, the main repository contains wiki source content, but the GitHub wiki repository itself is not present yet.
