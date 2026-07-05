(function () {
  "use strict";

  var BASE = "";
  var DATA_CACHE = {};
  var ACCESS_SESSION_KEY = "mk-access-granted";
  var ACCESS_DIGEST = "03f16268eaf54cd63d9779c213f043222bebaf7a55395ae8211ebfeb3c2cf782";
  var siteInitialized = false;

  function hasAccess() {
    try {
      return sessionStorage.getItem(ACCESS_SESSION_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  if (hasAccess()) {
    document.documentElement.classList.remove("access-pending");
    document.documentElement.classList.add("access-granted");
  }

  function pathIsActive(href) {
    var current = window.location.pathname.replace(/\/+$/, "") || "/";
    var target = href.replace(/\/+$/, "") || "/";
    if (target === "/") return current === "/";
    return current === target || current.indexOf(target + "/") === 0;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function externalAttrs(url) {
    return /^https?:\/\//.test(url) ? ' target="_blank" rel="noopener noreferrer"' : "";
  }

  function loadJson(url) {
    if (!DATA_CACHE[url]) {
      DATA_CACHE[url] = fetch(url, { cache: "no-store" }).then(function (response) {
        if (!response.ok) throw new Error("无法读取 " + url);
        return response.json();
      });
    }
    return DATA_CACHE[url];
  }

  function renderHeader() {
    var host = document.querySelector("[data-site-header]");
    if (!host) return;
    var nav = [
      ["/precheck/", "开业前调查", "/precheck/"],
      ["/regimes/compare/", "制度指南", "/regimes/"],
      ["/tokyo/", "东京23区", "/tokyo/"],
      ["/operations/", "运营规范", "/operations/"],
      ["/tools/checklists/", "工具", "/tools/"],
      ["/resources/sources/", "官方资料", "/resources/"]
    ];
    var navHtml = nav.map(function (item) {
      var currentPath = window.location.pathname;
      var active = (pathIsActive(item[0]) || (item[2] !== "/" && currentPath.indexOf(item[2]) === 0)) ? ' aria-current="page"' : "";
      return '<a href="' + item[0] + '"' + active + ">" + item[1] + "</a>";
    }).join("");
    host.innerHTML =
      '<a class="skip-link" href="#main-content">跳到正文</a>' +
      '<header class="site-header">' +
        '<div class="container header-inner">' +
          '<a class="brand" href="/"><strong>Minpaku Knowledge</strong><span>日本民宿・旅馆合规知识库</span></a>' +
          '<nav class="main-nav" id="main-nav" aria-label="主导航">' + navHtml + "</nav>" +
          '<a class="header-search-link" href="/#site-search">搜索</a>' +
          '<button class="menu-toggle" type="button" aria-controls="main-nav" aria-expanded="false" aria-label="打开导航">☰</button>' +
        "</div>" +
      "</header>";

    var toggle = host.querySelector(".menu-toggle");
    var mainNav = host.querySelector(".main-nav");
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.setAttribute("aria-label", open ? "打开导航" : "关闭导航");
      mainNav.classList.toggle("is-open", !open);
      document.body.classList.toggle("no-scroll", !open);
    });
  }

  function renderFooter() {
    var host = document.querySelector("[data-site-footer]");
    if (!host) return;
    host.innerHTML =
      '<footer class="site-footer">' +
        '<div class="container">' +
          '<div class="footer-inner">' +
            '<p><strong>内容边界：</strong>本站用于整理调查方向和定位官方依据，不构成法律意见。具体物件请向管辖自治体、保健所、消防署、建筑部门或专业人士确认。</p>' +
            '<nav class="footer-links" aria-label="页脚导航">' +
              '<a href="/resources/methodology/">内容方法</a>' +
              '<a href="/resources/updates/">更新记录</a>' +
              '<a href="/resources/glossary/">术语表</a>' +
              '<a href="/resources/sources/">官方资料</a>' +
            "</nav>" +
          "</div>" +
          '<div class="footer-bottom"><span>© 2026 Minpaku Knowledge</span><span>不收集个人信息 · 进度仅保存在当前浏览器</span></div>' +
        "</div>" +
      "</footer>";
  }

  function normalizedText(value) {
    var synonyms = {
      "民宿": "住宅宿泊事业 住宅宿泊事業 minpaku",
      "住宅宿泊事业": "民宿 住宅宿泊事業",
      "住宅宿泊事業": "民宿 住宅宿泊事业",
      "旅馆业": "旅館業 酒店 简易宿所 簡易宿所",
      "旅館業": "旅馆业 酒店 简易宿所 簡易宿所",
      "简易宿所": "簡易宿所 旅馆业 旅館業",
      "簡易宿所": "简易宿所 旅馆业 旅館業",
      "消防": "火灾 火災 自動火災報知設備 避难 避難",
      "垃圾": "ごみ 废弃物 廃棄物 事业系 事業系",
      "名簿": "宿泊者名簿 本人确认 本人確認",
      "涩谷": "渋谷",
      "丰岛": "豊島",
      "台东": "台東"
    };
    var input = String(value || "").toLowerCase().trim();
    Object.keys(synonyms).forEach(function (key) {
      if (input.indexOf(key.toLowerCase()) !== -1) input += " " + synonyms[key];
    });
    return input.replace(/[\s\u3000]+/g, " ");
  }

  function scoreEntry(entry, tokens) {
    var title = normalizedText(entry.title);
    var keywords = normalizedText((entry.keywords || []).join(" "));
    var summary = normalizedText(entry.summary);
    var score = 0;
    tokens.forEach(function (token) {
      if (!token) return;
      if (title.indexOf(token) !== -1) score += 8;
      if (keywords.indexOf(token) !== -1) score += 4;
      if (summary.indexOf(token) !== -1) score += 2;
    });
    return score;
  }

  function initSearch() {
    var form = document.querySelector("[data-search-form]");
    var input = document.querySelector("[data-search-input]");
    var results = document.querySelector("[data-search-results]");
    if (!form || !input || !results) return;
    var entries = [];
    Promise.all([
      loadJson("/data/search-index.json"),
      loadJson("/data/wards.json")
    ]).then(function (payload) {
      entries = payload[0].concat(payload[1].map(function (ward) {
        return {
          title: ward.name + "规则与窗口",
          url: "/tokyo/" + ward.slug + "/",
          summary: ward.restrictionSummary + "；" + ward.department,
          keywords: [ward.name, ward.slug, "东京23区", "区条例", ward.department, ward.status]
        };
      }));
    }).catch(function () {
      results.innerHTML = '<div class="search-empty">搜索数据暂时无法读取，请使用顶部分类导航。</div>';
      results.hidden = false;
    });

    function updateResults() {
      var query = normalizedText(input.value);
      if (query.length < 1) {
        results.hidden = true;
        results.innerHTML = "";
        return;
      }
      var tokens = query.split(" ").filter(Boolean);
      var matches = entries.map(function (entry) {
        return { entry: entry, score: scoreEntry(entry, tokens) };
      }).filter(function (item) {
        return item.score > 0;
      }).sort(function (a, b) {
        return b.score - a.score;
      }).slice(0, 10);

      if (!matches.length) {
        results.innerHTML = '<div class="search-empty">未找到直接结果。可尝试“消防”“180日”“新宿区”“宿泊者名簿”。</div>';
      } else {
        results.innerHTML = matches.map(function (item) {
          return '<a class="search-result" href="' + item.entry.url + '">' +
            "<strong>" + escapeHtml(item.entry.title) + "</strong>" +
            "<span>" + escapeHtml(item.entry.summary) + "</span>" +
          "</a>";
        }).join("");
      }
      results.hidden = false;
    }

    input.addEventListener("input", updateResults);
    input.addEventListener("focus", updateResults);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      updateResults();
      var first = results.querySelector("a");
      if (first) first.focus();
    });
    document.addEventListener("click", function (event) {
      if (!form.contains(event.target)) results.hidden = true;
    });
  }

  function renderWardRow(ward) {
    var rule = ward.minpakuRestriction;
    var statusLabels = { verified: "已核验", partial: "部分核验", pending: "待核验" };
    return '<tr tabindex="0" data-ward="' + escapeHtml(ward.slug) + '">' +
      '<td data-label="区"><a href="/tokyo/' + escapeHtml(ward.slug) + '/"><strong>' + escapeHtml(ward.name) + "</strong></a></td>" +
      '<td data-label="研究状态"><span class="ward-research-status ward-research-status--' + escapeHtml(rule.researchStatus) + '">' + escapeHtml(statusLabels[rule.researchStatus] || rule.researchStatus) + "</span></td>" +
      '<td data-label="区域限制">' + escapeHtml(rule.areaRestriction) + "</td>" +
      '<td data-label="期间限制">' + escapeHtml(rule.periodRestriction) + "</td>" +
      '<td data-label="可运营期间">' + escapeHtml(rule.allowedPeriodSummary) + "</td>" +
      '<td data-label="核验日期">' + (rule.verifiedAt ? '<time datetime="' + escapeHtml(rule.verifiedAt) + '">' + escapeHtml(rule.verifiedAt) + "</time>" : "待核验") + "</td>" +
    "</tr>";
  }

  function renderWardDetail(ward) {
    var rule = ward.minpakuRestriction;
    var statusLabels = { verified: "已核验", partial: "部分核验", pending: "待核验" };
    var changeLabels = { stable: "未发现近期变更", "recent-change": "近期有变更", transition: "处于过渡期" };
    var sourceLinks = rule.officialSources.map(function (source) {
      return '<li><a href="' + escapeHtml(source.url) + '"' + externalAttrs(source.url) + ">" + escapeHtml(source.title) + " ↗</a></li>";
    }).join("");
    return "<h2>" + escapeHtml(ward.name) + "</h2>" +
      '<div class="detail-group"><h3>研究状态</h3><p>' + escapeHtml(statusLabels[rule.researchStatus] || rule.researchStatus) + "；" + escapeHtml(changeLabels[rule.changeStatus] || rule.changeStatus) + "。状态只表示资料核验进度，不代表限制宽松程度。</p></div>" +
      '<div class="detail-group"><h3>区域与期间</h3><p><strong>区域：</strong>' + escapeHtml(rule.areaRestriction) + "</p><p><strong>期间：</strong>" + escapeHtml(rule.periodRestriction) + "</p><p><strong>可运营期间摘要：</strong>" + escapeHtml(rule.allowedPeriodSummary) + "</p></div>" +
      '<div class="detail-group"><h3>家主与管理</h3><p><strong>家主居住型：</strong>' + escapeHtml(rule.ownerOccupiedRule) + "</p><p><strong>家主不在型：</strong>" + escapeHtml(rule.nonOwnerOccupiedRule) + "</p><p><strong>管理业者：</strong>" + escapeHtml(rule.managementRule) + "</p></div>" +
      '<div class="detail-group"><h3>学校、近邻与应急</h3><p><strong>学校周边：</strong>' + escapeHtml(rule.schoolAreaRule) + "</p><p><strong>近邻程序：</strong>" + escapeHtml(rule.neighborNotice) + "</p><p><strong>紧急响应：</strong>" + escapeHtml(rule.emergencyResponse) + "</p></div>" +
      '<div class="detail-group"><h3>垃圾与实务影响</h3><p><strong>垃圾：</strong>' + escapeHtml(rule.wasteRule) + "</p><p><strong>实务影响：</strong>" + escapeHtml(rule.practicalImpact) + "</p></div>" +
      '<div class="detail-group"><h3>过渡说明</h3><p>' + escapeHtml(rule.transitionNote) + "</p></div>" +
      '<div class="detail-group"><h3>主管窗口</h3><p>' + escapeHtml(ward.department) + "<br>" + escapeHtml(ward.phone) + "</p></div>" +
      '<div class="detail-group"><h3>核验</h3><p>生效日：' + escapeHtml(rule.effectiveFrom || "未单列") + "<br>最后核验：" + escapeHtml(rule.verifiedAt || "待核验") + "<br>下次复核：" + escapeHtml(rule.reviewDue || "待核验") + "</p></div>" +
      '<div class="detail-group"><h3>官方来源</h3><ul class="source-link-list">' + sourceLinks + "</ul></div>" +
      '<div class="detail-group"><a class="button button--secondary" href="/tokyo/' + escapeHtml(ward.slug) + '/">查看本区详情</a> <a href="' + escapeHtml(ward.officialUrl) + '"' + externalAttrs(ward.officialUrl) + ">官方页面 ↗</a></div>";
  }

  function initWardDirectory() {
    var tbody = document.querySelector("[data-ward-rows]");
    if (!tbody) return;
    var search = document.querySelector("[data-ward-search]");
    var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-ward-filter]"));
    var detail = document.querySelector("[data-ward-detail]");
    var count = document.querySelector("[data-ward-count]");
    var wards = [];
    var filter = "all";

    function filteredWards() {
      var query = String(search ? search.value : "").toLowerCase().trim().replace(/[\s\u3000]+/g, " ");
      var wardAliases = { "涩谷": "渋谷", "丰岛": "豊島", "台东": "台東" };
      return wards.filter(function (ward) {
        var haystack = normalizedText([
          ward.name, ward.department, ward.restrictionSummary, ward.status,
          ward.minpakuRestriction.areaRestriction,
          ward.minpakuRestriction.periodRestriction,
          ward.minpakuRestriction.allowedPeriodSummary,
          ward.minpakuRestriction.schoolAreaRule,
          ward.minpakuRestriction.managementRule,
          ward.minpakuRestriction.neighborNotice,
          ward.minpakuRestriction.changeStatus,
          ward.tags.join(" ")
        ].join(" "));
        var matchesText = !query || query.split(" ").every(function (token) {
          return haystack.indexOf(token) !== -1 ||
            (wardAliases[token] && haystack.indexOf(wardAliases[token].toLowerCase()) !== -1);
        });
        var rule = ward.minpakuRestriction;
        var matchesFilter = filter === "all" ||
          rule.researchStatus === filter ||
          rule.changeStatus === filter ||
          (filter === "school" && rule.schoolAreaRule !== "待向管辖窗口确认") ||
          (filter === "management" && rule.managementRule !== "待向管辖窗口确认");
        return matchesText && matchesFilter;
      });
    }

    function selectWard(slug) {
      var ward = wards.find(function (item) { return item.slug === slug; });
      if (!ward) return;
      tbody.querySelectorAll("tr").forEach(function (row) {
        row.classList.toggle("is-selected", row.dataset.ward === slug);
      });
      detail.innerHTML = renderWardDetail(ward);
    }

    function render() {
      var list = filteredWards();
      tbody.innerHTML = list.map(renderWardRow).join("");
      count.textContent = String(list.length);
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6">没有符合当前条件的区，请清除筛选。</td></tr>';
        detail.innerHTML = "<h2>无结果</h2><p>请更换关键词或筛选条件。</p>";
        return;
      }
      selectWard(list[0].slug);
    }

    loadJson("/data/wards.json").then(function (data) {
      wards = data;
      render();
    }).catch(function () {
      tbody.innerHTML = '<tr><td colspan="6">23区资料暂时无法加载，请稍后重试。</td></tr>';
    });

    if (search) search.addEventListener("input", render);
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        filter = button.dataset.wardFilter;
        buttons.forEach(function (item) {
          item.setAttribute("aria-pressed", String(item === button));
        });
        render();
      });
    });
    tbody.addEventListener("click", function (event) {
      var row = event.target.closest("tr[data-ward]");
      if (row && !event.target.closest("a")) selectWard(row.dataset.ward);
    });
    tbody.addEventListener("keydown", function (event) {
      var row = event.target.closest("tr[data-ward]");
      if (row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        selectWard(row.dataset.ward);
      }
    });
  }

  function initArticleSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".article-nav a"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var sections = links.map(function (link) {
      return document.querySelector(link.getAttribute("href"));
    }).filter(Boolean);
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.toggle("active", link.getAttribute("href") === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-25% 0px -65% 0px" });
    sections.forEach(function (section) { observer.observe(section); });
  }

  function initExternalLinks() {
    document.querySelectorAll('a[href^="http"]').forEach(function (link) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  function initPrintButtons() {
    document.querySelectorAll("[data-print]").forEach(function (button) {
      button.addEventListener("click", function () { window.print(); });
    });
  }

  function initChecklists() {
    var root = document.querySelector("[data-checklists]");
    if (!root) return;
    var currentType = root.dataset.defaultChecklist || "preopen";
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("mk-checklists") || "{}");
    } catch (error) {
      saved = {};
    }

    loadJson("/data/checklists.json").then(function (data) {
      function persist() {
        localStorage.setItem("mk-checklists", JSON.stringify(saved));
      }

      function render() {
        var groups = data.filter(function (group) {
          return group.types.indexOf(currentType) !== -1;
        });
        root.innerHTML = groups.map(function (group) {
          return '<section class="checklist-group"><h3>' + escapeHtml(group.title) + "</h3>" +
            group.items.map(function (item) {
              var checked = saved[item.id] ? " checked" : "";
              return '<label class="check-row"><input type="checkbox" data-check-id="' + escapeHtml(item.id) + '"' + checked + ">" +
                "<span><p>" + escapeHtml(item.label) + "</p><small>" + escapeHtml(item.note) + "</small></span>" +
                '<span class="check-status">' + (checked ? "已完成" : "未完成") + "</span></label>";
            }).join("") + "</section>";
        }).join("");
      }

      document.querySelectorAll("[data-checklist-type]").forEach(function (button) {
        button.addEventListener("click", function () {
          currentType = button.dataset.checklistType;
          document.querySelectorAll("[data-checklist-type]").forEach(function (item) {
            item.setAttribute("aria-pressed", String(item === button));
          });
          render();
        });
      });
      root.addEventListener("change", function (event) {
        var id = event.target.dataset.checkId;
        if (!id) return;
        saved[id] = event.target.checked;
        persist();
        var status = event.target.closest(".check-row").querySelector(".check-status");
        status.textContent = event.target.checked ? "已完成" : "未完成";
      });
      var reset = document.querySelector("[data-reset-checklists]");
      if (reset) reset.addEventListener("click", function () {
        if (!window.confirm("确定清除当前浏览器保存的全部检查清单进度吗？")) return;
        saved = {};
        localStorage.removeItem("mk-checklists");
        render();
      });
      render();
    }).catch(function () {
      root.innerHTML = '<div class="notice notice--risk">检查清单数据暂时无法读取。</div>';
    });
  }

  function initSourceLibrary() {
    var root = document.querySelector("[data-source-list]");
    if (!root) return;
    var count = document.querySelector("[data-source-count]");
    var authority = document.querySelector("[data-source-authority]");
    var region = document.querySelector("[data-source-region]");
    var system = document.querySelector("[data-source-system]");
    var topic = document.querySelector("[data-source-topic]");
    var sources = [];
    var statusLabels = { current: "当前", transition: "过渡期", "review-soon": "需优先复核" };

    function fillSelect(select, values) {
      if (!select) return;
      var first = select.options[0];
      select.innerHTML = "";
      select.appendChild(first);
      values.sort(function (a, b) { return a.localeCompare(b, "zh-CN"); }).forEach(function (value) {
        var option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
    }

    function unique(field) {
      return Array.from(new Set(sources.map(function (source) { return source[field]; })));
    }

    function uniqueTopics() {
      var values = [];
      sources.forEach(function (source) { values = values.concat(source.topics); });
      return Array.from(new Set(values));
    }

    function renderCard(source) {
      var topics = source.topics.map(function (item) {
        return '<span class="source-topic">' + escapeHtml(item) + "</span>";
      }).join("");
      var related = source.relatedPages.map(function (url) {
        return '<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a>";
      }).join("");
      return '<article class="source-card">' +
        '<div class="source-card__meta"><span>A级</span><span>' + escapeHtml(source.authority) + "</span><span>" + escapeHtml(statusLabels[source.status] || source.status) + "</span></div>" +
        "<h2>" + escapeHtml(source.title) + "</h2>" +
        '<p><strong>制度：</strong>' + escapeHtml(source.system) + "　<strong>地区：</strong>" + escapeHtml(source.region) + "</p>" +
        '<p><strong>文件：</strong>' + escapeHtml(source.documentType) + "　<strong>核验：</strong>" + escapeHtml(source.verifiedAt) + "</p>" +
        '<div class="source-topics" aria-label="主题">' + topics + "</div>" +
        '<a class="source-primary-link" href="' + escapeHtml(source.url) + '"' + externalAttrs(source.url) + ">打开官方原文 ↗</a>" +
        '<div class="source-related"><strong>相关页面</strong>' + related + "</div>" +
      "</article>";
    }

    function render() {
      var values = {
        authority: authority ? authority.value : "",
        region: region ? region.value : "",
        system: system ? system.value : "",
        topic: topic ? topic.value : ""
      };
      var filtered = sources.filter(function (source) {
        return (!values.authority || source.authority === values.authority) &&
          (!values.region || source.region === values.region) &&
          (!values.system || source.system === values.system) &&
          (!values.topic || source.topics.indexOf(values.topic) !== -1);
      });
      count.textContent = String(filtered.length);
      root.innerHTML = filtered.length ? filtered.map(renderCard).join("") : '<div class="notice notice--warning">没有符合当前筛选的官方资料。</div>';
      initExternalLinks();
    }

    loadJson("/data/sources.json").then(function (data) {
      sources = data;
      fillSelect(authority, unique("authority"));
      fillSelect(region, unique("region"));
      fillSelect(system, unique("system"));
      fillSelect(topic, uniqueTopics());
      [authority, region, system, topic].filter(Boolean).forEach(function (select) {
        select.addEventListener("change", render);
      });
      render();
    }).catch(function () {
      root.innerHTML = '<div class="notice notice--risk">官方资料暂时无法读取，请稍后重试。</div>';
    });
  }

  function initSite() {
    if (siteInitialized) return;
    siteInitialized = true;
    renderHeader();
    renderFooter();
    initSearch();
    initWardDirectory();
    initArticleSpy();
    initExternalLinks();
    initPrintButtons();
    initChecklists();
    initSourceLibrary();
  }

  function digestAccessCode(value) {
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.reject(new Error("unsupported"));
    }
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function setProtectedContentLocked(locked) {
    Array.prototype.forEach.call(document.body.children, function (element) {
      if (element.classList.contains("access-gate") || element.classList.contains("access-noscript")) return;
      if (locked) {
        element.setAttribute("aria-hidden", "true");
        element.inert = true;
      } else {
        element.removeAttribute("aria-hidden");
        element.inert = false;
      }
    });
  }

  function renderAccessGate() {
    document.documentElement.classList.remove("access-pending");
    document.documentElement.classList.add("access-locked");
    document.body.classList.add("no-scroll");
    setProtectedContentLocked(true);

    var gate = document.createElement("div");
    gate.className = "access-gate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "access-gate-title");
    gate.innerHTML = '<div class="access-gate__panel">' +
      '<p class="access-gate__brand">Minpaku Knowledge</p>' +
      '<h1 id="access-gate-title">受控资料库</h1>' +
      '<p>请输入访问口令后进入日本民宿・旅馆合规知识库。</p>' +
      '<form class="access-gate__form">' +
        '<label for="access-code">访问口令</label>' +
        '<div class="access-gate__input-row">' +
          '<input id="access-code" name="access-code" type="password" autocomplete="off" required>' +
          '<button class="button button--secondary" type="button" data-access-toggle aria-pressed="false">显示</button>' +
        '</div>' +
        '<p class="access-gate__error" data-access-error role="alert" aria-live="polite"></p>' +
        '<button class="button access-gate__submit" type="submit">进入资料库</button>' +
      '</form>' +
      '<div class="notice notice--warning"><strong>安全说明：</strong>此入口仅用于减少随手访问，不构成加密或真实访问控制。请勿在本站存放客户资料、合同、账号或其他机密信息。</div>' +
    '</div>';
    document.body.prepend(gate);

    var form = gate.querySelector("form");
    var input = gate.querySelector("input");
    var toggle = gate.querySelector("[data-access-toggle]");
    var error = gate.querySelector("[data-access-error]");
    var submit = gate.querySelector("[type=submit]");

    toggle.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.textContent = show ? "隐藏" : "显示";
      toggle.setAttribute("aria-pressed", String(show));
      input.focus();
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      digestAccessCode(input.value).then(function (digest) {
        if (digest !== ACCESS_DIGEST) {
          error.textContent = "访问口令不正确，请重新输入。";
          input.value = "";
          input.focus();
          return;
        }
        try {
          sessionStorage.setItem(ACCESS_SESSION_KEY, "1");
        } catch (storageError) {
          error.textContent = "当前浏览器无法保存会话状态，请检查隐私设置。";
          return;
        }
        gate.remove();
        document.documentElement.classList.remove("access-locked");
        document.documentElement.classList.add("access-granted");
        document.body.classList.remove("no-scroll");
        setProtectedContentLocked(false);
        initSite();
        var main = document.getElementById("main-content");
        if (main) {
          main.setAttribute("tabindex", "-1");
          main.focus();
        }
      }).catch(function () {
        error.textContent = "当前浏览器无法完成本地验证，请使用最新版浏览器。";
      }).finally(function () {
        submit.disabled = false;
      });
    });

    input.focus();
  }

  function init() {
    if (hasAccess()) {
      initSite();
    } else {
      renderAccessGate();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
