(function () {
  if (window.__dundbSupervisorBridge) return;
  window.__dundbSupervisorBridge = true;

  const MSG_SOURCE = "dundb-supervisor";
  const MSG_RESPONSE = "dundb-supervisor-response";

  function completeReginNum(value) {
    let num = String(value || "").replace(/-/g, "").trim();
    if (!num) return num;
    while (num.length < 9) num = "0" + num;
    return num;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function textOf(el) {
    if (!el) return "";
    return cleanText(el.textContent || el.innerText || "");
  }

  function requireJQuery() {
    if (typeof window.jQuery === "undefined") {
      throw new Error("הדף עדיין נטען — רעננו את לשונית D&B ונסו שוב");
    }
    return window.jQuery;
  }

  function searchWithJQuery(regisNumber) {
    const $ = requireJQuery();
    const postData =
      "&page=1" +
      "&CompanyName=" +
      encodeURIComponent("") +
      "&RegisNumber=" +
      encodeURIComponent(regisNumber) +
      "&City=" +
      encodeURIComponent("") +
      "&Address=" +
      encodeURIComponent("") +
      "&JobOwnerName=" +
      encodeURIComponent("") +
      "&CompanySic=" +
      encodeURIComponent("") +
      "&SelectedSearchType=" +
      encodeURIComponent("0") +
      "&SelectedSearchTypeInputNumber=" +
      encodeURIComponent("");

    return $.ajax({
      url: "/SearchApi/SearchCompany",
      type: "POST",
      data: postData,
      dataType: "json",
    });
  }

  function loadCompanyIndex(duns) {
    const $ = requireJQuery();
    return $.ajax({
      url: "/CompanyDetails/Index?duns=" + encodeURIComponent(duns),
      type: "GET",
      dataType: "html",
    });
  }

  function loadCompanyFullDetails(duns) {
    const $ = requireJQuery();
    return $.ajax({
      url: "/CompanyDetails/FullDetails?duns=" + encodeURIComponent(duns),
      type: "GET",
      dataType: "html",
    });
  }

  function findIndustryScoreLive() {
    const titleEl = Array.from(
      document.querySelectorAll("div, span, td, th, label, p, b, strong")
    ).find((el) => textOf(el) === "סקור ענפי" || textOf(el).includes("סקור ענפי"));

    if (!titleEl) return "";

    let box = titleEl.parentElement;
    for (let depth = 0; depth < 10 && box; depth++, box = box.parentElement) {
      const boxText = textOf(box);
      if (!boxText.includes("סקור ענפי")) continue;
      if (/ותק עסק|מספר מועסקים/.test(boxText) && boxText.indexOf("סקור ענפי") > 40) continue;
      if (boxText.length > 280) continue;

      const scoreEl = box.querySelector(".scorenumber");
      if (scoreEl) {
        const digits = textOf(scoreEl).replace(/[^\d]/g, "");
        const n = Number(digits);
        if (n >= 1 && n <= 100) return String(n);
      }

      for (const el of box.querySelectorAll("span, div, b, strong, font, p")) {
        const t = textOf(el);
        if (/^\d{1,3}$/.test(t)) {
          const n = Number(t);
          if (n >= 10 && n <= 100) return String(n);
        }
      }

      const after = boxText.split("סקור ענפי").slice(1).join("");
      const nums = after.replace(/\([^)]*\)/g, " ").match(/\b(\d{1,3})\b/g) || [];
      for (const num of nums) {
        const n = Number(num);
        if (n >= 10 && n <= 100) return String(n);
      }
    }

    return "";
  }

  function readLiveCompanyExtras() {
    if (!/\/CompanyDetails\//i.test(location.pathname || "")) return {};

    const extras = {};
    const score = findIndustryScoreLive();
    if (score) extras.score = score;
    return extras;
  }

  function isLoginHtml(html) {
    return (
      /name="UserName"/i.test(html) ||
      /name="AuthenticationCode"/i.test(html) ||
      /ClientAuthentication/i.test(html)
    );
  }

  async function handleRequest(data) {
    if (data.type === "SEARCH_HP") {
      const regisNumber = completeReginNum(data.regNumber);
      if (!regisNumber) throw new Error("יש להזין מספר ח.פ.");
      return searchWithJQuery(regisNumber);
    }

    if (data.type === "LOAD_COMPANY_INDEX") {
      if (!data.duns) throw new Error("חסר מזהה חברה");
      const html = await loadCompanyIndex(data.duns);
      if (typeof html === "string" && isLoginHtml(html)) {
        throw new Error("הסשן של D&B פג — התחברו מחדש בלשונית הפתוחה");
      }
      return html;
    }

    if (data.type === "LOAD_COMPANY_PAGES") {
      if (!data.duns) throw new Error("חסר מזהה חברה");
      const indexHtml = await loadCompanyIndex(data.duns);
      if (typeof indexHtml === "string" && isLoginHtml(indexHtml)) {
        throw new Error("הסשן של D&B פג — התחברו מחדש בלשונית הפתוחה");
      }

      let fullHtml = "";
      try {
        fullHtml = await loadCompanyFullDetails(data.duns);
        if (
          typeof fullHtml === "string" &&
          (isLoginHtml(fullHtml) || /Content-Type.*javascript/i.test(fullHtml))
        ) {
          fullHtml = "";
        }
      } catch {
        fullHtml = "";
      }

      return {
        indexHtml,
        fullHtml,
        liveExtras: readLiveCompanyExtras(),
      };
    }

    throw new Error("בקשה לא מוכרת");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MSG_SOURCE) return;
    if (!event.data.type || !event.data.id) return;

    const respond = (payload) =>
      window.postMessage(
        { source: MSG_RESPONSE, id: event.data.id, ...payload },
        "*"
      );

    handleRequest(event.data)
      .then((result) => respond({ ok: true, result }))
      .catch((error) =>
        respond({ ok: false, error: error.message || String(error) })
      );
  });
})();
