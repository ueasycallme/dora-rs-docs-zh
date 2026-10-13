'use strict';
/*
 * 中文站搜索（替代 mdBook 的 searcher-*.js）。
 * elasticlunr 按空格切词，中文句子没有空格，整句被当成一个词而搜不到；这里改为子串匹配：
 *   - 空格分隔多个关键词，全部命中才算结果；
 *   - 中文关键词整体没命中时，退化为相邻两字（bigram）全部命中；
 *   - 同时匹配中文标题、英文原标题（en_name）和正文，大小写不敏感；
 *   - 排序：标题命中 > 英文标题命中 > 正文命中次数。
 * 页面交互（#mdbook-search-toggle、#mdbook-searchbar、快捷键 S / /、Esc、方向键、?highlight= 高亮）保持 mdBook 原样。
 * 数据来自 zh-searchindex.js 设置的 window.zhSearchData（由 scripts/build_search.py 生成）。
 */
window.search = window.search || {};
(function search() {
    if (!Mark) {
        return;
    }

    const search_wrap = document.getElementById('mdbook-search-wrapper'),
        searchbar_outer = document.getElementById('mdbook-searchbar-outer'),
        searchbar = document.getElementById('mdbook-searchbar'),
        searchresults = document.getElementById('mdbook-searchresults'),
        searchresults_outer = document.getElementById('mdbook-searchresults-outer'),
        searchresults_header = document.getElementById('mdbook-searchresults-header'),
        searchicon = document.getElementById('mdbook-search-toggle'),
        content = document.getElementById('mdbook-content'),
        mark_exclude = ['text'],
        marker = new Mark(content),
        URL_SEARCH_PARAM = 'search',
        URL_MARK_PARAM = 'highlight',
        LIMIT = 30,
        CJK = /[㐀-鿿]/;

    let current_searchterm = '', data = null, teaser_count = 0;

    function hasFocus() {
        return searchbar === document.activeElement;
    }

    function removeChildren(elem) {
        while (elem.firstChild) {
            elem.removeChild(elem.firstChild);
        }
    }

    function parseURL(url) {
        const a = document.createElement('a');
        a.href = url;
        return {
            source: url,
            protocol: a.protocol.replace(':', ''),
            host: a.hostname,
            port: a.port,
            params: (function() {
                const ret = {};
                for (const part of a.search.replace(/^\?/, '').split('&')) {
                    if (!part) {
                        continue;
                    }
                    const s = part.split('=');
                    ret[s[0]] = s[1];
                }
                return ret;
            })(),
            hash: a.hash.replace('#', ''),
            path: a.pathname.replace(/^([^/])/, '/$1'),
        };
    }

    function renderURL(o) {
        let url = o.protocol + '://' + o.host;
        if (o.port !== '') {
            url += ':' + o.port;
        }
        url += o.path;
        let joiner = '?';
        for (const prop in o.params) {
            if (Object.prototype.hasOwnProperty.call(o.params, prop)) {
                url += joiner + prop + '=' + o.params[prop];
                joiner = '&';
            }
        }
        if (o.hash !== '') {
            url += '#' + o.hash;
        }
        return url;
    }

    const escapeHTML = (function() {
        const MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', '\'': '&#39;'};
        return s => s.replace(/[&<>'"]/g, c => MAP[c]);
    })();

    // ---- 子串匹配 ----
    function bigrams(term) {
        const out = [];
        for (let i = 0; i + 1 < term.length; i++) {
            out.push(term.slice(i, i + 2));
        }
        return out;
    }

    // 返回首次命中位置；-1 表示未命中
    function find(text, term) {
        const i = text.indexOf(term);
        if (i >= 0 || !CJK.test(term) || term.length <= 2) {
            return i;
        }
        const grams = bigrams(term);
        return grams.every(g => text.includes(g)) ? text.indexOf(grams[0]) : -1;
    }

    function countHits(text, term) {
        let n = 0, i = text.indexOf(term);
        while (i >= 0 && n < 20) {
            n++;
            i = text.indexOf(term, i + term.length);
        }
        return n;
    }

    function score(doc, terms) {
        const title = (doc.display_name || '').toLowerCase();
        const en = (doc.en_name || '').toLowerCase();
        const body = (doc.content || '').toLowerCase();
        let s = 0, firstPos = -1, firstTerm = null;
        for (const t of terms) {
            const inTitle = find(title, t) >= 0, inEn = find(en, t) >= 0;
            const pos = find(body, t);
            if (!inTitle && !inEn && pos < 0) {
                return null;
            }
            s += (inTitle ? 10 : 0) + (inEn ? 5 : 0) + countHits(body, t);
            if (pos >= 0 && firstPos < 0) {
                firstPos = pos;
                firstTerm = t;
            }
        }
        if (doc.type === 'doc') {
            s *= 1.5;
        }
        return {score: s, pos: firstPos, term: firstTerm};
    }

    function teaser(doc, hit) {
        const body = doc.content || '';
        if (hit.pos < 0) {
            return escapeHTML(body.slice(0, 120));
        }
        const len = Math.min(hit.term.length, body.length - hit.pos);
        const start = Math.max(0, hit.pos - 40);
        const end = Math.min(body.length, hit.pos + len + 80);
        return (start > 0 ? '…' : '') + escapeHTML(body.slice(start, hit.pos))
            + '<em>' + escapeHTML(body.slice(hit.pos, hit.pos + len)) + '</em>'
            + escapeHTML(body.slice(hit.pos + len, end)) + (end < body.length ? '…' : '');
    }

    function parseTerms(query) {
        const terms = [];
        const re = /"([^"]+)"|(\S+)/g;
        let m;
        while ((m = re.exec(query)) !== null) {
            const t = (m[1] || m[2] || '').trim().toLowerCase();
            if (t) {
                terms.push(t);
            }
        }
        return terms;
    }

    function formatSearchResult(r, terms) {
        const d = r.doc;
        teaser_count++;
        const encoded = encodeURIComponent(terms.join(' ')).replace(/'/g, '%27');
        return '<a href="' + path_to_root + encodeURI(d.filename) + '?' + URL_MARK_PARAM + '=' + encoded
            + '#' + (d.anchor || '') + '" aria-details="mdbook-teaser_' + teaser_count + '">'
            + escapeHTML(d.breadcrumbs || d.display_name) + '</a>'
            + '<span class="teaser" id="mdbook-teaser_' + teaser_count + '" aria-label="搜索结果摘要">'
            + teaser(d, r.hit) + '</span>';
    }

    function init() {
        data = (window.zhSearchData && window.zhSearchData.data) || [];
        searchbar_outer.classList.remove('searching');
        searchbar.focus();
        const searchterm = searchbar.value.trim();
        if (searchterm !== '') {
            searchbar.classList.add('active');
            doSearch(searchterm);
        }
    }

    function doSearch(searchterm) {
        if (current_searchterm === searchterm) {
            return;
        }
        searchbar_outer.classList.add('searching');
        if (data === null) {
            return;
        }
        current_searchterm = searchterm;

        const terms = parseTerms(searchterm);
        const results = [];
        for (const doc of data) {
            const hit = score(doc, terms);
            if (hit) {
                results.push({doc, hit, s: hit.score});
            }
        }
        results.sort((a, b) => b.s - a.s);
        const shown = results.slice(0, LIMIT);

        searchresults_header.innerText = shown.length === 0
            ? '没有找到“' + searchterm + '”的搜索结果。'
            : '找到 ' + results.length + ' 条“' + searchterm + '”的搜索结果' + (results.length > LIMIT ? '（显示前 ' + LIMIT + ' 条）' : '') + '：';

        removeChildren(searchresults);
        for (const r of shown) {
            const li = document.createElement('li');
            li.innerHTML = formatSearchResult(r, terms);
            searchresults.appendChild(li);
        }
        showResults(true);
        searchbar_outer.classList.remove('searching');
    }

    function initSearchInteractions(config) {
        searchicon.addEventListener('click', () => {
            searchIconClickHandler();
        }, false);
        searchbar.addEventListener('keyup', () => {
            searchbarKeyUpHandler();
        }, false);
        document.addEventListener('keydown', e => {
            globalKeyHandler(e);
        }, false);
        window.onpopstate = () => {
            doSearchOrMarkFromUrl();
        };
        document.addEventListener('submit', e => {
            e.preventDefault();
        }, false);
        doSearchOrMarkFromUrl();
        config.hasFocus = hasFocus;
    }

    initSearchInteractions(window.search);

    function unfocusSearchbar() {
        const tmp = document.createElement('input');
        tmp.setAttribute('style', 'position: absolute; opacity: 0;');
        searchicon.appendChild(tmp);
        tmp.focus();
        tmp.remove();
    }

    function doSearchOrMarkFromUrl() {
        const url = parseURL(window.location.href);
        if (Object.prototype.hasOwnProperty.call(url.params, URL_SEARCH_PARAM)
            && url.params[URL_SEARCH_PARAM] !== '') {
            showSearch(true);
            searchbar.value = decodeURIComponent((url.params[URL_SEARCH_PARAM] + '').replace(/\+/g, '%20'));
            searchbarKeyUpHandler();
        } else {
            showSearch(false);
        }

        if (Object.prototype.hasOwnProperty.call(url.params, URL_MARK_PARAM)) {
            const words = decodeURIComponent(url.params[URL_MARK_PARAM]).split(' ');
            marker.mark(words, {exclude: mark_exclude});
            const markers = document.querySelectorAll('mark');
            const hide = () => {
                for (let i = 0; i < markers.length; i++) {
                    markers[i].classList.add('fade-out');
                    window.setTimeout(() => {
                        marker.unmark();
                    }, 300);
                }
                setSearchUrlParameters('', 'replace');
            };
            for (let i = 0; i < markers.length; i++) {
                markers[i].addEventListener('click', hide);
            }
        }
    }

    function globalKeyHandler(e) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ||
            e.target.type === 'textarea' || e.target.type === 'text' ||
            !hasFocus() && mdbook_something_else_has_focus(e)) {
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            searchbar.classList.remove('active');
            setSearchUrlParameters('', searchbar.value.trim() !== '' ? 'push' : 'replace');
            if (hasFocus()) {
                unfocusSearchbar();
            }
            showSearch(false);
            marker.unmark();
        } else if (!hasFocus() && (e.key === 's' || e.key === '/')) {
            e.preventDefault();
            showSearch(true);
            window.scrollTo(0, 0);
            searchbar.select();
        } else if (hasFocus() && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault();
            const first = searchresults.firstElementChild;
            if (first !== null) {
                unfocusSearchbar();
                first.classList.add('focus');
                if (e.key === 'Enter') {
                    window.location.assign(first.querySelector('a'));
                }
            }
        } else if (!hasFocus() && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
            const focused = searchresults.querySelector('li.focus');
            if (!focused) {
                return;
            }
            e.preventDefault();
            if (e.key === 'ArrowDown') {
                const next = focused.nextElementSibling;
                if (next) {
                    focused.classList.remove('focus');
                    next.classList.add('focus');
                }
            } else if (e.key === 'ArrowUp') {
                focused.classList.remove('focus');
                const prev = focused.previousElementSibling;
                if (prev) {
                    prev.classList.add('focus');
                } else {
                    searchbar.select();
                }
            } else {
                window.location.assign(focused.querySelector('a'));
            }
        }
    }

    function loadSearchScript(url, id) {
        if (document.getElementById(id)) {
            return;
        }
        searchbar_outer.classList.add('searching');
        const script = document.createElement('script');
        script.src = url;
        script.id = id;
        script.onload = () => init();
        script.onerror = error => {
            console.error(`Failed to load \`${url}\`: ${error}`);
        };
        document.head.append(script);
    }

    function showSearch(yes) {
        if (yes) {
            loadSearchScript(window.path_to_searchindex_js || path_to_root + 'zh-searchindex.js', 'mdbook-search-index');
            search_wrap.classList.remove('hidden');
            searchicon.setAttribute('aria-expanded', 'true');
        } else {
            search_wrap.classList.add('hidden');
            searchicon.setAttribute('aria-expanded', 'false');
            const results = searchresults.children;
            for (let i = 0; i < results.length; i++) {
                results[i].classList.remove('focus');
            }
        }
    }

    function showResults(yes) {
        if (yes) {
            searchresults_outer.classList.remove('hidden');
        } else {
            searchresults_outer.classList.add('hidden');
        }
    }

    function searchIconClickHandler() {
        if (search_wrap.classList.contains('hidden')) {
            showSearch(true);
            window.scrollTo(0, 0);
            searchbar.select();
        } else {
            showSearch(false);
        }
    }

    function searchbarKeyUpHandler() {
        const searchterm = searchbar.value.trim();
        if (searchterm !== '') {
            searchbar.classList.add('active');
            doSearch(searchterm);
        } else {
            searchbar.classList.remove('active');
            showResults(false);
            removeChildren(searchresults);
        }
        setSearchUrlParameters(searchterm, 'push_if_new_search_else_replace');
        marker.unmark();
    }

    function setSearchUrlParameters(searchterm, action) {
        const url = parseURL(window.location.href);
        const first_search = !Object.prototype.hasOwnProperty.call(url.params, URL_SEARCH_PARAM);
        if (searchterm !== '' || action === 'push_if_new_search_else_replace') {
            url.params[URL_SEARCH_PARAM] = searchterm;
            delete url.params[URL_MARK_PARAM];
            url.hash = '';
        } else {
            delete url.params[URL_MARK_PARAM];
            delete url.params[URL_SEARCH_PARAM];
        }
        if (action === 'push' || action === 'push_if_new_search_else_replace' && first_search) {
            history.pushState({}, document.title, renderURL(url));
        } else if (action === 'replace' || action === 'push_if_new_search_else_replace' && !first_search) {
            history.replaceState({}, document.title, renderURL(url));
        }
    }

    search.hasFocus = hasFocus;
})(window.search);
