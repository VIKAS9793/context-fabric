# Context Fabric — Analytics Dashboard

[![Dashboard](https://img.shields.io/badge/Dashboard-Live-10b981?labelColor=0d1117&style=for-the-badge)](https://vikas9793.github.io/context-fabric/)
[![Data Source](https://img.shields.io/badge/Data-npm_Registry-0ea5e9?labelColor=0d1117&style=for-the-badge)](https://www.npmjs.com/package/context-fabric)

---

**🔗 Live Dashboard → [vikas9793.github.io/context-fabric](https://vikas9793.github.io/context-fabric/)**

---

## What is this?

This is the **product analytics dashboard** for [Context Fabric](https://github.com/VIKAS9793/context-fabric), an MCP server for AI coding agents. It tracks real-time download metrics, GitHub traffic, and growth trends — designed with Google's **Material Design 3 Expressive** system.

## Features

| Feature | Description |
|---|---|
| 📈 **Download Trends** | Daily npm downloads with area chart and date filters |
| 📊 **Weekly Breakdown** | Bar chart of weekly download volumes |
| 👥 **GitHub Traffic** | Clones and unique visitors (14-day rolling) |
| 📉 **Cumulative Growth** | Lifetime download trajectory |
| 🎛️ **Time Filters** | 7d / 30d / 90d / All segmented buttons |
| 📤 **Export** | CSV and JSON report download |
| 🌙 **Theme Toggle** | Dark / Light mode with persistence |
| 🕐 **Live Timestamp** | Relative "last updated" with auto-refresh countdown |

## Design

Built with **M3 Expressive** principles:
- Token-driven CSS custom properties (`--md-sys-*`)
- Dark/light themes via `[data-theme]` attribute
- Staggered entrance animations with M3 emphasized easing
- Responsive layout (compact → medium → expanded)
- Chart.js 4 with M3 color palette integration

## Data Collection

Metrics are collected **daily at 00:00 UTC** by a GitHub Actions workflow ([`collect-metrics.yml`](https://github.com/VIKAS9793/context-fabric/blob/main/.github/workflows/collect-metrics.yml)) on the `main` branch. The workflow:

1. Fetches daily/weekly/monthly/total downloads from the **npm API**
2. Fetches stars, forks, issues, clones, and visitors from the **GitHub API**
3. Appends a timestamped entry to `metrics-data.json` on this branch
4. Commits and pushes automatically

## Branch Architecture

| Branch | Purpose |
|---|---|
| `main` | Source code, tests, CI/CD workflows |
| `metrics` (this branch) | Dashboard UI + data — served via GitHub Pages |

This is an **orphan branch** with zero shared history. It never contaminates the npm package or source code.

## Files

```
metrics/
├── index.html          # Dashboard page
├── styles.css          # M3 Expressive design tokens & styles
├── app.js              # Chart rendering, filters, export logic
├── metrics-data.json   # Time-series data (auto-updated daily)
└── README.md           # This file
```

---

Built by [Vikas Sahani](https://github.com/VIKAS9793) · Designed with M3 Expressive
