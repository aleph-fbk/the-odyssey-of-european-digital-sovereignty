/* European Digital Sovereignty Atlas — app logic */
(function () {
  'use strict';

  const DATA = window.INITIATIVE_DATA;

  // ---------------------------------------------------------------------------
  // Derived lookup tables
  // ---------------------------------------------------------------------------
  const byId = {};
  DATA.initiatives.forEach((i) => (byId[i.id] = i));
  const fwById = {};
  DATA.frameworks.forEach((f) => (fwById[f.id] = f));
  const domById = {};
  DATA.domains.forEach((d) => (domById[d.id] = d));
  const orgById = {};
  DATA.orgs.forEach((o) => (orgById[o.id] = o));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Status order for legend / default sorting
  const STATUS_ORDER = ['adopted', 'proposed', 'draft', 'scheduled', 'launched'];

  // Parse a YAML-ish date "2020-02" / 2022 / "2026-06" into numeric fraction [0..1] within [2019, 2028]
  const T0 = 2019, T1 = 2028;
  function dateToTicker(dateStr) {
    const s = String(dateStr);
    const m = s.match(/(\d{4})(?:-(\d{1,2}))?/);
    if (!m) return null;
    const y = +m[1], mo = m[2] ? +m[2] : 6;
    return (y - T0) + (mo - 1) / 12;
  }
  // main date used for chronological ordering
  function primaryDate(init) {
    const d = init.dates || {};
    // preference order: proposed > published (for future-dated items), fallback any
    const cand = [d.proposed, d.published, d.entered_into_force, d.entered_into_application].filter(Boolean);
    if (cand.length === 0) return null;
    // For adopted instruments, "published" is the actual launch date; use it. For
    // proposals, "proposed" is the relevant date.
    if (init.status === 'proposed' && d.proposed) return d.proposed;
    if (d.published) return d.published;
    return cand[0];
  }
  function dateLabel(dateStr) {
    if (dateStr == null) return '';
    const s = String(dateStr);
    const m = s.match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) return s;
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let out = String(m[1]);
    if (m[2]) {
      const mo = +m[2];
      out = months[mo] + ' ' + m[1];
      if (m[3]) out = m[3] + ' ' + out;
    }
    return out;
  }

  // All distinct metadata
  const allDomains = DATA.domains.map((d) => d.id);
  // full official taxonomy is always shown, even if no initiative of that type exists yet
  const typeOrder = ['Regulation', 'Decision', 'Directive', 'Communication', 'Recommendation', 'Bundles'];
  const allTypes = typeOrder.filter((t) => t in DATA.type_definitions);

  // Overarching category filters
  const TYPE_CATEGORIES = {
    'Binding': ['Regulation', 'Decision', 'Directive'],
    'Non-Binding': ['Communication', 'Recommendation']
  };
  const allStatuses = DATA.initiatives.reduce((acc, i) => (acc.includes(i.status) ? acc : acc.concat(i.status)), []);
  allStatuses.sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b));

  const domainOf = (domId) => (domById[domId] ? domById[domId].name : domId);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    view: 'timeline',
    filters: { domain: new Set(), status: new Set(), type: new Set(), relations: new Set() },
    search: '',
    focused: null,
    lcK: 1, // lifecycle horizontal zoom level
  };

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const viewTimeline = $('view-timeline');  const viewGraph = $('view-graph');
  const viewLifecycle = $('view-lifecycle');
  const viewFrameworks = $('view-frameworks');
  const viewStats = $('view-stats');
  const detail = $('detail');

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------
  function matchesFilters(i) {
    if (state.filters.domain.size && !state.filters.domain.has(i.domain)) return false;
    if (state.filters.status.size && !state.filters.status.has(i.status)) return false;
    if (state.filters.type.size && !state.filters.type.has(i.type)) {
      const matchesCategory = Object.entries(TYPE_CATEGORIES).some(
        ([cat, members]) => state.filters.type.has(cat) && members.includes(i.type)
      );
      if (!matchesCategory) return false;
    }
    if (state.search) {
      const hay = (i.name + ' ' + (i.acronym || '') + ' ' + (i.description || '') + ' ' + domainOf(i.domain)).toLowerCase();
      if (!hay.includes(state.search.toLowerCase())) return false;
    }
    return true;
  }
  function visibleInitiatives() {
    return DATA.initiatives.filter(matchesFilters);
  }

  // ---------------------------------------------------------------------------
  // Chip bars
  // ---------------------------------------------------------------------------
  function buildGroupedTypeChips(containerId, group) {
    const wrap = $(containerId);
    wrap.innerHTML = '';
    const layout = [
      { heading: 'Binding', chips: ['Binding', 'Regulation', 'Decision', 'Directive'] },
      { heading: 'Non-Binding', chips: ['Non-Binding', 'Communication', 'Recommendation'] },
      { heading: null, chips: ['Bundles'] }
    ];
    layout.forEach((section) => {
      const box = document.createElement('div');
      box.className = 'chip-box';
      if (section.heading) {
        const h = document.createElement('span');
        h.className = 'chip-box-heading';
        h.textContent = section.heading;
        box.appendChild(h);
      }
      const category = section.heading;
      section.chips.forEach((v) => {
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = v;
        chip.dataset.value = v;
        chip.addEventListener('click', () => {
          const set = state.filters[group];
          const isCategory = category && v === category;
          if (isCategory) {
            const turningOn = !set.has(v);
            section.chips.forEach((cv) => {
              if (turningOn) set.add(cv); else set.delete(cv);
            });
          } else {
            if (set.has(v)) set.delete(v); else set.add(v);
          }
          updateChipState();
          refresh();
        });
        box.appendChild(chip);
      });
      wrap.appendChild(box);
    });
    updateChipState();
  }
  function buildChips(containerId, values, group, labelFn) {
    const wrap = $(containerId);
    wrap.innerHTML = '';
    values.forEach((v) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = labelFn ? labelFn(v) : v;
      chip.dataset.value = v;
      chip.addEventListener('click', () => toggleChip(group, v, chip));
      wrap.appendChild(chip);
    });
    updateChipState();
  }
  function toggleChip(group, value, chipEl) {
    const set = state.filters[group];
    if (set.has(value)) set.delete(value);
    else set.add(value);
    chipEl.classList.toggle('on', set.has(value));
    refresh();
  }
  function updateChipState() {
    const ids = { domain: 'domain-chips', status: 'status-chips', type: 'type-chips', relations: 'relation-chips' };
    ['domain', 'status', 'type', 'relations'].forEach((g) => {
      const wrap = $(ids[g]);
      if (!wrap) return;
      wrap.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('on', state.filters[g].has(c.dataset.value));
      });
    });
    setFilterLabels();
  }
  function clearAll() {
    state.filters = { domain: new Set(), status: new Set(), type: new Set(), relations: new Set() };
    state.search = '';
    $('search').value = '';
    closeSearch();
    updateChipState();
    refresh();
  }
  $('clear-filters').addEventListener('click', clearAll);

  // show an active-count on each filter group label (e.g. "Domain (2)")
  function setFilterLabels() {
    document.querySelectorAll('.filter-group').forEach((grp) => {
      const g = grp.dataset.group;
      const n = state.filters[g] ? state.filters[g].size : 0;
      const text = grp.querySelector('.fl-text');
      if (!text) return;
      if (!text.dataset.base) text.dataset.base = text.textContent;
      const base = text.dataset.base;
      text.textContent = n ? base + ' (' + n + ')' : base;
    });
  }

  // collapsible whole filter bar
  function setupFilterToggle() {
    const btn = $('filter-toggle');
    const bar = document.querySelector('.filterbar');
    if (!btn || !bar) return;
    const update = () => btn.setAttribute('aria-expanded', String(!bar.classList.contains('collapsed')));
    btn.addEventListener('click', () => { bar.classList.toggle('collapsed'); update(); });
    setupFilterToggleLabels();
  }
  function setupFilterToggleLabels() {
    // prime the base label for each group (first call uses the clean label)
    document.querySelectorAll('.filter-group').forEach((grp) => {
      const text = grp.querySelector('.fl-text');
      if (text && !text.dataset.base) text.dataset.base = text.textContent;
    });
    setFilterLabels();
  }

  // ---------------------------------------------------------------------------
  // Refresh orchestrator
  // ---------------------------------------------------------------------------
  function refresh() {
    const n = visibleInitiatives().length;
    $('count').textContent = n + ' initiative' + (n === 1 ? '' : 's');
    if (state.view === 'timeline') renderTimeline();
    if (state.view === 'graph') renderGraph();
    if (state.view === 'lifecycle') renderLifecycle();
    if (state.view === 'frameworks') renderFrameworks();
    if (state.view === 'stats') renderStats();
    if (state.focused && !matchesFilters(byId[state.focused])) closeDetail();
  }

  // ---------------------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------------------
  let tlK = 1;
  let tlLayout = null; // { yearPos, yearRows, rowStep, yearGap, height } from the last render
  const TL_MARGIN = { top: 6, right: 24, bottom: 6, left: 24 };
  const TL_YEAR_PX = 460;
  const TL_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function tlScaleAt(k) {
    const baseW = (T1 - T0 - 1) * TL_YEAR_PX;
    return d3.scaleLinear().domain([0, T1 - T0]).range([0, k * baseW]);
  }
  function tlZoomBy(factor) {
    const nextK = Math.min(4, Math.max(0.5, tlK * factor));
    if (nextK === tlK) return;
    const vw = Math.max(320, tlWrap.clientWidth);
    const oldScale = tlScaleAt(tlK);
    const anchorPx = tlWrap.scrollLeft + vw / 2 - TL_MARGIN.left;
    const anchorT = oldScale.invert(anchorPx);
    // find which year band sits at the vertical centre of the viewport so the
    // zoom can keep it centred (renderTimeline rebuilds the DOM, which would
    // otherwise snap the view back to the top)
    const vh = tlWrap.clientHeight;
    let anchorYear = null;
    if (tlLayout) {
      const { yearPos, yearRows, rowStep, yearGap } = tlLayout;
      const years = Object.keys(yearPos).map(Number).sort((a, b) => a - b);
      const centerY = tlWrap.scrollTop + vh / 2;
      anchorYear = years.find((yr) => {
        const start = yearPos[yr];
        const end = start + yearRows[yr] * rowStep + yearGap;
        return centerY >= start && centerY <= end;
      }) ?? null;
      if (anchorYear == null && years.length) {
        let best = years[0], bestD = Infinity;
        years.forEach((yr) => {
          const mid = yearPos[yr] + yearRows[yr] * rowStep / 2;
          const d = Math.abs(mid - centerY);
          if (d < bestD) { bestD = d; best = yr; }
        });
        anchorYear = best;
      }
    }
    tlK = nextK;
    renderTimeline();
    const newScale = tlScaleAt(tlK);
    tlWrap.scrollLeft = Math.max(0, newScale(anchorT) + TL_MARGIN.left - vw / 2);
    if (tlLayout && anchorYear != null && tlLayout.yearPos[anchorYear] != null) {
      const { yearPos, yearRows, rowStep } = tlLayout;
      const target = yearPos[anchorYear] + yearRows[anchorYear] * rowStep / 2 - vh / 2;
      tlWrap.scrollTop = Math.max(0, Math.min(tlWrap.scrollHeight - vh, target));
    }
  }
  function tlZoomReset() {
    tlK = 1;
    renderTimeline();
    tlWrap.scrollTop = 0;
    tlWrap.scrollLeft = 0;
  }
  function lcZoomBy(factor) {
    const nextK = Math.min(4, Math.max(0.5, state.lcK * factor));
    if (nextK === state.lcK || state.view !== 'lifecycle') return;
    state.lcK = nextK;
    renderLifecycle();
  }
  function lcZoomReset() {
    state.lcK = 1;
    if (state.view === 'lifecycle') renderLifecycle();
  }
  // the initiatives a bundle "comprises": the non-Bundle initiatives it lists
  // in its own relates_to (nested bundles are excluded).
  function bundleMembers(bnd) {
    return (bnd.relates_to || []).filter((id) => {
      const t = byId[id];
      return t && t.type !== 'Bundles';
    });
  }

  function renderTimeline() {
    const vis = visibleInitiatives();
    // points: every non-Bundle instrument, plus Bundles that have no members
    // (a memberless bundle is just a point, not a grouping bracket)
    const items = vis
      .filter((i) => i.type !== 'Bundles' || bundleMembers(i).length === 0)
      .map((i) => ({ init: i, t: dateToTicker(primaryDate(i)) }))
      .filter((x) => x.t != null)
      .sort((a, b) => a.t - b.t || STATUS_ORDER.indexOf(a.init.status) - STATUS_ORDER.indexOf(b.init.status));
    // bundle brackets: Bundles that actually comprise at least one member
    const bundles = vis
      .filter((i) => i.type === 'Bundles' && bundleMembers(i).length > 0)
      .map((i) => ({ init: i, t: dateToTicker(primaryDate(i)) }))
      .filter((x) => x.t != null)
      .sort((a, b) => a.t - b.t);

    tlWrap.innerHTML = '';
    const empty = $('timeline-empty');
    if (!items.length && !bundles.length) { empty.hidden = false; return; }
    empty.hidden = true;

    const margin = TL_MARGIN;
    const vw = Math.max(320, tlWrap.clientWidth);

    const yearOf = (t) => Math.floor(t);

    // --- Lane layout: points stay on a single row per year unless their labels
    // --- would overlap horizontally; only then do they drop to a lower row. ---
    const byYear = {};
    items.forEach((it) => { (byYear[yearOf(it.t)] = byYear[yearOf(it.t)] || []).push(it); });
    const yearList = Object.keys(byYear).map(Number).sort((a, b) => a - b);

    const baseW = (T1 - T0 - 1) * TL_YEAR_PX;
    const W = tlK * baseW;
    const x = d3.scaleLinear().domain([0, T1 - T0]).range([0, W]);

    const textW = (d) => Math.max(22, (String(d.init.acronym || d.init.name).length) * 7.5);
    // assign each item a row within its year so labels never overlap on the same row
    const laneOf = {};
    const yearRows = {};
    yearList.forEach((yr) => {
      const grp = byYear[yr].slice().sort((a, b) => x(a.t) - x(b.t));
      const rowX1 = [];
      grp.forEach((it) => {
        const x0 = x(it.t) - textW(it) / 2;
        const x1 = x(it.t) + textW(it) / 2;
        let r = 0;
        while ((rowX1[r] != null ? rowX1[r] : -Infinity) > x0) r++;
        rowX1[r] = x1;
        laneOf[it.init.id] = r;
      });
      yearRows[yr] = rowX1.length;
    });

    const rowStep = 46;      // vertical px per row within a year
    const yearGap = 40;      // gap between year bands
    const yearPos = {};
    let yc = 0;
    yearList.forEach((yr) => { yearPos[yr] = yc; yc += yearRows[yr] * rowStep + yearGap; });
    const height = Math.max(120, yc);
    tlLayout = { yearPos, yearRows, rowStep, yearGap, height };

    const yFor = (d) => yearPos[yearOf(d.t)] + laneOf[d.init.id] * rowStep + rowStep / 2;

    const totalW = W + margin.left + margin.right;
    const totalH = height + margin.top + margin.bottom;
    const AXIS_H = 62;
    const AXIS_TOPY = 46;

    // sticky time-axis header (stays fixed when scrolling down)
    const header = d3.select(tlWrap).append('div').attr('class', 'tl-header').style('width', totalW + 'px');
    const headerSvg = header.append('svg').attr('width', totalW).attr('height', AXIS_H);
    const headerG = headerSvg.append('g').attr('class', 'tl-axis').attr('transform', `translate(${margin.left},${AXIS_TOPY})`);

    // month ticks: Month labels are thinned out as you zoom out so they never
    // overlap. January is the year anchor and is always shown (bold year above),
    // and the other months (including December) are kept only while they fit
    // between the previous label and the next January.
    const monthIdx = (tk) => Math.round((tk - Math.floor(tk)) * 12) + 1;
    const minMonthPx = 32;
    const tickVals = [];
    let lastMonthX = -Infinity;
    for (let y = T0; y <= T1; y++) {
      const janTk = (y - T0) + 0;
      if (janTk >= -0.001 && janTk <= (T1 - T0) + 0.001) {
        tickVals.push(janTk);
        lastMonthX = x(janTk);
      }
      const nextJanX = y < T1 ? x((y - T0) + 1) : Infinity;
      for (let m = 2; m <= 12; m++) {
        const tk = (y - T0) + (m - 1) / 12;
        if (tk < -0.001 || tk > (T1 - T0) + 0.001) continue;
        const px = x(tk);
        if (px - lastMonthX >= minMonthPx && nextJanX - px >= minMonthPx) {
          tickVals.push(tk);
          lastMonthX = px;
        }
      }
    }
    const headAxis = d3.axisTop(x)
      .tickValues(tickVals)
      .tickSize(4)
      .tickFormat((tk) => TL_MONTHS[monthIdx(tk)]);
    headerG.call(headAxis);
    // bold year labels centred above each January
    headerG.selectAll('.tl-year-label')
      .data(d3.range(T0, T1 + 1))
      .join('text')
      .attr('class', 'tl-year-label')
      .attr('x', (y) => x(y - T0))
      .attr('y', -24)
      .attr('text-anchor', 'middle')
      .text((y) => y);

    // body holds the chart; scrolls under the sticky header
    const body = d3.select(tlWrap).append('div').attr('class', 'tl-body').style('width', totalW + 'px');
    const svg = body.append('svg').attr('width', totalW).attr('height', totalH);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // year track lines
    const tracks = g.append('g').selectAll('line')
      .data(yearList)
      .join('line')
      .attr('class', 'tl-track')
      .attr('x1', 0).attr('x2', W)
      .attr('y1', (yr) => yearPos[yr] + rowStep / 2)
      .attr('y2', (yr) => yearPos[yr] + rowStep / 2);

    // dashed connecting path through the row midpoints
    const drawPath = () => {
      const pts = yearList.map((yr) => [x(yr - T0), yearPos[yr] + rowStep / 2]);
      dashPath.attr('d', pts.length ? 'M' + pts.map((p, i2) => (i2 === 0 ? `${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ') : '');
    };
    const dashPath = g.append('path')
      .attr('class', 'tl-dashed')
      .attr('fill', 'none')
      .attr('stroke', 'var(--stroke-2)');

    // --- Bundle grouping: a dashed bracket above each member ----------------
    // A bundle (Package/Omnibus/Action Plan) is shown as a dashed horizontal bar
    // placed above the initiatives it *comprises* (its own relates_to list),
    // with a small vertical tick dropping down to each actual member. The bundle
    // acronym/name label sits on the bar. Because only the bar and the ticks to
    // real members are drawn, an unrelated initiative that merely sits between
    // members (e.g. DORA within the AI Innovation Package) is never enclosed.
    // A standalone bundle (no members) is drawn as a compact box at its own date.
    const memberPos = (id) => {
      const m = byId[id];
      const mt = m ? dateToTicker(primaryDate(m)) : null;
      if (m == null || mt == null || laneOf[id] == null) return null;
      const yr = yearOf(mt);
      const py = (yearPos[yr] != null ? yearPos[yr] : 0) + laneOf[id] * rowStep + rowStep / 2;
      return { x: x(mt), y: py, id };
    };

    bundles.forEach((b) => {
      const bid = b.init.id;
      const members = bundleMembers(b.init)
        .map((id) => memberPos(id))
        .filter(Boolean)
        .sort((a, c) => a.x - c.x);

      const bg = g.append('g')
        .attr('class', 'tl-bundle')
        .attr('data-id', bid)
        .style('cursor', 'pointer')
        .on('click', (ev) => {
          ev.stopPropagation();
          openDetail(bid);
        });

      const BAR_STUB = 4, BAR_OFF = 34, TICK_TOP = 16;
      const x0 = members[0].x, x1 = members[members.length - 1].x;
      const barY = Math.min(...members.map((m) => m.y)) - BAR_OFF;
      bg.append('line')
        .attr('class', 'tl-bundle-bar')
        .attr('x1', x0).attr('y1', barY).attr('x2', x1).attr('y2', barY);
      // short end-stubs to read as a grouping bracket
      bg.append('line').attr('class', 'tl-bundle-bar')
        .attr('x1', x0).attr('y1', barY - BAR_STUB).attr('x2', x0).attr('y2', barY + BAR_STUB);
      bg.append('line').attr('class', 'tl-bundle-bar')
        .attr('x1', x1).attr('y1', barY - BAR_STUB).attr('x2', x1).attr('y2', barY + BAR_STUB);
      // a tick down to each actual member
      members.forEach((mp) => {
        bg.append('line')
          .attr('class', 'tl-bundle-bar')
          .attr('x1', mp.x).attr('y1', barY).attr('x2', mp.x).attr('y2', mp.y - TICK_TOP);
      });
      const labelCx = (x0 + x1) / 2;
      const labelCy = barY - 6;

      bg.append('text')
        .attr('class', 'tl-bundle-label')
        .attr('x', labelCx).attr('y', labelCy)
        .attr('text-anchor', 'middle')
        .text(b.init.acronym || b.init.name);

      const tip = bundleTip;
      bg.on('mouseenter', function (ev) {
        d3.select(this).classed('hover', true);
        const mnames = bundleMembers(b.init).map((id) => byId[id].acronym || byId[id].name);
        tip.hidden = false;
        tip.style.left = (ev.pageX + 14) + 'px';
        tip.style.top = (ev.pageY - 6) + 'px';
        tip.innerHTML = `<strong>${escapeHtml(b.init.acronym || b.init.name)}</strong><br>comprises: ${escapeHtml(mnames.join(', ') || '—')}`;
      }).on('mousemove', (ev) => {
        tip.style.left = (ev.pageX + 14) + 'px';
        tip.style.top = (ev.pageY - 6) + 'px';
      }).on('mouseleave', function () {
        d3.select(this).classed('hover', false);
        tip.hidden = true;
      });
    });

    // nodes
    const node = g.append('g')
      .selectAll('g')
      .data(items, (d) => d.init.id)
      .join('g')
      .attr('class', (d) => 'tl-node dm-' + d.init.domain)
      .attr('data-id', (d) => d.init.id)
      .attr('transform', (d) => `translate(${x(d.t)},${yFor(d)})`)
      .style('cursor', 'pointer')
      .on('click', (ev, d) => {
        if (Date.now() - tlPanAt < 250) { tlPanAt = 0; return; }
        ev.stopPropagation();
        node.classed('focused', false);
        d3.select(ev.currentTarget).classed('focused', true);
        openDetail(d.init.id);
      });

    // labels above each node (points on the same row already have non-overlapping
    // labels thanks to the lane assignment, so a fixed offset is enough)
    node.insert('text', ':first-child')
      .append('tspan')
      .attr('x', 0).attr('dy', -16).attr('text-anchor', 'middle')
      .text((d) => d.init.acronym || d.init.name);

    node.append('circle')
      .attr('class', (d) => 'tl-circle st-' + d.init.status)
      .attr('r', 7);

    const lvl = $('zoom-level');
    if (lvl) lvl.textContent = Math.round(tlK * 100) + '%';

    drawPath();
  }

  // ---------------------------------------------------------------------------
  // Dependency graph
  // ---------------------------------------------------------------------------
  let graphSim = null;
  let graphUserMoved = false;   // once the user pans/drags, stop auto-fitting the view
  function renderGraph() {
    const items = visibleInitiatives();
    graphUserMoved = false;

    const nodes = items.map((i) => ({
      id: i.id,
      init: i,
      r: 6 + Math.min(8, (i.builds_on.length + i.relates_to.length + (i.amends || []).length + (i.replaces || []).length) / 2),
    }));

    const links = [];
    const nodeById = {};
    nodes.forEach((n) => (nodeById[n.id] = n));
    const relFilter = state.filters.relations || new Set();
    items.forEach((i) => {
      if (!relFilter.size || relFilter.has('builds')) {
        (i.builds_on || []).forEach((t) => {
          if (nodeById[t]) links.push({ source: nodeById[i.id], target: nodeById[t], kind: 'builds' });
        });
      }
      if (!relFilter.size || relFilter.has('relates')) {
        (i.relates_to || []).forEach((t) => {
          if (nodeById[t]) links.push({ source: nodeById[i.id], target: nodeById[t], kind: 'relates' });
        });
      }
      if (!relFilter.size || relFilter.has('amends')) {
        (i.amends || []).forEach((t) => {
          if (nodeById[t]) links.push({ source: nodeById[i.id], target: nodeById[t], kind: 'amends' });
        });
      }
      if (!relFilter.size || relFilter.has('replaces')) {
        (i.replaces || []).forEach((t) => {
          if (nodeById[t]) links.push({ source: nodeById[i.id], target: nodeById[t], kind: 'replaces' });
        });
      }
    });

    // give reciprocal edge pairs (A->B and B->A) straight lines that overlap, by
    // design: all edges are drawn straight regardless of reciprocity
    tlWrap_graph.innerHTML = '';
    const vw = Math.max(320, tlWrap_graph.clientWidth);
    const vh = Math.max(320, tlWrap_graph.clientHeight);

    // large backing canvas so panning can reveal nodes far from the centre
    const CW = 6000, CH = 4200;

    const svg = d3.select(tlWrap_graph)
      .append('svg')
      .attr('width', CW)
      .attr('height', CH)
      .style('cursor', 'grab');

    const defs = svg.append('defs');
    const arrow = defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#5b6c92');

    const g = svg.append('g');

    const link = g.append('g').attr('class', 'links')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('class', (d) => 'link link-' + d.kind)
      .attr('fill', 'none')
      .attr('marker-end', 'url(#arrow)');

    const edgeLabel = g.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('class', 'edge-label')
      .attr('text-anchor', 'middle')
      .text((d) => ({ builds: 'builds on', relates: 'relates', amends: 'amends', replaces: 'replaces' }[d.kind] || d.kind))
      .attr('pointer-events', 'none');

    const linkPath = (d) => {
      const x1 = d.source.x, y1 = d.source.y, x2 = d.target.x, y2 = d.target.y;
      return `M${x1},${y1}L${x2},${y2}`;
    };
    const linkLabelPos = (d) => {
      const mx = (d.source.x + d.target.x) / 2, my = (d.source.y + d.target.y) / 2;
      return `translate(${mx},${my})`;
    };

    const node = g.append('g').attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', (d) => 'node dm-' + d.init.domain)
      .call(d3.drag()
        .on('start', (ev, d) => { graphUserMoved = true; if (!ev.active) graphSim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) graphSim.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on('click', (ev, d) => {
        ev.stopPropagation();
        g.selectAll('.node').classed('focused', false);
        d3.select(ev.currentTarget).classed('focused', true);
        graphFocus(d.init.id);
        openDetail(d.init.id);
      });

    node.append('circle')
      .attr('class', 'hit')
      .attr('r', (d) => d.r + 14)
      .attr('fill', 'transparent');

    node.append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => colorFor(d.init.domain));

    node.append('text')
      .attr('dy', -12)
      .attr('text-anchor', 'middle')
      .text((d) => d.init.acronym || d.init.name);

    // cluster nodes by domain across a central band of the canvas (leaving the
    // outer band free so panning has somewhere to go)
    const domains = [...new Set(nodes.map((n) => n.init.domain))];
    const bandW = Math.min(3000, CW * 0.5);
    const bandX = (CW - bandW) / 2;
    const xPos = {};
    domains.forEach((dom, i) => {
      xPos[dom] = bandX + (i + 0.5) * bandW / domains.length;
    });

    // legend of the vertex domain colours
    const legendEl = document.getElementById('graph-legend');
    if (legendEl) {
      legendEl.innerHTML = '<span class="lg-title">Domain</span>';
      const frag = document.createDocumentFragment();
      domains.forEach((dom) => {
        const item = document.createElement('span');
        item.className = 'lg-item';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colorFor(dom);
        const label = document.createTextNode(dom.split('-').map((w) => {
          const W = w.toUpperCase();
          return /^(AI|EE|EU|API|TLS|IOT)$/.test(W) ? W : W.charAt(0) + w.slice(1);
        }).join(' '));
        item.append(dot, label);
        frag.append(item);
      });
      legendEl.append(frag);
      legendEl.hidden = false;
    }

    graphSim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(120).strength((d) => (d.kind === 'builds' ? 0.85 : 0.2)))
      .force('charge', d3.forceManyBody().strength(-600))
      .force('x', d3.forceX((d) => xPos[d.init.domain]).strength(0.12))
      .force('y', d3.forceY(CH / 2).strength(0.06))
      .force('collide', d3.forceCollide().radius((d) => d.r + 30))
      .on('tick', () => {
        link.attr('d', linkPath);
        edgeLabel.attr('transform', linkLabelPos);
        node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });

    graphCurrent = { node, link, g, vw, vh };

    const zoom = d3.zoom()
      .scaleExtent([0.15, 6])
      .on('start', (ev) => { if (ev.sourceEvent) { graphUserMoved = true; svg.style('cursor', 'grabbing'); } })
      .on('end', () => svg.style('cursor', 'grab'))
      .on('zoom', (ev) => { g.attr('transform', ev.transform); });
    svg.call(zoom)
      .on('dblclick.zoom', null)
      .on('click', () => {
        g.selectAll('.node').classed('focused', false);
        graphFocus(null);
      });
    // fit the graph into the viewport once the layout has settled, unless the
    // user has already started panning/zooming/dragging on their own
    const fitGraph = () => {
      if (graphUserMoved || !nodes.length) return;
      const bx = d3.extent(nodes, (d) => d.x);
      const by = d3.extent(nodes, (d) => d.y);
      if (bx[0] == null || bx[0] === bx[1] && by[0] === by[1]) return;
      const pad = 70;
      const w = Math.max(bx[1] - bx[0] + pad * 2, 1);
      const h = Math.max(by[1] - by[0] + pad * 2, 1);
      const s = Math.min(vw / w, vh / h, 2);
      const tx = vw / 2 - s * (bx[0] + bx[1]) / 2;
      const ty = vh / 2 - s * (by[0] + by[1]) / 2;
      svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
    };
    // show the canvas-centre band immediately (before the sim settles)
    svg.call(zoom.transform, d3.zoomIdentity.translate(vw / 2 - CW / 2, vh / 2 - CH / 2));
    graphSim.on('end', fitGraph);
    setTimeout(fitGraph, 3500); // reliable fallback if the sim never "ends"
  }

  // module-level access to current graph selections for cross-view focus
  let graphCurrent = null;
  function graphFocus(id) {
    if (!graphCurrent) return;
    const { node, link, g } = graphCurrent;
    if (!id) {
      g.selectAll('.node').classed('focused', false).classed('faded', false);
      link.classed('faded', false);
      return;
    }
    const ns = new Set();
    const item = byId[id];
    (item.builds_on || []).forEach((x) => ns.add(x));
    (item.relates_to || []).forEach((x) => ns.add(x));
    (item.amends || []).forEach((x) => ns.add(x));
    (item.replaces || []).forEach((x) => ns.add(x));
    node.classed('focused', (d) => d.id === id)
        .classed('faded', (d) => d.id !== id && !ns.has(d.id));
    link.classed('faded', (d) => {
      const a = typeof d.source === 'object' ? d.source.id : d.source;
      const b = typeof d.target === 'object' ? d.target.id : d.target;
      return !(a === id || b === id || ns.has(a) || ns.has(b));
    });
  }

  const DOMAIN_COLOR = {
    data: '#5ee6ff',
    'online-platforms': '#8a8cf5',
    semiconductors: '#ffb74d',
    ai: '#ff7ab8',
    'cloud-edge': '#7beca9',
    'cybersecurity-identity': '#ff6d6d',
    quantum: '#c58aff',
    horizontal: '#5fd3d3',
  };
  const colorFor = (domId) => DOMAIN_COLOR[domId] || '#9aa3c0';

  // ---------------------------------------------------------------------------
  // Shared view tooltip (lifecycle, frameworks)
  // ---------------------------------------------------------------------------
  const viewTip = document.createElement('div');
  viewTip.className = 'view-tip';
  viewTip.hidden = true;
  document.body.appendChild(viewTip);
  function positionViewTip(ev) {
    if (viewTip.hidden) return;
    const pad = 14, w = 260;
    let x = ev.clientX + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - pad - w;
    viewTip.style.left = x + 'px';
    viewTip.style.top = (ev.clientY + pad) + 'px';
  }
  document.addEventListener('mousemove', positionViewTip);
  function wireViewTip(html, ev) {
    viewTip.innerHTML = html;
    viewTip.hidden = false;
    positionViewTip(ev);
  }
  function hideViewTip() { viewTip.hidden = true; }

  // fractional ticker of the current calendar date within [T0, T1]
  function nowTicker() {
    const d = new Date();
    return (d.getFullYear() - T0) + d.getMonth() / 12;
  }
  const titleCase = (s) => String(s).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const FRAMEWORK_COLOR = ['#ffb74d', '#7beca9', '#5ee6ff', '#8a8cf5', '#ff7ab8', '#c58aff', '#5fd3d3'];

  // ---------------------------------------------------------------------------
  // Lifecycle / Gantt view
  // ---------------------------------------------------------------------------
  function initStages(i) {
    const d = i.dates || {};
    const S = [
      { k: 'proposed', lbl: 'Proposed', t: dateToTicker(d.proposed), dl: d.proposed ? dateLabel(d.proposed) : '' },
      { k: 'published', lbl: 'Published', t: dateToTicker(d.published), dl: d.published ? dateLabel(d.published) : '' },
      { k: 'force', lbl: 'In force', t: dateToTicker(d.entered_into_force), dl: d.entered_into_force ? dateLabel(d.entered_into_force) : '' },
      { k: 'application', lbl: 'In application', t: dateToTicker(d.entered_into_application), dl: d.entered_into_application ? dateLabel(d.entered_into_application) : '' },
    ];
    const st = S.filter((s) => s.t != null);
    return { stages: st, start: st.length ? Math.min(...st.map((s) => s.t)) : null, end: st.length ? Math.max(...st.map((s) => s.t)) : null };
  }
  function lifecycleGroupOf(i) {
    return i.domain;
  }
  function lifecycleGroupLabel(key) {
    return domainOf(key);
  }

  function renderLifecycle() {
    const shell = $('lifecycle-shell');
    shell.innerHTML = '';
    const empty = $('lifecycle-empty');
    const items = visibleInitiatives()
      .map((i) => ({ init: i, life: initStages(i) }))
      .filter((x) => x.life.start != null)
      .sort((a, b) => a.life.start - b.life.start);
    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;

    const vw = Math.max(420, shell.clientWidth);

    const groups = new Map(); // key -> [items]
    items.forEach((it) => {
      const k = lifecycleGroupOf(it.init);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    const keys = [...groups.keys()].sort((a, b) => {
      const pa = a === 'none' ? -1 : lifeGroupRank(a);
      const pb = b === 'none' ? -1 : lifeGroupRank(b);
      return pa - pb;
    });

    // size the left gutter to exactly fit the widest group label (plus a small
    // gap), so there is no excess whitespace and nothing gets clipped
    const measurer = d3.select(shell).append('svg').attr('class', 'lc-measure').style('position', 'absolute').style('visibility', 'hidden');
    const mtext = measurer.append('text').attr('class', 'lc-group');
    let maxW = 0;
    keys.forEach((k) => { mtext.text(lifecycleGroupLabel(k)); maxW = Math.max(maxW, mtext.node().getComputedTextLength()); });
    measurer.remove();
    const GUTTER = Math.ceil(maxW) + 14;
    const k = state.lcK;
    const plotW = Math.max(vw - 4, GUTTER + 40) * k;
    const XR = GUTTER + (plotW - GUTTER);
    const x = d3.scaleLinear().domain([0, T1 - T0]).range([GUTTER, XR]);

    const barH = 18, rowGap = 8, headH = 30;
    // layout pass: record a per-group header baseline and per-item row centre so
    // the draw pass uses exactly the same coordinates
    let top = 36; // leave room for the time axis
    const headY = new Map(), rowY = new Map();
    keys.forEach((k) => {
      top += headH;
      headY.set(k, top - 8); // header text baseline near the bottom of its slot
      groups.get(k).forEach((it) => {
        rowY.set(it.init.id, top + barH / 2);
        top += barH + rowGap;
      });
    });
    const plotBottom = top + 20;
    const height = plotBottom + 8;
    const H = Math.max(220, height);

    const svg = d3.select(shell).append('svg').attr('width', plotW).attr('height', H);

    const lcLvl = $('lc-zoom-level');
    if (lcLvl) lcLvl.textContent = Math.round(state.lcK * 100) + '%';

    // time axis (year labels) at the very top of the plot area
    const AXIS_TOP = 20, AXIS_Y = 6, AXIS_H = 24;
    const axisG = svg.append('g').attr('class', 'lc-axis')
      .attr('transform', `translate(0,${AXIS_TOP})`);
    axisG.selectAll('text')
      .data(d3.range(T0, T1 + 1))
      .join('text')
      .attr('class', 'tl-year-label')
      .attr('x', (y) => x(y - T0))
      .attr('y', AXIS_Y)
      .attr('text-anchor', 'middle')
      .text((y) => y);
    axisG.selectAll('line')
      .data(d3.range(T0, T1 + 1))
      .join('line')
      .attr('class', 'lc-yearline')
      .attr('x1', (y) => x(y - T0)).attr('x2', (y) => x(y - T0))
      .attr('y1', AXIS_H).attr('y2', plotBottom);

    // "now" vertical line
    const nt = nowTicker();
    if (nt >= 0 && nt <= T1 - T0) {
      svg.append('line')
        .attr('class', 'lc-now')
        .attr('x1', x(nt)).attr('x2', x(nt))
        .attr('y1', AXIS_TOP + AXIS_H).attr('y2', plotBottom);
      svg.append('text').attr('class', 'lc-nowlabel')
        .attr('x', x(nt) + 4).attr('y', AXIS_TOP + AXIS_H + 12)
        .text('now');
    }

    keys.forEach((k) => {
      const isFrame = false;
      const headCol = isFrame ? FRAMEWORK_COLOR[keys.indexOf(k) % FRAMEWORK_COLOR.length] : colorFor(k);
      svg.append('text').attr('class', 'lc-group')
        .attr('x', GUTTER - 8).attr('y', headY.get(k))
        .attr('text-anchor', 'end')
        .style('fill', headCol)
        .text(lifecycleGroupLabel(k));

      groups.get(k).forEach((it) => {
        const yc = rowY.get(it.init.id);
        const i = it.init, l = it.life;

        // acronym / status label (left gutter)
        const lbl = svg.append('text').attr('class', 'lc-label')
          .attr('x', GUTTER - 8).attr('y', yc)
          .attr('text-anchor', 'end')
          .append('tspan').text(i.acronym || i.name);
        lbl.append('tspan').attr('class', 'lc-status st-' + i.status).text('  ' + i.status);

        // --- lifecycle line: grey line from publication to entering into
        // --- application (extending to 'now' if not yet in application), followed
        // --- by a dashed continuation/elbow connecting to any successor that
        // --- amends or replaces this initiative.
        const d = i.dates || {};
        const pubT = dateToTicker(d.published) ?? dateToTicker(d.proposed);
        const appT = dateToTicker(d.entered_into_application);
        const nt = nowTicker();
        const effT = appT != null ? appT : (nt >= 0 && nt <= T1 - T0 ? nt : null);
        const lineEnd = effT != null ? effT : (pubT != null ? pubT : l.start);

        const row = svg.append('g')
          .attr('class', 'lc-stage')
          .attr('data-id', i.id)
          .style('cursor', 'pointer')
          .on('click', (ev) => { ev.stopPropagation(); openDetail(i.id); })
          .on('mouseover', (ev) => wireViewTip(stageHTML(i, l), ev))
          .on('mouseout', hideViewTip);

        if (pubT != null) {
          // grey main line: publication -> application (or 'now')
          const xp = x(pubT), xe = x(lineEnd);
          if (lineEnd >= pubT) {
            row.append('line')
              .attr('class', 'lc-line')
              .attr('x1', xp).attr('y1', yc)
              .attr('x2', xe).attr('y2', yc);
            // end dot marks application (circle) / now (square)
            if (appT != null) {
              row.append('circle')
                .attr('class', 'lc-app-dot')
                .attr('cx', xe).attr('cy', yc).attr('r', 4.5);
            } else {
              row.append('rect')
                .attr('class', 'lc-now-dot')
                .attr('x', xe - 4).attr('y', yc - 4)
                .attr('width', 8).attr('height', 8);
            }
          }
          // dashed continuation to each successor (amends / replaces)
          successorsOf(i).forEach((s) => {
            const srow = rowY.get(s.id);
            if (srow == null) return;
            const sx = x(sucStart(s));
            const ex = Math.max(xe, xp);
            const elbow = svg.append('path')
              .attr('class', 'lc-successor')
              .attr('fill', 'none')
              .attr('d', `M${ex},${yc} L${sx},${yc} L${sx},${srow}`);
            svg.append('text')
              .attr('class', 'lc-successor-label')
              .attr('x', (ex + sx) / 2).attr('y', yc - 4)
              .attr('text-anchor', 'middle')
              .text(s.replaces && s.replaces.includes(i.id) ? 'replaces' : 'amends');
          });
        }
      });
    });

    // a wider invisible hit row over each bar for easy clicking/dragging-to-tip
    items.forEach((it) => {
      const yc = rowY.get(it.init.id);
      svg.append('rect')
        .attr('class', 'lc-bar-hit')
        .attr('x', GUTTER).attr('y', yc - barH)
        .attr('width', vw - GUTTER - 12).attr('height', barH + rowGap)
        .attr('data-id', it.init.id)
        .style('cursor', 'pointer')
        .on('click', (ev) => { ev.stopPropagation(); openDetail(it.init.id); })
        .on('mouseover', (ev) => wireViewTip(stageHTML(it.init, it.life), ev))
        .on('mouseout', hideViewTip);
    });
  }
  function lifeGroupRank(k) {
    if (k === 'none') return 0;
    return Object.keys(DOMAIN_COLOR).indexOf(k);
  }
  function stageHTML(i, l) {
    const rows = l.stages.length
      ? l.stages.map((s) => `<div><b>${s.lbl}</b> · ${s.dl || dateLabel(s.t)}</div>`).join('')
      : '<div>No dates</div>';
    return `<div class="tt-name">${i.name}</div><div class="tt-meta">${domainOf(i.domain)} · ${i.status}</div>${rows}`;
  }
  // initiatives that amend or replace the given initiative (from the successor's
  // own amends/replaces fields, so it only fires when both are visible/filtered on)
  function successorsOf(i) {
    const out = [];
    DATA.initiatives.forEach((s) => {
      if (s.id === i.id) return;
      const rel = (s.amends || []).concat(s.replaces || []);
      if (rel.includes(i.id)) out.push(s);
    });
    return out;
  }
  // start ticker for a successor used to place the dashed connector elbow
  function sucStart(s) {
    const d = s.dates || {};
    return dateToTicker(d.published) ?? dateToTicker(d.proposed) ?? initStages(s).start;
  }

  // ---------------------------------------------------------------------------
  // Frameworks matrix view
  // ---------------------------------------------------------------------------
  function renderFrameworks() {
    const shell = $('matrix-shell');
    shell.innerHTML = '';
    const empty = $('matrix-empty');
    const items = visibleInitiatives()
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;

    const fws = DATA.frameworks
      .filter((f) => DATA.initiatives.some((i) => i.framework && i.framework.includes(f.id)))
      .map((f) => f.id);

    // grouping rows: by domain only
    const groups = new Map();
    items.forEach((i) => {
      if (!groups.has(i.domain)) groups.set(i.domain, []);
      groups.get(i.domain).push(i);
    });
    const table = document.createElement('table');
    table.className = 'm-table';

    // header: Initiative | Type | Primary date | Short description | one column per framework
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    const colNames = ['Initiative', 'Type', 'Primary date', 'Short description'];
    colNames.forEach((c, idx) => {
      const th = document.createElement('th');
      th.className = 'm-colinfo';
      if (idx === 0) th.className = 'm-corner m-colinfo';
      th.textContent = c;
      hrow.appendChild(th);
    });
    fws.forEach((f, idx) => {
      const th = document.createElement('th');
      th.className = 'm-colhead';
      th.textContent = fwById[f] ? (fwById[f].short || fwById[f].name) : titleCase(f);
      th.title = fwById[f] ? fwById[f].name : f;
      th.style.color = FRAMEWORK_COLOR[idx % FRAMEWORK_COLOR.length];
      th.style.cursor = 'pointer';
      th.addEventListener('click', (ev) => { ev.stopPropagation(); openFramework(f); });
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    [...groups.keys()].forEach((k) => {
      const ghead = document.createElement('tr');
      ghead.className = 'm-group';
      const gt = document.createElement('td');
      gt.colSpan = 4 + fws.length;
      gt.innerHTML = `<span class="m-gdot" style="background:${colorFor(k)}"></span>${domainOf(k)}`;
      ghead.appendChild(gt);
      tbody.appendChild(ghead);
      groups.get(k).forEach((i) => {
        const tr = document.createElement('tr');
        tr.className = 'm-row';
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (ev) => { ev.stopPropagation(); openDetail(i.id); });
        tr.addEventListener('mouseover', (ev) => wireViewTip(
          `<div class="tt-name">${i.name}</div><div class="tt-meta">${domainOf(i.domain)} · ${i.status}</div>`, ev));
        tr.addEventListener('mouseout', hideViewTip);

        const name = document.createElement('td');
        name.className = 'm-name';
        const ntxt = document.createElement('span');
        ntxt.textContent = i.acronym || i.name;
        name.title = i.name;
        ntxt.dataset.id = i.id;
        name.appendChild(ntxt);
        tr.appendChild(name);

        const type = document.createElement('td');
        type.className = 'm-type';
        type.textContent = i.type || '';
        tr.appendChild(type);

        const date = document.createElement('td');
        date.className = 'm-date';
        date.textContent = primaryDate(i) ? dateLabel(primaryDate(i)) : '';
        tr.appendChild(date);

        const desc = document.createElement('td');
        desc.className = 'm-desc';
        const dtxt = document.createElement('span');
        dtxt.textContent = (i.short_description || i.description || '').slice(0, 120);
        desc.title = i.description || i.short_description || '';
        desc.appendChild(dtxt);
        tr.appendChild(desc);

        fws.forEach((f) => {
          const td = document.createElement('td');
          td.className = 'm-cellwrap' + (i.framework && i.framework.includes(f) ? ' filled' : '');
          if (i.framework && i.framework.includes(f)) {
            td.classList.add('dm-' + i.domain);
            td.style.background = colorFor(i.domain);
            td.title = `${i.name} — ${fwById[f] ? fwById[f].name : f}`;
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);
    shell.appendChild(table);
  }

  // ---------------------------------------------------------------------------
  // Stats dashboard
  // ---------------------------------------------------------------------------
  const STATUS_COLORS = {
    adopted: '#5ee6ff', proposed: '#ffb74d', draft: '#9aa3c0', scheduled: '#c58aff', launched: '#7beca9',
  };
  function renderStats() {
    const items = visibleInitiatives();
    const empty = $('stats-empty');
    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;

    const inForce = items.filter((i) => i.dates && i.dates.entered_into_force).length;
    const inApp = items.filter((i) => i.dates && i.dates.entered_into_application).length;
    const pending = items.filter((i) => i.status === 'proposed' || i.status === 'draft').length;
    $('kpi-total').textContent = items.length;
    $('kpi-inforce').textContent = inForce;
    $('kpi-inapp').textContent = inApp;
    $('kpi-pending').textContent = pending;

    const dist = (fn, colorFn) => {
      const map = new Map();
      items.forEach((i) => map.set(fn(i), (map.get(fn(i)) || 0) + 1));
      return [...map.entries()].map(([k, v]) => ({ k, v, c: colorFn(k) }));
    };
    barChart($('stat-status'), dist((i) => i.status, (k) => STATUS_COLORS[k] || '#9aa3c0'), titleCase, STATUS_ORDER);
    barChart($('stat-type'), dist((i) => i.type, () => '#5fd3d3'));
    barChart($('stat-domain'), dist((i) => domainOf(i.domain), (k) => colorFor(items.find((i) => domainOf(i.domain) === k).domain)));
    barChart($('stat-year'), dist((i) => primaryDate(i) ? String(primaryDate(i)).slice(0, 4) : null, () => '#8a8cf5'));
  }
  function barChart(el, rows, labelFn, order) {
    const rows2 = (order
      ? [...rows].sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k))
      : [...rows].sort((a, b) => {
          const na = Number(a.k), nb = Number(b.k);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return String(a.k).localeCompare(String(b.k));
        })
    ).filter((r) => r.k != null);
    el.querySelectorAll('.bar-list').forEach((n) => n.remove());
    if (!rows2.length) return;
    const max = d3.max(rows2, (r) => r.v);
    const list = document.createElement('div');
    list.className = 'bar-list';
    rows2.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const lab = document.createElement('span'); lab.className = 'bar-label'; lab.textContent = labelFn ? labelFn(r.k) : r.k;
      const track = document.createElement('div'); track.className = 'bar-track';
      const fill = document.createElement('div'); fill.className = 'bar-fill';
      fill.style.width = (r.v / max * 100) + '%';
      fill.style.background = r.c;
      track.appendChild(fill);
      const val = document.createElement('span'); val.className = 'bar-val'; val.textContent = r.v;
      row.append(lab, track, val);
      list.appendChild(row);
    });
    el.appendChild(list);
  }

  function linkIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '11');
    s.setAttribute('height', '11');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3');
    s.appendChild(p);
    return s;
  }

  // ---------------------------------------------------------------------------
  // Detail panel
  // ---------------------------------------------------------------------------
  function openDetail(id) {
    const i = byId[id];
    if (!i) return;
    state.focused = id;

    // restore any panel bits that a framework detail may have hidden/relabelled
    ['d-orgs', 'd-builds', 'd-relates', 'd-amends', 'd-replaces', 'd-refs'].forEach((blk) => {
      $(blk).style.display = '';
    });
    $('d-status').style.display = '';
    $('d-domain').querySelector('span').textContent = 'Domain';
    const fwH = document.querySelector('#d-frameworks h4');
    if (fwH && fwH.textContent !== 'Strategic framework') fwH.textContent = 'Strategic framework';

    $('d-name').textContent = i.name;
    $('d-acronym').textContent = i.acronym;
    $('d-type').textContent = i.type;
    $('d-status').className = 'pill d-status st-' + i.status;
    $('d-status').textContent = i.status;

    // domain
    const domRow = $('d-domain');
    domRow.querySelector('strong').textContent = domainOf(i.domain);

    // dates
    const datesWrap = $('d-dates');
    const lines = [];
    const d = i.dates || {};
    if (d.proposed) lines.push(['Proposed', d.proposed]);
    if (d.published) lines.push(['Published', d.published]);
    if (d.entered_into_force) lines.push(['In force', d.entered_into_force]);
    if (d.entered_into_application) lines.push(['In application', d.entered_into_application]);
    datesWrap.innerHTML = lines.length
      ? lines.map(([lbl, v]) => `<div class="dline"><span class="dlabel">${lbl}</span><strong>${dateLabel(v)}</strong></div>`).join('')
      : '<div class="dline"><span class="dlabel">Dates</span><strong>—</strong></div>';

    $('d-desc').textContent = (i.description || '').trim();

    // frameworks
    const fwWrap = $('d-frameworks').querySelector('.tags');
    fwWrap.innerHTML = (i.framework || []).map((f) => `<span class="tag">${fwById[f] ? fwById[f].name : f}</span>`).join('') || '<span class="muted">None listed</span>';

    // orgs
    const orgWrap = $('d-orgs').querySelector('.tags');
    orgWrap.innerHTML = (i.organizations || []).map((o) => `<span class="tag">${orgById[o] ? orgById[o].name : o}</span>`).join('') || '<span class="muted">None</span>';

    // builds on
    const buildsWrap = $('d-builds').querySelector('.links');
    buildsWrap.innerHTML = (i.builds_on && i.builds_on.length)
      ? i.builds_on.map((b) => initLinkHTML(b)).join('')
      : '<span class="muted">None</span>';

    // relates to
    const relWrap = $('d-relates').querySelector('.links');
    relWrap.innerHTML = (i.relates_to && i.relates_to.length)
      ? i.relates_to.map((r) => initLinkHTML(r)).join('')
      : '<span class="muted">None</span>';

    // amends
    const amendsWrap = $('d-amends').querySelector('.links');
    amendsWrap.innerHTML = (i.amends && i.amends.length)
      ? i.amends.map((a) => initLinkHTML(a)).join('')
      : '<span class="muted">None</span>';

    // replaces
    const replacesWrap = $('d-replaces').querySelector('.links');
    replacesWrap.innerHTML = (i.replaces && i.replaces.length)
      ? i.replaces.map((r) => initLinkHTML(r)).join('')
      : '<span class="muted">None</span>';

    // references
    const refWrap = $('d-refs').querySelector('.tags');
    refWrap.innerHTML = '';
    const refs = i.references || [];
    if (refs.length) {
      refs.forEach((r) => {
        const url = DATA.references && DATA.references[r];
        if (url) {
          const a = document.createElement('a');
          a.className = 'tag ref-tag';
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = r;
          a.title = url;
          a.appendChild(linkIcon());
          refWrap.appendChild(a);
        } else {
          const span = document.createElement('span');
          span.className = 'tag ref-tag no-link';
          span.textContent = r;
          refWrap.appendChild(span);
        }
      });
    } else {
      refWrap.innerHTML = '<span class="muted">None</span>';
    }

    // wire up nested links
    detail.querySelectorAll('.init-link').forEach((el) => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });

    detail.hidden = false;
    requestAnimationFrame(() => detail.classList.add('open'));
  }
  function closeDetail() {
    detail.classList.remove('open');
    setTimeout(() => { detail.hidden = true; }, 260);
    state.focused = null;
  }
  function openFramework(fid) {
    const f = fwById[fid];
    if (!f) return;
    state.focused = fid;

    ['d-orgs', 'd-builds', 'd-relates', 'd-amends', 'd-replaces', 'd-refs'].forEach((blk) => {
      const el = $(blk);
      el.style.display = 'none';
    });
    $('d-frameworks').style.display = '';

    $('d-name').textContent = f.name;
    $('d-acronym').textContent = '';
    $('d-type').textContent = f.type || 'Strategic framework';
    $('d-status').style.display = 'none';

    const domRow = $('d-domain');
    domRow.querySelector('span').textContent = 'Published';
    domRow.querySelector('strong').textContent = f.published ? dateLabel(f.published) : '—';
    domRow.style.display = '';

    const datesWrap = $('d-dates');
    datesWrap.innerHTML = '<div class="dline"><span class="dlabel">Scope</span><strong>Multi-initiative strategy</strong></div>';

    $('d-desc').textContent = (f.description || '').trim();

    const fwWrap = $('d-frameworks').querySelector('.tags');
    fwWrap.innerHTML = '';
    DATA.initiatives.filter((i) => i.framework && i.framework.includes(f.id))
      .forEach((i) => { fwWrap.appendChild((() => { const b = document.createElement('button'); b.className = 'init-link'; b.dataset.id = i.id; b.innerHTML = `<span class="sm-dot" style="background:${colorFor(i.domain)}"></span><span class="sm-name">${i.name}</span>${i.acronym ? `<span class="sm-acr">${i.acronym}</span>` : ''}`; b.addEventListener('click', () => { openDetail(i.id); }); return b; })()); });
    const fwH = document.querySelector('#d-frameworks h4');
    fwH.textContent = 'Initiatives under this framework';

    const detailEl = $('detail');
    detailEl.hidden = false;
    requestAnimationFrame(() => detailEl.classList.add('open'));
  }
  function initLinkHTML(id) {
    const t = byId[id];
    if (!t) return '';
    const col = colorFor(t.domain);
    return `<button class="init-link" data-id="${id}">
      <span class="sm-dot" style="background:${col}"></span>
      <span class="sm-name">${t.name}</span>
      ${t.acronym ? `<span class="sm-acr">${t.acronym}</span>` : ''}
    </button>`;
  }
  $('detail-close').addEventListener('click', closeDetail);

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  const searchInput = $('search');
  const searchResults = $('search-results');
  function runSearch(q) {
    if (!q) { closeSearch(); return; }
    const ql = q.toLowerCase();
    const hits = DATA.initiatives
      .filter((i) => (i.name + ' ' + (i.acronym || '') + ' ' + domainOf(i.domain)).toLowerCase().includes(ql))
      .slice(0, 8);
    if (!hits.length) {
      searchResults.innerHTML = '<div class="sr-empty">No matching initiatives</div>';
      searchResults.hidden = false;
      return;
    }
    searchResults.innerHTML = '';
    hits.forEach((h) => {
      const btn = document.createElement('button');
      btn.className = 'sr-item';
      btn.innerHTML = `<span class="sr-name">${h.name}</span>
        <span class="sr-meta"><span class="dot st-${h.status}"></span>${domainOf(h.domain)}${h.acronym ? ' · ' + h.acronym : ''}</span>`;
      btn.addEventListener('click', () => {
        // navigate: switch view to graph if visible, focus node
        searchInput.value = '';
        closeSearch();
        if (state.view === 'graph') {
          g_focusNodeById(h.id);
        }
        openDetail(h.id);
      });
      searchResults.appendChild(btn);
    });
    searchResults.hidden = false;
  }
  function closeSearch() { searchResults.hidden = true; }
  searchInput.addEventListener('input', (e) => runSearch(e.target.value.trim()));
  searchInput.addEventListener('focus', (e) => { if (e.target.value.trim()) runSearch(e.target.value.trim()); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) closeSearch(); });
  // used by search result click: focus matching node in the graph view
  window.g_focusNodeById = function (id) {
    if (state.view === 'graph') graphFocus(id);
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.dataset.view === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    viewTimeline.classList.toggle('active', v === 'timeline');
    viewGraph.classList.toggle('active', v === 'graph');
    viewLifecycle.classList.toggle('active', v === 'lifecycle');
    viewFrameworks.classList.toggle('active', v === 'frameworks');
    viewStats.classList.toggle('active', v === 'stats');
    refresh();
    if (v === 'graph') setTimeout(() => { if (graphSim) graphSim.alpha(0.6).restart(); }, 60);
  }
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------
  const tlWrap = $('timeline');
  const tlWrap_graph = $('graph');

  // ---------------------------------------------------------------------------
  // Timeline: manual pan (drag) + wheel zoom + hover tooltip
  // ---------------------------------------------------------------------------
  let tlPanDrag = null;        // { startX, startScroll } when a drag starts
  let tlPanAt = 0; // timestamp of the most recent pan, to suppress its terminating click

  const tlTooltip = document.createElement('div');
  tlTooltip.className = 'tl-tooltip';
  tlTooltip.hidden = true;
  document.body.appendChild(tlTooltip);

  const bundleTip = document.createElement('div');
  bundleTip.className = 'tl-tooltip';
  bundleTip.hidden = true;
  document.body.appendChild(bundleTip);

  function buildTooltipHTML(it) {
    return {
      title: it.acronym || it.name,
      name: it.name,
      meta: [it.status, dateLabel(primaryDate(it))].filter(Boolean).join(' · '),
    };
  }

  tlWrap.addEventListener('wheel', (e) => {
    if (state.view !== 'timeline') return;
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    tlZoomBy(factor);
  }, { passive: false });

  const lcWrap = $('lifecycle-shell');
  lcWrap.addEventListener('wheel', (e) => {
    if (state.view !== 'lifecycle') return;
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    lcZoomBy(factor);
  }, { passive: false });

  tlWrap.addEventListener('pointerdown', (e) => {
    if (state.view !== 'timeline') return;
    tlPanAt = 0;
    if (e.target.closest('.graph-zoom, .tl-header, .tl-axis')) return;
    tlPanDrag = { startX: e.clientX, startScroll: tlWrap.scrollLeft };
  });
  tlWrap.addEventListener('pointermove', (e) => {
    if (!tlPanDrag) return;
    const dx = e.clientX - tlPanDrag.startX;
    if (Math.abs(dx) > 4) { tlPanDrag.moved = true; }
    if (tlPanDrag.moved) tlWrap.scrollLeft = tlPanDrag.startScroll - dx;
  });
  const endPan = () => {
    if (tlPanDrag && tlPanDrag.moved) tlPanAt = Date.now();
    tlPanDrag = null;
  };
  tlWrap.addEventListener('pointerup', endPan);
  tlWrap.addEventListener('pointercancel', endPan);

  tlWrap.addEventListener('mouseover', (e) => {
    const nodeEl = e.target.closest('.tl-node');
    if (!nodeEl) return;
    const it = byId[nodeEl.getAttribute('data-id')];
    if (!it) return;
    const h = buildTooltipHTML(it);
    tlTooltip.innerHTML = '';
    const t0 = document.createElement('div'); t0.className = 'tl-tt-name'; t0.textContent = h.name;
    const t1 = document.createElement('div'); t1.className = 'tl-tt-date'; t1.textContent = (it.acronym ? h.title + ' · ' : '') + h.meta;
    tlTooltip.appendChild(t0);
    tlTooltip.appendChild(t1);
    tlTooltip.hidden = false;
  });
  tlWrap.addEventListener('mouseout', (e) => {
    if (e.target.closest('.tl-node')) tlTooltip.hidden = true;
  });
  tlWrap.addEventListener('mousemove', (e) => {
    if (tlTooltip.hidden) return;
    const pad = 14;
    const tipW = 260;
    let x = e.clientX + pad;
    if (x + tipW > window.innerWidth - 8) x = e.clientX - pad - tipW;
    tlTooltip.style.left = x + 'px';
    tlTooltip.style.top = (e.clientY + pad) + 'px';
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('atlas-theme', theme); } catch (e) {}
    if (state.view === 'graph' && graphSim) graphSim.alpha(0.4).restart();
    if (state.view === 'timeline') renderTimeline();
  }
  document.addEventListener('DOMContentLoaded', () => {
    buildChips('domain-chips', allDomains, 'domain', (v) => domainOf(v));
    buildChips('status-chips', allStatuses, 'status');
    buildGroupedTypeChips('type-chips', 'type');
    buildChips('relation-chips', ['builds', 'relates', 'amends', 'replaces'], 'relations', (v) => ({ builds: 'builds on', relates: 'relates', amends: 'amends', replaces: 'replaces' }[v] || v));
    setupFilterToggle();

    const stored = (function () { try { return localStorage.getItem('atlas-theme'); } catch (e) { return null; } })();
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));

    const toggle = $('theme-toggle');
    toggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });

    $('zoom-in').addEventListener('click', () => tlZoomBy(1.25));
    $('zoom-out').addEventListener('click', () => tlZoomBy(0.8));
    $('zoom-reset').addEventListener('click', tlZoomReset);

    $('lc-zoom-in').addEventListener('click', () => lcZoomBy(1.25));
    $('lc-zoom-out').addEventListener('click', () => lcZoomBy(0.8));
    $('lc-zoom-reset').addEventListener('click', lcZoomReset);

    let rsTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(rsTimer);
      rsTimer = setTimeout(() => refresh(), 120);
    });

    refresh();
  });

  // expose minimal API for inline handlers
  window.App = { clearAll, applyTheme, tlZoomBy, tlZoomReset, lcZoomBy, lcZoomReset };
})();
