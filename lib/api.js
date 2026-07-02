(function (global) {
  const { normalizeRegisNumber, validateIsraeliId, cleanText } = global.DundbUtils;
  const {
    parseCompanyHtml,
    mapSearchRow,
    extractSearchRows,
    pageMatchesCompany,
    extractDunsFromHtml,
    extractRegNumberFromHtml,
  } = global.DundbParser;

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

  function extractSearchRowsFromDom(regisNumber) {
    if (/\/CompanyDetails\//i.test(location.pathname || "")) return [];

    const wantReg = normalizeRegisNumber(regisNumber);
    return Array.from(
      document.querySelectorAll("#SearchCompany tbody tr, #SearchCompany tr")
    )
      .map((tr) => extractSearchRows({ PartContent: tr.outerHTML })[0])
      .filter(Boolean)
      .filter((row) => {
        const mapped = mapSearchRow(row);
        const rowReg = normalizeRegisNumber(mapped.regNumber);
        return rowReg && rowReg === wantReg;
      });
  }

  function pickCompanyFromRows(rows, regisNumber, rawInput, totalRows) {
    const mapped = rows.map(mapSearchRow).filter((r) => r.duns || r.nameHe || r.regNumber);
    const wantReg = normalizeRegisNumber(regisNumber);
    const wantRaw = normalizeRegisNumber(rawInput);

    const exact =
      mapped.find((r) => normalizeRegisNumber(r.regNumber) === wantReg) ||
      mapped.find((r) => normalizeRegisNumber(r.regNumber) === wantRaw);

    if (exact) return exact;

    if (mapped.length === 1 && totalRows === 1) {
      return { ...mapped[0], regNumber: mapped[0].regNumber || regisNumber };
    }

    throw new Error("לא נמצאה חברה עם מספר ח.פ. זה");
  }

  function resolveRegNumber(parsed, regisNumber, htmlSources = [], companyDuns = "") {
    const wantReg = normalizeRegisNumber(regisNumber);
    let gotReg = normalizeRegisNumber(parsed.regNumber);
    if (gotReg && wantReg && gotReg === wantReg) return gotReg;

    for (const html of htmlSources) {
      const extracted = extractRegNumberFromHtml(html, wantReg, companyDuns);
      if (extracted) {
        gotReg = normalizeRegisNumber(extracted);
        if (gotReg && (!wantReg || gotReg === wantReg)) return gotReg;
      }
    }

    if (wantReg && companyDuns) {
      for (const html of htmlSources) {
        if (extractDunsFromHtml(html, companyDuns) === companyDuns) {
          return wantReg;
        }
      }
      if (parsed.duns === companyDuns) return wantReg;
    }

    return gotReg || "";
  }

  function htmlConfirmsCompany(htmlSources, companyDuns) {
    if (!companyDuns) return false;
    return htmlSources.some((html) => extractDunsFromHtml(html, companyDuns) === companyDuns);
  }

  function verifyFetchedCompany(parsed, company, regisNumber, htmlSources = []) {
    const wantReg = normalizeRegisNumber(regisNumber || company.regNumber);
    if (!wantReg) return;

    const gotReg = resolveRegNumber(parsed, regisNumber, htmlSources, company.duns);
    if (!gotReg || gotReg === wantReg) return;

    const dunsConfirmed =
      htmlConfirmsCompany(htmlSources, company.duns) || parsed.duns === company.duns;
    if (dunsConfirmed && cleanText(parsed.nameHe)) {
      return;
    }

    throw new Error("הנתונים שהתקבלו לא תואמים לח.פ. — רעננו את לשונית D&B ונסו שוב");
  }

  function enrichFromSearch(details, company, regisNumber) {
    const wantReg = normalizeRegisNumber(regisNumber);
    const searchReg = normalizeRegisNumber(company.regNumber);
    if (searchReg && wantReg && searchReg !== wantReg) return details;

    const fields = [
      "nameHe",
      "nameEn",
      "address",
      "score",
      "employees",
      "status",
      "sector",
      "activity",
      "phones",
    ];
    for (const key of fields) {
      const current = details[key];
      const incoming = company[key];
      if (Array.isArray(current) && current.length) continue;
      if (!cleanText(current) && incoming) {
        details[key] = incoming;
      }
    }
    return details;
  }

  function shouldAcceptMergeField(key, value) {
    const text = cleanText(value);
    if (!text || text === "—" || text === "-" || text === "–") return false;

    switch (key) {
      case "regNumber":
        return /^\d{5,9}$/.test(text.replace(/-/g, ""));
      case "legalStatus":
        return (
          !/^(פעיל|פעילה|active|לא\s*פעיל|לא\s*פעילה)$/i.test(text) &&
          !/מחזור|סוג מניה|חברות בת|חברות אם|^-/.test(text) &&
          text.length < 80
        );
      case "status":
        return DundbUtils.isInactiveStatus(text) || DundbUtils.isActiveStatus(text);
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
      if (key === "status") {
        const incoming = DundbUtils.normalizeStatusLabel(value);
        if (!incoming || !shouldAcceptMergeField(key, incoming)) continue;
        const existing = DundbUtils.normalizeStatusLabel(merged[key]);
        if (DundbUtils.isInactiveStatus(existing) && DundbUtils.isActiveStatus(incoming)) {
          continue;
        }
        merged[key] = incoming;
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
    const payload = json?.d && typeof json.d === "object" ? json.d : json;
    const totalRows =
      payload?.totalRowsCount ?? payload?.TotalRowsCount ?? rows.length;
    if (!rows.length) {
      rows = extractSearchRowsFromDom(regisNumber);
    }

    if (!rows.length) {
      if (totalRows > 0) {
        throw new Error("נמצאו תוצאות אך לא ניתן לפענח — השתמשו ב׳קח מהדף הנוכחי׳");
      }
      throw new Error("לא נמצאה חברה עם מספר ח.פ. זה");
    }

    let company = pickCompanyFromRows(rows, regisNumber, rawInput, totalRows);
    if (!company.duns) {
      const fromPayload = DundbParser.extractDunsFromHtml(JSON.stringify(json));
      if (fromPayload) company = { ...company, duns: fromPayload };
    }
    return { company, regisNumber };
  }

  function livePageMatchesCompany(company) {
    if (!company?.regNumber) return false;
    if (pageMatchesCompany(document, company)) return true;

    const dunsMatch = location.search.match(/[?&]duns=([^&]+)/i);
    if (dunsMatch && company.duns) {
      return decodeURIComponent(dunsMatch[1]) === company.duns;
    }

    return false;
  }

  function isCompanyPageReady(regisNumber, duns) {
    if (!DundbApi.isOnSite()) return false;
    if (!/\/CompanyDetails\//i.test(location.pathname || "")) return false;

    const wantReg = normalizeRegisNumber(regisNumber);
    const html = document.documentElement.outerHTML;
    const parsed = parseCompanyHtml(html, { duns: duns || "", regNumber }, document);
    const gotReg = resolveRegNumber(parsed, regisNumber, [html], duns);

    return !!(parsed.nameHe && gotReg && gotReg === wantReg);
  }

  function pickParsedHtmlSource(payload, regisNumber, companyDuns) {
    const wantReg = normalizeRegisNumber(regisNumber);
    const fallback = { duns: companyDuns || "", regNumber: regisNumber || "" };
    const sources = [
      { html: payload.indexHtml, label: "index" },
      { html: payload.fullHtml, label: "full" },
    ];

    for (const source of sources) {
      if (!source.html) continue;
      const parsed = parseCompanyHtml(source.html, fallback);
      const gotReg = resolveRegNumber(parsed, regisNumber, [source.html], companyDuns);
      if (wantReg && gotReg === wantReg) {
        return { parsed, html: source.html };
      }
    }

    for (const source of sources) {
      if (!source.html || !companyDuns) continue;
      if (extractDunsFromHtml(source.html, companyDuns) === companyDuns) {
        return {
          parsed: parseCompanyHtml(source.html, fallback),
          html: source.html,
        };
      }
    }

    if (payload.indexHtml) {
      const parsed = parseCompanyHtml(payload.indexHtml, fallback);
      if (
        wantReg &&
        htmlConfirmsCompany([payload.indexHtml], companyDuns)
      ) {
        parsed.regNumber = wantReg;
      }
      return {
        parsed,
        html: payload.indexHtml,
      };
    }

    throw new Error("לא ניתן לטעון נתוני חברה — רעננו את לשונית D&B ונסו שוב");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForRenderedCompany(company, regisNumber, maxMs = 5000) {
    if (!DundbApi.isOnSite()) return null;

    const wantReg = normalizeRegisNumber(regisNumber || company.regNumber);
    const start = Date.now();

    while (Date.now() - start < maxMs) {
      if (/\/CompanyDetails\//i.test(location.pathname || "")) {
        const html = document.documentElement.outerHTML;
        const parsed = parseCompanyHtml(html, { duns: company.duns, regNumber }, document);
        const gotReg = resolveRegNumber(parsed, regisNumber, [html], company.duns);
        if (parsed.nameHe && gotReg && gotReg === wantReg) {
          return parsed;
        }
      }
      await sleep(200);
    }

    return null;
  }

  async function loadLiveExtras(company, regisNumber) {
    try {
      return await callPageBridge("READ_LIVE_EXTRAS", {
        duns: company.duns,
        regNumber: regisNumber || company.regNumber,
      });
    } catch {
      return {};
    }
  }

  async function loadCompanyDetails(company, regisNumber, options = {}) {
    if (!company.duns) {
      return DundbUtils.normalizeCompanyData({ ...company });
    }

    const companyCtx = {
      ...company,
      regNumber: company.regNumber || regisNumber,
    };
    const useLiveDom =
      !options.backgroundMode &&
      typeof document !== "undefined" &&
      !document.hidden;

    if (useLiveDom && DundbApi.isOnSite()) {
      const liveParsed = await waitForRenderedCompany(companyCtx, regisNumber);
      if (liveParsed) {
        const liveExtras = await loadLiveExtras(companyCtx, regisNumber);
        const merged = mergeCompanyData(
          { duns: company.duns },
          mergeCompanyData(liveParsed, liveExtras)
        );
        merged.duns = company.duns;
        merged.regNumber = merged.regNumber || regisNumber;
        return DundbUtils.normalizeCompanyData(
          enrichFromSearch(merged, companyCtx, regisNumber)
        );
      }

      if (isCompanyPageReady(regisNumber, company.duns)) {
        const html = document.documentElement.outerHTML;
        const liveParsedLate = parseCompanyHtml(
          html,
          { duns: company.duns, regNumber: regisNumber },
          document
        );
        const liveExtras = await loadLiveExtras(companyCtx, regisNumber);
        const merged = mergeCompanyData(
          { duns: company.duns },
          mergeCompanyData(liveParsedLate, liveExtras)
        );
        merged.duns = company.duns;
        merged.regNumber = merged.regNumber || regisNumber;
        return DundbUtils.normalizeCompanyData(
          enrichFromSearch(merged, companyCtx, regisNumber)
        );
      }
    }

    const payload = await callPageBridge("LOAD_COMPANY_PAGES", {
      duns: company.duns,
      regNumber: regisNumber || company.regNumber,
      fastMode: options.fastMode ?? !!options.backgroundMode,
    });

    const htmlSources = [payload.indexHtml, payload.fullHtml].filter(Boolean);
    const { parsed: parsedIndex } = pickParsedHtmlSource(
      payload,
      regisNumber,
      company.duns
    );
    verifyFetchedCompany(parsedIndex, company, regisNumber, htmlSources);

    const parsedFull = payload.fullHtml
      ? parseCompanyHtml(payload.fullHtml, { duns: company.duns, regNumber: regisNumber })
      : {};
    if (payload.fullHtml) {
      const fullReg = resolveRegNumber(parsedFull, regisNumber, [payload.fullHtml], company.duns);
      const wantReg = normalizeRegisNumber(regisNumber);
      if (!fullReg || fullReg === wantReg) {
        verifyFetchedCompany(
          mergeCompanyData(parsedIndex, parsedFull),
          company,
          regisNumber,
          htmlSources
        );
      }
    }

    const parsedLive = payload.liveExtras || {};

    const merged = mergeCompanyData(
      { duns: company.duns },
      mergeCompanyData(parsedFull, mergeCompanyData(parsedIndex, parsedLive))
    );

    if (
      !options.backgroundMode &&
      typeof window !== "undefined" &&
      DundbApi.isOnSite() &&
      /\/CompanyDetails\//i.test(window.location.pathname || "") &&
      livePageMatchesCompany(company)
    ) {
      const livePage = parseCompanyHtml(
        document.documentElement.outerHTML,
        { duns: company.duns, regNumber: regisNumber },
        document
      );
      verifyFetchedCompany(livePage, company, regisNumber, [
        document.documentElement.outerHTML,
      ]);
      Object.assign(merged, mergeCompanyData(merged, livePage));
    }

    if (!merged.duns) merged.duns = company.duns;
    if (!merged.regNumber) merged.regNumber = regisNumber || company.regNumber;
    return DundbUtils.normalizeCompanyData(
      enrichFromSearch(merged, companyCtx, regisNumber)
    );
  }

  async function lookupByRegis(regisInput) {
    const { company, regisNumber } = await searchCompany(regisInput);
    const details = await loadCompanyDetails(
      {
        ...company,
        regNumber: company.regNumber || regisNumber,
      },
      regisNumber
    );

    details.regNumber = details.regNumber || regisNumber;
    return DundbUtils.normalizeCompanyData(enrichFromSearch(details, company, regisNumber));
  }

  async function searchByRegis(regisInput) {
    return searchCompany(regisInput);
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
    searchByRegis,
    loadCompanyDetails,
    isCompanyPageReady,
    parseCurrentPage,
    isOnSite: () => location.hostname === "members.dundb.co.il",
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
