/* Native member feedback and shared public episode rendering. */
'use strict';
(() => {
  for (const form of document.querySelectorAll('.ngw-signup-form')) {
    const button = form.querySelector('button[type="submit"]');
    const email = form.querySelector('[data-members-email]');
    // Ghost Portal detaches its native submit listener during a request.
    // Its transport-exception path can omit reattachment. Remember only this
    // form's removed submit handler so a failed request can retry natively.
    let nativeSubmit;
    const removeListener = form.removeEventListener.bind(form);
    form.removeEventListener = (type, listener, options) => {
      if (type === 'submit' && !options) nativeSubmit = listener;
      return removeListener(type, listener, options);
    };
    const update = () => {
      if ((form.classList.contains('error') || form.classList.contains('success')) && form.classList.contains('loading')) form.classList.remove('loading');
      const loading = form.classList.contains('loading');
      button.disabled = loading;
      form.setAttribute('aria-busy', String(loading));
      const failed=form.classList.contains('error');
      if (failed && nativeSubmit) form.addEventListener('submit', nativeSubmit);
      email.setAttribute('aria-invalid', String(failed));
      const error=form.querySelector('[data-members-error]');
      if(failed && !error.textContent.trim()) error.textContent='We couldn’t send the confirmation email. Please try again.';
      if(!failed) error.textContent='';
    };
    new MutationObserver(update).observe(form, {attributes:true, attributeFilter:['class']});
    form.addEventListener('submit', event => {
      if (form.classList.contains('loading')) {event.preventDefault(); event.stopImmediatePropagation();}
    }, true);
    update();
  }
  document.querySelectorAll('[data-open-neura]').forEach(button => button.addEventListener('click', () => document.querySelector('#mom-chat-launcher')?.click()));
  const burger=document.querySelector('.gh-burger');
  if(burger){
    const expanded=()=>burger.setAttribute('aria-expanded',String(document.body.classList.contains('is-head-open')));
    new MutationObserver(expanded).observe(document.body,{attributes:true,attributeFilter:['class']}); expanded();
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('is-head-open')){document.body.classList.remove('is-head-open');burger.focus();}});
  }
  const platformNames = {youtube:'YouTube',spotify:'Spotify',apple:'Apple Podcasts'};
  const icons = {youtube:'youtube',spotify:'spotify',apple:'applepodcasts'};
  const status = document.querySelector('#episode-status');
  const filters = [...document.querySelectorAll('.ngw-filter-btn')];
  const list = document.querySelector('.archive-list');
  const feed = document.querySelector('#episode-feed');
  const teaser = document.querySelector('.episode-teaser');
  const episodeHeading = document.querySelector('[data-episode-heading]');
  const latest = document.querySelector('#latest-updates');
  const latestArticles = latest ? [...latest.children].map(row => row.cloneNode(true)) : [];
  if (!status) return;
  const originalEmptyText = document.querySelector('.archive-empty')?.textContent;
  let activeFilter = 'all', controller, requestId = 0;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function plain(value, limit) {
    return typeof value === 'string' && value.trim() && value.length <= limit && !/[<>\u0000-\u001f\u007f]/u.test(value);
  }
  function validate(payload) {
    if (payload?.schema !== 'eaol-public-catalog-v1' || Object.keys(payload).some(key => !['schema','episodes'].includes(key))
      || !Array.isArray(payload.episodes) || payload.episodes.length > 1000) throw new Error('invalid_catalog');
    const ids = new Set();
    const videos = new Set();
    const keys = ['episodeId','title','summary','publishedAt','thumbnail','platforms','metadataRevision'];
    for (const episode of payload.episodes) {
      if (!episode || Object.keys(episode).some(key => !keys.includes(key))
        || typeof episode.episodeId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(episode.episodeId)
        || ids.has(episode.episodeId) || !plain(episode.title, 200) || !plain(episode.summary, 500)
        || typeof episode.metadataRevision !== 'string' || !/^[a-f0-9]{64}$/.test(episode.metadataRevision)
        || typeof episode.publishedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(episode.publishedAt)
        || !Number.isFinite(Date.parse(episode.publishedAt)) || new Date(episode.publishedAt).toISOString() !== episode.publishedAt
        || !episode.platforms || Object.entries(episode.platforms).some(([key, value]) => !Object.hasOwn(platformNames, key)
          || typeof value !== 'string' || value.length > 2048)) throw new Error('invalid_episode');
      const youtube = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(episode.platforms.youtube);
      if (!youtube || videos.has(youtube[1]) || typeof episode.thumbnail !== 'string'
        || !new RegExp(`^https://i\\.ytimg\\.com/vi/${youtube[1]}/(?:hqdefault|maxresdefault)\\.jpg$`).test(episode.thumbnail)) throw new Error('invalid_destination');
      if (episode.platforms.spotify && !/^https:\/\/open\.spotify\.com\/episode\/[A-Za-z0-9]{22}$/.test(episode.platforms.spotify)) throw new Error('invalid_spotify');
      if (episode.platforms.apple && !/^https:\/\/podcasts\.apple\.com\/[a-z]{2}\/podcast\/[a-z0-9-]+\/id\d{1,20}\?i=\d{1,20}$/.test(episode.platforms.apple)) throw new Error('invalid_apple');
      ids.add(episode.episodeId);
      videos.add(youtube[1]);
    }
    return [...payload.episodes].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.episodeId.localeCompare(b.episodeId));
  }
  function episodeLink(episode, platform, className, label) {
    const a = element('a', className);
    a.href = episode.platforms[platform];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.dataset.platform = platformNames[platform];
    a.dataset.episode = episode.title;
    a.setAttribute('aria-label', `${platform === 'youtube' ? 'Watch' : 'Listen to'} ${episode.title} on ${platformNames[platform]}`);
    if (label) a.textContent = label;
    return a;
  }
  function platformAction(episode, platform, primary = false) {
    const action = episodeLink(episode, platform, `platform${primary ? ' youtube-primary' : ''}`);
    const img = element('img');
    img.src = `/assets/eaol/icons/${icons[platform]}.png`;
    img.width = 20; img.height = 20; img.alt = '';
    action.append(img);
    if (primary) action.append(element('span', '', 'Watch on YouTube'));
    return action;
  }
  const dateLabel = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  function articleDate(row) {
    const value = Date.parse(row.dataset.publishedAt ?? '');
    return Number.isFinite(value) ? value : -Infinity;
  }
  function archiveRow(episode) {
    const row = element('li', 'archive-item podcast-addition');
    row.dataset.podcast = 'true'; row.dataset.tags = 'hash-podcast';
    row.dataset.episodeId = episode.episodeId; row.dataset.publishedAt = episode.publishedAt;
    const title = episodeLink(episode, 'youtube', 'archive-item-link');
    const top = element('div', 'archive-item-top');
    top.append(element('h2', 'archive-item-title', episode.title));
    const date = element('time', 'archive-item-date', dateLabel(episode.publishedAt));
    date.dateTime = episode.publishedAt;
    top.append(date); title.append(top);
    const meta = element('div', 'archive-item-meta');
    meta.append(element('span', 'archive-item-badge', 'Explore AI Out Loud'));
    const platforms = element('nav', 'episode-platforms');
    platforms.setAttribute('aria-label', `Platforms for ${episode.title}`);
    for (const key of ['youtube','spotify','apple']) if (episode.platforms[key]) platforms.append(platformAction(episode, key));
    meta.append(platforms); row.append(title, meta);
    return row;
  }
  function hubCard(episode) {
    const article = element('article', 'episode-feature');
    article.dataset.episodeId = episode.episodeId;
    const imageLink = episodeLink(episode, 'youtube', 'episode-image');
    const image = element('img');
    image.src = episode.thumbnail;
    image.dataset.sourceThumbnail = episode.thumbnail;
    image.addEventListener('error', () => {
      if (image.src === episode.thumbnail) {image.src='/assets/eaol/show-desktop.webp'; image.alt='Explore AI Out Loud artwork';}
    });
    image.width = 1920; image.height = 1080; image.loading = 'lazy';
    image.alt = `${episode.title}`;
    imageLink.append(image);
    const copy = element('div', 'episode-copy');
    const eyebrow = element('p', 'eyebrow', `Episode · ${dateLabel(episode.publishedAt)}`);
    const heading = element('h3'); heading.append(episodeLink(episode, 'youtube', '', episode.title));
    const actions = element('div', 'feature-actions'); actions.append(platformAction(episode, 'youtube', true));
    if (episode.platforms.spotify || episode.platforms.apple) {
      actions.append(element('span', 'listen-caption', 'Listen'));
      for (const key of ['spotify','apple']) if (episode.platforms[key]) actions.append(platformAction(episode, key));
    }
    copy.append(eyebrow, heading, element('p', '', episode.summary), actions);
    article.append(imageLink, copy);
    return article;
  }
  function applyFilter() {
    let count = 0;
    for (const button of filters) {
      button.classList.toggle('active', button.dataset.filter === activeFilter);
      button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
    }
    for (const row of document.querySelectorAll('.archive-item')) {
      const tags = (row.dataset.tags ?? '').toLowerCase();
      const podcast = row.dataset.podcast === 'true';
      const visible = activeFilter === 'all' || (activeFilter === 'eaol' ? podcast : !podcast && (activeFilter === 'newsletter'
        ? !tags.includes('hash-founders-corner') && !tags.includes('hash-prompt-library') : tags.includes(`hash-${activeFilter}`)));
      row.classList.toggle('hidden', !visible);
      if (visible) count++;
    }
    const empty = document.querySelector('.archive-empty');
    if (empty) {
      empty.hidden = count !== 0;
      empty.style.display = count === 0 ? 'block' : 'none';
      empty.textContent = activeFilter === 'eaol' ? 'No episodes to show yet.' : originalEmptyText;
    }
  }
  for (const button of filters) {
    button.disabled = false;
    button.addEventListener('click', () => { activeFilter = button.dataset.filter; applyFilter(); });
  }
  function render(episodes, unavailable = false) {
    const showTeaser = Boolean(teaser) && episodes.length === 0 && !unavailable;
    if (teaser) teaser.hidden = !showTeaser;
    if (episodeHeading) episodeHeading.hidden = showTeaser;
    if (latest) {
      const rows = latestArticles.map(row => row.cloneNode(true));
      for (const episode of episodes) {
        const row = element('li', 'ngw-latest-item');
        row.dataset.episodeId = episode.episodeId;
        row.dataset.publishedAt = episode.publishedAt;
        const date = element('time', 'ngw-latest-date', dateLabel(episode.publishedAt));
        date.dateTime = episode.publishedAt;
        row.append(episodeLink(episode, 'youtube', '', episode.title), date);
        rows.push(row);
      }
      rows.sort((a, b) => articleDate(b) - articleDate(a));
      latest.replaceChildren(...rows.slice(0, 4));
    }
    if (list) {
      list.querySelectorAll('[data-podcast="true"]').forEach(row => row.remove());
      for (const episode of episodes) {
        const row = archiveRow(episode);
        const anchor = [...list.children].find(item => articleDate(item) < articleDate(row));
        list.insertBefore(row, anchor ?? null);
      }
      applyFilter();
    }
    if (feed) feed.replaceChildren(...episodes.map(hubCard));
    document.querySelectorAll('.episode-fallback').forEach(node => { node.hidden = episodes.length > 0 || showTeaser; });
  }

  async function load() {
    const endpoint = document.querySelector('meta[name="eaol-catalog"]')?.content;
    if (!endpoint) {render([]); status.textContent = teaser ? '' : 'Explore the show on YouTube.'; status.hidden = Boolean(teaser); document.body.dataset.episodesState='ready'; return;}
    const id = ++requestId;
    controller?.abort();
    const local = new AbortController(); controller=local;
    const timeout=setTimeout(() => local.abort(),6000);
    document.body.dataset.episodesState='loading';
    status.hidden=false; status.textContent='Loading episodes…';
    try {
      const url=new URL(endpoint,location.origin);
      if (url.origin !== location.origin || url.username || url.password) throw new Error('invalid_source');
      const response=await fetch(url,{signal:local.signal,cache:'no-store',credentials:'omit',redirect:'error'});
      if (!response.ok || Number(response.headers.get('content-length'))>500000) throw new Error('unavailable');
      const text=await response.text(); if (text.length>500000) throw new Error('oversized');
      const episodes=validate(JSON.parse(text)); if (id!==requestId) return;
      render(episodes); status.textContent=episodes.length || teaser ? '' : 'No episodes to show yet.'; status.hidden=episodes.length>0 || Boolean(teaser);
      document.body.dataset.episodesState='ready';
    } catch {
      if(id!==requestId)return;
      render([], true); status.textContent='Episodes are temporarily unavailable. You can still browse on YouTube.'; status.hidden=false;
      document.body.dataset.episodesState='error';
    } finally {clearTimeout(timeout);}
  }
  applyFilter(); load();
  // Reconciliation integrations may request a refresh without attaching another filter controller.
  document.addEventListener('eaol:refresh',load);
})();
