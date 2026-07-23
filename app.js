/* ═══════════════════════════════════════════════════════════════════
   Context Fabric — Analytics Dashboard
   app.js — Dashboard logic, charts, filters, export
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── STATE ──────────────────────────────────────────────────────
  let metricsData = null;
  let activeRange = 30;   // default filter: 30 days
  let charts = {};

  // ─── DOM REFS ───────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── DATA LOADING ───────────────────────────────────────────────

  async function loadData() {
    try {
      const res = await fetch('metrics-data.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      metricsData = await res.json();
      render();
    } catch (err) {
      console.warn('Failed to load metrics-data.json:', err);
      showFallback();
    }
  }

  function showFallback() {
    $('#kpiTotal').textContent = '—';
    $('#kpiMonthly').textContent = '—';
    $('#kpiGrowth').textContent = '—';
    $('#kpiStars').textContent = '—';
    $('#lastUpdatedText').textContent = 'No data yet';
  }

  // ─── RENDER ─────────────────────────────────────────────────────

  function render() {
    if (!metricsData || !metricsData.entries.length) return showFallback();

    const entries = metricsData.entries.sort((a, b) => a.date.localeCompare(b.date));
    const latest = entries[entries.length - 1];

    renderKPIs(entries, latest);
    renderTimestamp(metricsData.last_updated);
    renderNextRefresh();
    renderCharts(entries);
  }

  // ─── KPI CARDS ──────────────────────────────────────────────────

  function renderKPIs(entries, latest) {
    // Total downloads
    $('#kpiTotal').textContent = formatNumber(latest.npm_total);
    $('#kpiTotalSub').textContent = 'lifetime';

    // Monthly downloads
    $('#kpiMonthly').textContent = formatNumber(latest.npm_monthly);
    $('#kpiMonthlySub').textContent = 'last 30 days';

    // Growth %
    const growth = calcGrowth(entries);
    const growthVal = growth !== null ? `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%` : '—';
    $('#kpiGrowth').textContent = growthVal;
    $('#kpiGrowthSub').textContent = 'vs previous period';

    // Stars
    $('#kpiStars').textContent = formatNumber(latest.github_stars);
    $('#kpiStarsSub').textContent = `${formatNumber(latest.github_forks)} forks · ${latest.github_open_issues} issues`;
  }

  function calcGrowth(entries) {
    if (entries.length < 2) return null;
    const curr = entries[entries.length - 1].npm_monthly;
    // Find an entry ~30 days back
    const targetDate = new Date(entries[entries.length - 1].date);
    targetDate.setDate(targetDate.getDate() - 30);
    const prev = entries.reduce((best, e) => {
      const d = new Date(e.date);
      if (!best || Math.abs(d - targetDate) < Math.abs(new Date(best.date) - targetDate)) return e;
      return best;
    }, null);
    if (!prev || prev.npm_monthly === 0) return null;
    return ((curr - prev.npm_monthly) / prev.npm_monthly) * 100;
  }

  // ─── TIMESTAMP ──────────────────────────────────────────────────

  function renderTimestamp(iso) {
    if (!iso) return;
    const d = new Date(iso);
    $('#lastUpdatedText').textContent = relativeTime(d);
    $('#lastUpdatedText').title = d.toLocaleString();
  }

  function renderNextRefresh() {
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const diffMs = nextMidnight - now;
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const el = $('#nextRefresh');
    if (el) el.textContent = `Next refresh: ${hours}h ${mins}m`;
  }

  function relativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  // ─── CHART DEFAULTS ─────────────────────────────────────────────

  function getChartColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      primary: cs.getPropertyValue('--chart-line-primary').trim(),
      secondary: cs.getPropertyValue('--chart-line-secondary').trim(),
      tertiary: cs.getPropertyValue('--chart-line-tertiary').trim(),
      barPrimary: cs.getPropertyValue('--chart-bar-primary').trim(),
      barHover: cs.getPropertyValue('--chart-bar-hover').trim(),
      grid: cs.getPropertyValue('--chart-grid').trim(),
      gradientStart: cs.getPropertyValue('--chart-gradient-start').trim(),
      gradientEnd: cs.getPropertyValue('--chart-gradient-end').trim(),
      text: cs.getPropertyValue('--md-sys-color-on-surface-variant').trim(),
    };
  }

  function chartDefaults(colors) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(30, 33, 40, 0.95)',
          titleColor: '#e2e2e8',
          bodyColor: '#c3c5d0',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          titleFont: { family: 'Inter', weight: 600, size: 13 },
          bodyFont: { family: 'Inter', size: 12 },
        },
      },
      scales: {
        x: {
          grid: { color: colors.grid, drawBorder: false },
          ticks: { color: colors.text, font: { family: 'Inter', size: 11 }, maxRotation: 0 },
        },
        y: {
          grid: { color: colors.grid, drawBorder: false },
          ticks: { color: colors.text, font: { family: 'Inter', size: 11 } },
          beginAtZero: true,
        },
      },
    };
  }

  // ─── CHART RENDERING ───────────────────────────────────────────

  function renderCharts(entries) {
    const colors = getChartColors();
    const filtered = filterByRange(entries, activeRange);

    renderDownloadsChart(filtered, colors);
    renderWeeklyChart(filtered, colors);
    renderTrafficChart(filtered, colors);
    renderCumulativeChart(entries, colors); // always show all for cumulative
  }

  function filterByRange(entries, range) {
    if (range === 'all') return entries;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - range);
    return entries.filter(e => new Date(e.date) >= cutoff);
  }

  function renderDownloadsChart(entries, colors) {
    const ctx = $('#chartDownloads').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 340);
    gradient.addColorStop(0, colors.gradientStart);
    gradient.addColorStop(1, colors.gradientEnd);

    if (charts.downloads) charts.downloads.destroy();
    charts.downloads = new Chart(ctx, {
      type: 'line',
      data: {
        labels: entries.map(e => e.date),
        datasets: [{
          label: 'Daily Downloads',
          data: entries.map(e => e.npm_daily),
          borderColor: colors.primary,
          backgroundColor: gradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: entries.length > 60 ? 0 : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: colors.primary,
          pointHoverBackgroundColor: '#fff',
          pointBorderWidth: 0,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: colors.primary,
        }],
      },
      options: chartDefaults(colors),
    });
  }

  function renderWeeklyChart(entries, colors) {
    const ctx = $('#chartWeekly').getContext('2d');

    if (charts.weekly) charts.weekly.destroy();
    charts.weekly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.date),
        datasets: [{
          label: 'Weekly Downloads',
          data: entries.map(e => e.npm_weekly),
          backgroundColor: colors.barPrimary,
          hoverBackgroundColor: colors.barHover,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 32,
        }],
      },
      options: chartDefaults(colors),
    });
  }

  function renderTrafficChart(entries, colors) {
    const ctx = $('#chartTraffic').getContext('2d');

    if (charts.traffic) charts.traffic.destroy();
    charts.traffic = new Chart(ctx, {
      type: 'line',
      data: {
        labels: entries.map(e => e.date),
        datasets: [
          {
            label: 'Clones (14d)',
            data: entries.map(e => e.github_clones_14d),
            borderColor: colors.secondary,
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            tension: 0.4,
            pointRadius: entries.length > 60 ? 0 : 3,
            pointHoverRadius: 6,
            pointBackgroundColor: colors.secondary,
          },
          {
            label: 'Unique Visitors (14d)',
            data: entries.map(e => e.github_unique_visitors_14d),
            borderColor: colors.tertiary,
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            borderDash: [6, 4],
            tension: 0.4,
            pointRadius: entries.length > 60 ? 0 : 3,
            pointHoverRadius: 6,
            pointBackgroundColor: colors.tertiary,
          },
        ],
      },
      options: {
        ...chartDefaults(colors),
        plugins: {
          ...chartDefaults(colors).plugins,
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: colors.text,
              font: { family: 'Inter', size: 11 },
              usePointStyle: true,
              pointStyleWidth: 12,
              padding: 16,
            },
          },
        },
      },
    });
  }

  function renderCumulativeChart(entries, colors) {
    const ctx = $('#chartCumulative').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 340);
    gradient.addColorStop(0, 'rgba(134, 217, 176, 0.25)');
    gradient.addColorStop(1, 'rgba(134, 217, 176, 0.0)');

    if (charts.cumulative) charts.cumulative.destroy();
    charts.cumulative = new Chart(ctx, {
      type: 'line',
      data: {
        labels: entries.map(e => e.date),
        datasets: [{
          label: 'Cumulative Downloads',
          data: entries.map(e => e.npm_total),
          borderColor: colors.secondary,
          backgroundColor: gradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointRadius: entries.length > 60 ? 0 : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: colors.secondary,
        }],
      },
      options: chartDefaults(colors),
    });
  }

  // ─── FILTER BUTTONS ─────────────────────────────────────────────

  function initFilters() {
    $$('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.seg-btn').forEach(b => b.classList.remove('seg-btn--active'));
        btn.classList.add('seg-btn--active');
        const range = btn.dataset.range;
        activeRange = range === 'all' ? 'all' : parseInt(range, 10);
        if (metricsData) {
          const entries = metricsData.entries.sort((a, b) => a.date.localeCompare(b.date));
          const colors = getChartColors();
          const filtered = filterByRange(entries, activeRange);
          renderDownloadsChart(filtered, colors);
          renderWeeklyChart(filtered, colors);
          renderTrafficChart(filtered, colors);
        }
      });
    });
  }

  // ─── THEME TOGGLE ───────────────────────────────────────────────

  function initTheme() {
    const saved = localStorage.getItem('cf-dashboard-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);

    $('#themeToggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('cf-dashboard-theme', next);
      updateThemeIcon(next);

      // Re-render charts with new color tokens
      if (metricsData) {
        const entries = metricsData.entries.sort((a, b) => a.date.localeCompare(b.date));
        renderCharts(entries);
      }
    });
  }

  function updateThemeIcon(theme) {
    $('#themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // ─── EXPORT ─────────────────────────────────────────────────────

  function initExport() {
    const modal = $('#exportModal');

    $('#exportBtn').addEventListener('click', () => modal.showModal());
    $('#exportClose').addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

    $('#exportCSV').addEventListener('click', () => {
      if (!metricsData) return;
      const headers = ['date', 'npm_daily', 'npm_weekly', 'npm_monthly', 'npm_total', 'github_stars', 'github_forks', 'github_open_issues', 'github_clones_14d', 'github_unique_visitors_14d'];
      const rows = metricsData.entries.map(e => headers.map(h => e[h] ?? '').join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      downloadFile(csv, 'context-fabric-metrics.csv', 'text/csv');
      modal.close();
    });

    $('#exportJSON').addEventListener('click', () => {
      if (!metricsData) return;
      const json = JSON.stringify(metricsData, null, 2);
      downloadFile(json, 'context-fabric-metrics.json', 'application/json');
      modal.close();
    });
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── UTILITIES ──────────────────────────────────────────────────

  function formatNumber(n) {
    if (n == null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return n.toString();
  }

  // ─── INIT ───────────────────────────────────────────────────────

  function init() {
    initTheme();
    initFilters();
    initExport();
    loadData();
    // Refresh timestamp every minute
    setInterval(() => {
      if (metricsData) renderTimestamp(metricsData.last_updated);
      renderNextRefresh();
    }, 60_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
