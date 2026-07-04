(function () {
  "use strict";

  var BASE = "";
  var DATA_CACHE = {};

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
      ["/tools/decision/", "开始判断", "/tools/decision/"],
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
      "名簿": "宿泊者名簿 本人确认 本人確認"
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
    return '<tr tabindex="0" data-ward="' + escapeHtml(ward.slug) + '">' +
      '<td data-label="区"><a href="/tokyo/' + escapeHtml(ward.slug) + '/"><strong>' + escapeHtml(ward.name) + "</strong></a></td>" +
      '<td data-label="主管窗口">' + escapeHtml(ward.department) + "</td>" +
      '<td data-label="规则摘要">' + escapeHtml(ward.restrictionSummary) + "</td>" +
      '<td data-label="最后核验"><time datetime="' + escapeHtml(ward.lastVerified) + '">' + escapeHtml(ward.lastVerified) + "</time></td>" +
      '<td data-label="状态"><span class="status ' + (ward.statusTone ? "status--" + ward.statusTone : "") + '">' + escapeHtml(ward.status) + "</span></td>" +
    "</tr>";
  }

  function renderWardDetail(ward) {
    return "<h2>" + escapeHtml(ward.name) + "</h2>" +
      '<div class="detail-group"><h3>主管窗口</h3><p>' + escapeHtml(ward.department) + "<br>" + escapeHtml(ward.phone) + "</p></div>" +
      '<div class="detail-group"><h3>规则摘要</h3><p>' + escapeHtml(ward.restrictionSummary) + "</p></div>" +
      '<div class="detail-group"><h3>申请前确认</h3><p>' + escapeHtml(ward.precheck) + "</p></div>" +
      '<div class="detail-group"><h3>核验状态</h3><p>最后核验：' + escapeHtml(ward.lastVerified) + "<br>下次复核：" + escapeHtml(ward.reviewDue) + "</p></div>" +
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
      var query = normalizedText(search ? search.value : "");
      return wards.filter(function (ward) {
        var haystack = normalizedText([
          ward.name, ward.department, ward.restrictionSummary,
          ward.status, ward.tags.join(" ")
        ].join(" "));
        var matchesText = !query || query.split(" ").every(function (token) {
          return haystack.indexOf(token) !== -1;
        });
        var matchesFilter = filter === "all" || ward.tags.indexOf(filter) !== -1;
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
        tbody.innerHTML = '<tr><td colspan="5">没有符合当前条件的区，请清除筛选。</td></tr>';
        detail.innerHTML = "<h2>无结果</h2><p>请更换关键词或筛选条件。</p>";
        return;
      }
      selectWard(list[0].slug);
    }

    loadJson("/data/wards.json").then(function (data) {
      wards = data;
      render();
    }).catch(function () {
      tbody.innerHTML = '<tr><td colspan="5">23区资料暂时无法加载，请稍后重试。</td></tr>';
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

  function initDecisionTool() {
    var root = document.querySelector("[data-decision-tool]");
    if (!root) return;
    var state = { index: 0, answers: {} };
    try {
      var saved = JSON.parse(localStorage.getItem("mk-decision") || "null");
      if (saved && saved.answers) state = saved;
    } catch (error) {
      state = { index: 0, answers: {} };
    }

    Promise.all([
      loadJson("/data/decision-rules.json")
    ]).then(function (payload) {
      var questions = payload[0].questions;
      state.index = Math.min(Math.max(Number(state.index) || 0, 0), questions.length - 1);

      function calculate() {
        var score = { minpaku: 0, ryokan: 0, tokku: 0 };
        var reasons = [];
        var blockers = [];
        var unresolved = [];
        questions.forEach(function (question) {
          var answerId = state.answers[question.id];
          if (!answerId) {
            unresolved.push(question.followup);
            return;
          }
          var option = question.options.find(function (item) { return item.id === answerId; });
          if (!option) return;
          Object.keys(option.score || {}).forEach(function (key) {
            score[key] += option.score[key];
          });
          if (option.reason) reasons.push(option.reason);
          if (option.blocker) blockers.push(option.blocker);
          if (option.unresolved) unresolved.push(option.unresolved);
        });
        var labels = { minpaku: "住宅宿泊事业（民泊）", ryokan: "旅馆业许可", tokku: "大田区特区民泊" };
        var sorted = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
        var inclination = blockers.length ? "先解决阻断项并进行行政咨询" : labels[sorted[0]];
        if (Object.keys(state.answers).length < 3) inclination = "资料不足，暂不判断";
        return {
          inclination: inclination,
          reasons: reasons.slice(0, 5),
          blockers: blockers,
          unresolved: Array.from(new Set(unresolved)).slice(0, 6)
        };
      }

      function persist() {
        localStorage.setItem("mk-decision", JSON.stringify(state));
      }

      function renderResult() {
        var result = calculate();
        root.querySelector("[data-result-title]").textContent = result.inclination;
        root.querySelector("[data-result-reasons]").innerHTML = result.reasons.length
          ? result.reasons.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("")
          : "<li>请继续回答问题。</li>";
        root.querySelector("[data-result-blockers]").innerHTML = result.blockers.length
          ? result.blockers.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("")
          : "<li>目前未识别到确定阻断项；仍须由主管机关确认。</li>";
        root.querySelector("[data-result-unresolved]").innerHTML = result.unresolved.length
          ? result.unresolved.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("")
          : "<li>基础问题已回答，仍需核验具体地址、图纸和主管窗口要求。</li>";
      }

      function renderQuestion() {
        var question = questions[state.index];
        root.querySelector("[data-question-count]").textContent = (state.index + 1) + " / " + questions.length;
        root.querySelector("[data-question-title]").textContent = question.title;
        root.querySelector("[data-options]").innerHTML = question.options.map(function (option) {
          var checked = state.answers[question.id] === option.id ? " checked" : "";
          return '<label class="option-label"><input type="radio" name="decision-option" value="' +
            escapeHtml(option.id) + '"' + checked + "><span>" + escapeHtml(option.label) + "</span></label>";
        }).join("");
        root.querySelectorAll("[data-progress] span").forEach(function (dot, index) {
          dot.className = "progress-dot" + (index < state.index ? " is-complete" : index === state.index ? " is-current" : "");
        });
        root.querySelector("[data-prev]").disabled = state.index === 0;
        root.querySelector("[data-next]").textContent = state.index === questions.length - 1 ? "查看结论" : "继续";
        renderResult();
      }

      root.addEventListener("change", function (event) {
        if (event.target.name !== "decision-option") return;
        state.answers[questions[state.index].id] = event.target.value;
        persist();
        renderResult();
      });
      root.querySelector("[data-prev]").addEventListener("click", function () {
        state.index = Math.max(0, state.index - 1);
        persist();
        renderQuestion();
      });
      root.querySelector("[data-next]").addEventListener("click", function () {
        if (!state.answers[questions[state.index].id]) {
          root.querySelector("[data-question-error]").hidden = false;
          return;
        }
        root.querySelector("[data-question-error]").hidden = true;
        state.index = Math.min(questions.length - 1, state.index + 1);
        persist();
        renderQuestion();
      });
      root.querySelector("[data-reset-decision]").addEventListener("click", function () {
        if (!window.confirm("确定清除当前浏览器保存的判断进度吗？")) return;
        state = { index: 0, answers: {} };
        localStorage.removeItem("mk-decision");
        renderQuestion();
      });
      renderQuestion();
    }).catch(function () {
      root.innerHTML = '<div class="notice notice--risk">判断器数据暂时无法读取。请使用制度比较页和官方窗口进行调查。</div>';
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

  function init() {
    renderHeader();
    renderFooter();
    initSearch();
    initWardDirectory();
    initArticleSpy();
    initExternalLinks();
    initPrintButtons();
    initDecisionTool();
    initChecklists();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
