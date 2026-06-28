(function (global) {
  const { normalizeRegisNumber, validateIsraeliId, cleanText } = global.DundbUtils;
  const { parseCompanyHtml, mapSearchRow, extractSearchRows } = global.DundbParser;

  const MSG_SOURCE = "dundb-supervisor";
  const MSG_RESPONSE = "dundb-supervisor-response";

  function callPageBridge(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("תם הזמן — נסו שוב"));
      }, 45000);

      function onMessage(event) {
        if (
          event.source !== window ||
          event.data?.source !== MSG_RESPONSE ||
          event.data.id !== id
        ) {
          return;
        }
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error || "שגיאה"));
      }

      window.addEventListener("message", onMessage);
      window.postMessage({ source: MSG_SOURCE, type, id, ...payload }, "*");
    });
  }

  function extractSearchRowsFromDom() {
    return Array.from(
      document.querySelectorAll("#SearchCompany tbody tr, #SearchCompany tr")
    )
      .map((tr) => extractSearchRows({ PartContent: tr.outerHTML })[0])
      .filter(Boolean);
  }

  function pickCompanyFromRows(rows, regisNumber, rawInput) {
    const mapped = rows.map(mapSearchRow).filter((r) => r.duns || r.nameHe || r.regNumber);
    const exact =
      mapped.find((r) => normalizeRegisNumber(r.regNumber) === regisNumber) ||
      mapped.find(
        (r) => normalizeRegisNumber(r.regNumber) === normalizeRegisNumber(rawInput)
      ) ||
      mapped[0];

    if (!exact?.duns && !exact?.nameHe) {
      throw new Error("לא נמצאה חברה עם מספר ח.פ. זה");
    }
    return exact;
  }

  function shouldAcceptMergeField(key, value) {
    const text = cleanText(value);
    if (!text || text === "—" || text === "-" || text === "–") return false;

    switch (key) {
      case "regNumber":
        return /^\d{5,9}$/.test(text.replace(/-/g, ""));
      case "legalStatus":
        return (
          !/^(פעיל|פעילה|active)$/i.test(text) &&
          !/מחזור|סוג מניה|חברות בת|חברות אם|^-/.test(text) &&
          text.length < 80
        );
      case "score":
        return DundbUtils.parseScore(text) !== null;
      case "website":
        return /^https?:\/\//i.test(text) || /^www\./i.test(text);
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
      case "seniorityYears":
      case "employees":
        return /^\d{1,5}$/.test(text.replace(/[^\d]/g, ""));
      default:
        return !/^(סוג מניה|מחזור הכנסות|חברות בת|חברות אם)$/.test(text);
    }
  }

  function mergeCompanyData(base, extra) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(extra || {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        if (value.length) merged[key] = value;
        continue;
      }
      if (!shouldAcceptMergeField(key, value)) continue;
      const text = cleanText(value);
      if (text && text !== "—") {
        merged[key] = value;
      } else if (!cleanText(merged[key])) {
        merged[key] = value;
      }
    }
    return merged;
  }

  async function searchCompany(regisInput) {
    const regisNumber = normalizeRegisNumber(regisInput);
    const rawInput = String(regisInput || "").replace(/-/g, "").trim();

    if (!rawInput) throw new Error("יש להזין מספר ח.פ.");
    if (!validateIsraeliId(rawInput) && !validateIsraeliId(regisNumber)) {
      throw new Error("מספר ח.פ. לא תקין");
    }

    const json = await callPageBridge("SEARCH_HP", { regNumber: regisNumber });

    if (!json || typeof json !== "object") {
      throw new Error("תשובה ריקה — ודאו שאתם מחוברים ל-D&B");
    }

    let rows = extractSearchRows(json);
    if (!rows.length) {
      rows = extractSearchRowsFromDom();
    }

    if (!rows.length) {
      const total = json.totalRowsCount ?? json.TotalRowsCount;
      if (total > 0) {
        throw new Error("נמצאו תוצאות אך לא ניתן לפענח — השתמשו ב׳קח מהדף הנוכחי׳");
      }
      throw new Error("לא נמצאה חברה עם מספר ח.פ. זה");
    }

    let company = pickCompanyFromRows(rows, regisNumber, rawInput);
    if (!company.duns) {
      const fromPayload = DundbParser.extractDunsFromHtml(JSON.stringify(json));
      if (fromPayload) company = { ...company, duns: fromPayload };
    }
    return { company, regisNumber };
  }

  async function loadCompanyDetails(company) {
    if (!company.duns) {
      return DundbUtils.normalizeCompanyData({ ...company });
    }

    const payload = await callPageBridge("LOAD_COMPANY_PAGES", { duns: company.duns });
    const parsedIndex = parseCompanyHtml(payload.indexHtml, company);
    const parsedFull = payload.fullHtml
      ? parseCompanyHtml(payload.fullHtml, parsedIndex)
      : {};
    const parsedLive = payload.liveExtras || {};

    const merged = mergeCompanyData(
      company,
      mergeCompanyData(parsedFull, mergeCompanyData(parsedIndex, parsedLive))
    );

    if (
      typeof window !== "undefined" &&
      DundbApi.isOnSite() &&
      /\/CompanyDetails\//i.test(window.location.pathname || "")
    ) {
      const livePage = parseCompanyHtml(
        document.documentElement.outerHTML,
        merged,
        document
      );
      Object.assign(merged, mergeCompanyData(merged, livePage));
    }

    if (!merged.duns) merged.duns = company.duns;
    return DundbUtils.normalizeCompanyData(merged);
  }

  async function lookupByRegis(regisInput) {
    const { company, regisNumber } = await searchCompany(regisInput);
    const details = await loadCompanyDetails({
      ...company,
      regNumber: company.regNumber || regisNumber,
    });

    if (!details.nameHe && company.nameHe) details.nameHe = company.nameHe;
    if (!details.regNumber) details.regNumber = regisNumber;
    return DundbUtils.normalizeCompanyData(details);
  }

  function parseCurrentPage() {
    const url = window.location.href;
    const dunsMatch = url.match(/[?&]duns=([^&]+)/i);
    const fallback = {
      duns: dunsMatch ? decodeURIComponent(dunsMatch[1]) : "",
    };
    return DundbUtils.normalizeCompanyData(
      parseCompanyHtml(document.documentElement.outerHTML, fallback, document)
    );
  }

  global.DundbApi = {
    lookupByRegis,
    parseCurrentPage,
    isOnSite: () => location.hostname === "members.dundb.co.il",
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
