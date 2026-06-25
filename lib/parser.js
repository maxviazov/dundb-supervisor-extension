(function (global) {
  const { cleanText, pickFirst } = global.DundbUtils;

  const ACTIVE_STATUS_RE = /^(פעיל|פעילה|active)$/i;

  const LABELS = {
    regNumber: ["מספר רישום", "ח.פ.", 'ח"פ', "מס' רישום"],
    legalStatus: ["מעמד משפטי"],
    sector: ["מגזר"],
    activity: ["אופי פעילות", "תחום פעילות"],
    mainIndustry: ["ענף ראשי"],
    subIndustry: ["ענף משני"],
    address: ["כתובת"],
    phone: ["טלפון"],
    email: ["אימייל", 'דוא"ל', "דואל"],
    website: ["אתר אינטרנט", "אתר"],
    score: ["סקור ענפי", "סקור", "ציון", "דירוג"],
    seniority: ["ותק עסק", "ותק"],
    employees: ["מספר מועסקים", "מועסקים"],
    status: ["סטטוס", "מצב פעילות"],
    founded: ["שנת יסוד", "שנת הקמה"],
  };

  function textOf(el) {
    if (!el) return "";
    return cleanText(el.textContent || el.innerText || "");
  }

  function unwrapSearchJson(json) {
    if (!json || typeof json !== "object") return json;
    if (json.d && typeof json.d === "object") return json.d;
    if (json.data && typeof json.data === "object") return json.data;
    return json;
  }

  function extractDunsFromHtml(html) {
    if (!html) return "";
    return (
      (html.match(/\bduns=["'](\d{6,12})["']/i) || [])[1] ||
      (html.match(/[?&]duns=(\d{6,12})/i) || [])[1] ||
      (html.match(/"Duns"\s*:\s*"?(\d{6,12})"?/i) || [])[1] ||
      (html.match(/\bduns\s*[:=]\s*['"]?(\d{6,12})/i) || [])[1] ||
      ""
    );
  }

  function parseSearchHtmlRows(html) {
    const rows = [];
    const wrapped = html.trim().startsWith("<") ? html : `<table><tbody>${html}</tbody></table>`;
    const doc = new DOMParser().parseFromString(wrapped, "text/html");

    doc.querySelectorAll("tr").forEach((tr) => {
      const row = extractRowFromElement(tr);
      if (row.duns || row.nameHe || row.regNumber) rows.push(row);
    });

    if (!rows.length) {
      doc.querySelectorAll("[duns], [data-duns]").forEach((el) => {
        const row = extractRowFromElement(el.closest("tr, div, li, a") || el);
        if (row.duns || row.nameHe || row.regNumber) rows.push(row);
      });
    }

    return rows;
  }

  function extractRowFromElement(el) {
    if (!el) return {};
    const html = el.outerHTML || "";
    const text = textOf(el);

    const link = el.querySelector(
      "a[href*='CompanyDetails'], a[href*='duns='], a[onclick*='duns']"
    );
    const hrefDuns = link
      ? (link.getAttribute("href") || link.getAttribute("onclick") || "").match(
          /[?&]duns=(\d{6,12})/i
        )?.[1] || ""
      : "";

    const duns =
      el.getAttribute("duns") ||
      el.getAttribute("data-duns") ||
      el.getAttribute("data-Duns") ||
      extractDunsFromHtml(html) ||
      hrefDuns;

    const regNumber =
      (text.match(/\b\d{5,9}\b/) || [])[0] ||
      (html.match(/Regis(?:Number|Num)?[=:"'\s]+(\d{5,9})/i) || [])[1] ||
      "";

    return {
      Duns: duns,
      CompanyName:
        textOf(el.querySelector("a, .company_name, td:nth-child(1)")) ||
        text.split("\n")[0],
      RegisNumber: regNumber,
    };
  }

  function extractSearchRows(json) {
    const data = unwrapSearchJson(json);
    if (!data) return [];

    let part = data.PartContent ?? data.partContent ?? data.Content ?? data.content;

    if (Array.isArray(part)) {
      if (part.length && typeof part[0] === "object") return part;
      return [];
    }

    if (typeof part === "string" && part.trim()) {
      const fromHtml = parseSearchHtmlRows(part);
      if (fromHtml.length) return fromHtml;
    }

    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.Results)) return data.Results;

    return [];
  }

  function findValueByLabels(root, labels) {
    const all = Array.from(
      root.querySelectorAll("td, th, label, span, div, li, p, strong, b")
    );
    for (const el of all) {
      const own = textOf(el);
      if (!own || own.length > 120) continue;
      const matched = labels.some(
        (label) =>
          own === label || own.startsWith(label + ":") || own.startsWith(label + " ")
      );
      if (!matched) continue;

      const sibling = el.nextElementSibling;
      if (sibling) {
        const val = textOf(sibling);
        if (val && val !== own) return val;
      }

      const parent = el.parentElement;
      if (parent) {
        const children = Array.from(parent.children).filter((c) => c !== el);
        for (const child of children) {
          const val = textOf(child);
          if (val && val !== own && !labels.includes(val)) return val;
        }
      }

      const afterColon = own.split(":").slice(1).join(":").trim();
      if (afterColon) return afterColon;
    }
    return "";
  }

  function parseScoreDigits(raw) {
    const digits = cleanText(raw).replace(/[^\d]/g, "");
    if (!digits) return "";
    const n = Number(digits);
    if (Number.isNaN(n) || n < 1 || n > 100) return "";
    return String(n);
  }

  function extractScoreFromSource(html) {
    if (!html) return "";

    const classMatch = html.match(
      /class=["'][^"']*scorenumber[^"']*["'][^>]*>\s*(\d{1,3})\s*</i
    );
    if (classMatch) {
      const parsed = parseScoreDigits(classMatch[1]);
      if (parsed) return parsed;
    }

    const patterns = [
      /DunsScore["'\s:=]+(\d{1,3})/gi,
      /SectorScore["'\s:=]+(\d{1,3})/gi,
      /ScoreValue["'\s:=]+(\d{1,3})/gi,
      /"Score"\s*:\s*(\d{1,3})/gi,
      /data-score=["'](\d{1,3})["']/gi,
    ];

    for (const re of patterns) {
      let match;
      while ((match = re.exec(html)) !== null) {
        const parsed = parseScoreDigits(match[1]);
        if (parsed) return parsed;
      }
    }

    return "";
  }

  function findSectorScore(root, fallback, htmlSource = "") {
    const selectors = [
      "#compDetailsDunsScore .scorenumber",
      ".score-metric .scorenumber",
      ".scorenumber",
      "#compDetailsDunsScore",
      "[id*='DunsScore'] .scorenumber",
      "[id*='DunsScore']",
    ];

    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      if (el.closest("#Legend, .rating-scale, .scale-bar, [id*='ScoreGraph']")) continue;
      const parsed = parseScoreDigits(textOf(el));
      if (parsed) return parsed;
    }

    const fromCard = findMetricCardValue(root, LABELS.score);
    if (fromCard) {
      const parsed = parseScoreDigits(fromCard);
      if (parsed) return parsed;
    }

    const fromSource = extractScoreFromSource(htmlSource);
    if (fromSource) return fromSource;

    return parseScoreDigits(fallback.score);
  }

  function findMetricCardValue(root, labels) {
    const candidates = Array.from(
      root.querySelectorAll("div, span, td, p, h4, h5, label, section")
    );
    for (const el of candidates) {
      const labelText = textOf(el);
      if (!labels.some((l) => labelText === l || labelText.startsWith(l))) continue;

      let box = el.parentElement;
      for (let depth = 0; depth < 5 && box; depth++, box = box.parentElement) {
        const boxText = textOf(box);
        if (boxText.length > 200) break;
        if (/סרגל הדירוג|85-53|52-16|15-0/.test(boxText)) continue;

        const big = box.querySelector(".scorenumber, .metric-value, b, strong");
        if (big) {
          const v = textOf(big);
          if (v && v !== labelText && /\d/.test(v)) {
            if (labels === LABELS.score) {
              const parsed = parseScoreDigits(v);
              if (parsed) return parsed;
            } else {
              return v;
            }
          }
        }

        const idx = boxText.indexOf(labelText);
        if (idx < 0) continue;
        const afterLabel = boxText.slice(idx + labelText.length).trim();
        const numMatch = afterLabel.match(/^[\s:.\-–—]*(\d{1,3})\b/);
        if (numMatch) return numMatch[1];
      }
    }
    return "";
  }

  function findStatusBadge(root, fallback) {
    const selectors = [
      ".statusActive",
      ".status-active",
      ".company-status",
      ".badge-active",
      ".label-success",
    ];
    for (const sel of selectors) {
      const t = textOf(root.querySelector(sel));
      if (ACTIVE_STATUS_RE.test(t)) return t;
    }
    const statusVal = findValueByLabels(root, LABELS.status);
    if (ACTIVE_STATUS_RE.test(statusVal)) return statusVal;
    return pickFirst(fallback.status);
  }

  function findLegalStatus(root, fallback) {
    let val = findValueByLabels(root, LABELS.legalStatus);
    if (ACTIVE_STATUS_RE.test(val)) val = "";
    return pickFirst(val, fallback.legalStatus);
  }

  function findEmail(root, fallback) {
    const emailEl = root.querySelector('a[href^="mailto:"]');
    const fromLink = emailEl
      ? emailEl.getAttribute("href").replace(/^mailto:/i, "").split("?")[0]
      : "";
    const fromLabel = findValueByLabels(root, LABELS.email);
    const fromRegex = textOf(root.body || root).match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    );
    return pickFirst(fromLink, fromLabel, fromRegex?.[0], fallback.email);
  }

  function findWebsite(root, fallback) {
    const links = Array.from(
      root.querySelectorAll('a[href^="http"], a[href^="www."]')
    );
    for (const a of links) {
      const href = cleanText(a.getAttribute("href"));
      if (!href || /dundb|facebook|google|linkedin|youtube|instagram/i.test(href)) {
        continue;
      }
      return href;
    }
    return pickFirst(findValueByLabels(root, LABELS.website), fallback.website);
  }

  function normalizeEmployees(val) {
    const t = cleanText(val);
    if (!t || t === "-" || t === "–" || t === "—") return "";
    if (/\d+\s*-\s*\d+/.test(t)) return t.replace(/\s+/g, "");
    const digits = t.replace(/[^\d]/g, "");
    return digits || t;
  }

  function collectPhones(root) {
    const phones = new Set();
    root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const p = cleanText(a.getAttribute("href").replace(/^tel:/, ""));
      if (p) phones.add(p);
    });

    const phoneBlock = findValueByLabels(root, LABELS.phone);
    if (phoneBlock) {
      phoneBlock.split(/[,;|\n]/).forEach((part) => {
        const p = cleanText(part);
        if (p && /\d/.test(p)) phones.add(p);
      });
    }

    root.querySelectorAll(".phone, .phones, [class*='phone'], [id*='phone']").forEach((el) => {
      const matches = textOf(el).match(/0\d[\d\-]{7,12}/g);
      if (matches) matches.forEach((m) => phones.add(m));
    });

    return Array.from(phones);
  }

  function parseSeniority(root, fallback) {
    const seniority = pickFirst(
      findValueByLabels(root, LABELS.seniority),
      findMetricCardValue(root, LABELS.seniority),
      fallback.seniorityText
    );

    const founded = findValueByLabels(root, LABELS.founded);
    const yearsFromText = (seniority.match(/(\d{1,3})/) || [])[1] || "";
    const yearFromFounded =
      (founded.match(/20\d{2}/) || [])[0] ||
      (founded.match(/(\d{1,2})\/(\d{4})/) || [])[2] ||
      (seniority.match(/(\d{1,2})\/(\d{4})/) || [])[2] ||
      (seniority.match(/20\d{2}/) || [])[0] ||
      "";

    return {
      seniorityText: seniority,
      seniorityYears:
        findMetricCardValue(root, LABELS.seniority) ||
        yearsFromText ||
        fallback.seniorityYears ||
        "",
      senioritySince: yearFromFounded || fallback.senioritySince || "",
    };
  }

  function parseCompanyHtml(html, fallback = {}, liveRoot = null) {
    const htmlSource =
      typeof html === "string"
        ? html
        : liveRoot
          ? liveRoot.documentElement?.outerHTML || ""
          : "";
    const doc = liveRoot || new DOMParser().parseFromString(htmlSource, "text/html");
    const root = liveRoot || doc;

    const nameHe = pickFirst(
      textOf(root.querySelector(".company_name")),
      textOf(root.querySelector(".company_name_print")),
      textOf(root.querySelector("#CompanyName")),
      textOf(root.querySelector("h1")),
      textOf(root.querySelector("[class*='company'][class*='name']")),
      fallback.nameHe
    );

    const nameEn = pickFirst(
      textOf(root.querySelector(".company_name_en")),
      textOf(root.querySelector(".company-name-en")),
      fallback.nameEn
    );

    const score = findSectorScore(root, fallback, htmlSource);
    const employees = normalizeEmployees(
      pickFirst(
        findMetricCardValue(root, LABELS.employees),
        findValueByLabels(root, LABELS.employees),
        textOf(root.querySelector("[id*='Employee'], [class*='employee']")),
        fallback.employees
      )
    );
    const seniority = parseSeniority(root, fallback);
    const phones = collectPhones(root);
    if (!phones.length && fallback.phones) phones.push(...fallback.phones);

    const dunsFromPage =
      root.querySelector("[duns]")?.getAttribute?.("duns") ||
      root.querySelector("[data-duns]")?.getAttribute?.("data-duns") ||
      extractDunsFromHtml(html) ||
      fallback.duns ||
      "";

    return DundbUtils.normalizeCompanyData({
      nameHe,
      nameEn,
      status: findStatusBadge(root, fallback),
      address: pickFirst(findValueByLabels(root, LABELS.address), fallback.address),
      phones,
      email: findEmail(root, fallback),
      website: findWebsite(root, fallback),
      score,
      seniorityText: seniority.seniorityText,
      seniorityYears: seniority.seniorityYears,
      senioritySince: seniority.senioritySince,
      employees,
      regNumber: pickFirst(findValueByLabels(root, LABELS.regNumber), fallback.regNumber),
      legalStatus: findLegalStatus(root, fallback),
      sector: pickFirst(findValueByLabels(root, LABELS.sector), fallback.sector),
      activity: pickFirst(findValueByLabels(root, LABELS.activity), fallback.activity),
      mainIndustry: pickFirst(
        findValueByLabels(root, LABELS.mainIndustry),
        fallback.mainIndustry
      ),
      subIndustry: pickFirst(
        findValueByLabels(root, LABELS.subIndustry),
        fallback.subIndustry
      ),
      duns: dunsFromPage,
    });
  }

  function mapSearchRow(row) {
    if (!row || typeof row !== "object") return {};
    return DundbUtils.normalizeCompanyData({
      duns: pickFirst(
        row.Duns,
        row.duns,
        row.DUNS,
        row.DunsNumber,
        row.dunsNumber,
        row.CompanyDuns,
        row.EntityId,
        row.entityId
      ),
      nameHe: pickFirst(
        row.CompanyName,
        row.companyName,
        row.Name,
        row.name,
        row.CompanyNameHeb,
        row.CompanyNameHe
      ),
      nameEn: pickFirst(
        row.CompanyNameEng,
        row.CompanyNameEn,
        row.companyNameEn,
        row.EnglishName
      ),
      regNumber: pickFirst(
        row.RegisNumber,
        row.RegisNum,
        row.regisNumber,
        row.RegistrationNumber,
        row.Hp,
        row.Regis
      ),
      address: pickFirst(row.Address, row.FullAddress, row.address),
      city: pickFirst(row.City, row.city),
      status: pickFirst(row.ActivityStatus, row.Status, row.ActivityStatusDescription),
      legalStatus: pickFirst(row.LegalStatus, row.LegalStatusDescription),
      sector: pickFirst(row.Sector, row.SectorDescription),
      activity: pickFirst(
        row.ActivityType,
        row.ActivityTypeDescription,
        row.ActivityField
      ),
      mainIndustry: pickFirst(
        row.MainSic,
        row.MainIndustry,
        row.MainSicDescription,
        row.SicDescription
      ),
      subIndustry: pickFirst(row.SubSic, row.SubIndustry, row.SubSicDescription),
      score: pickFirst(row.DunsScore, row.Score, row.ScoreValue, row.SectorScore),
      employees: pickFirst(row.Employees, row.EmployeesCount, row.EmployeesRange),
      seniorityYears: pickFirst(row.Seniority, row.BusinessSeniority, row.YearsOfSeniority),
      senioritySince: pickFirst(row.EstablishYear, row.FoundationYear, row.YearEstablished),
      phones: row.Phones || row.Phone ? [row.Phone || row.Phones].flat() : [],
      email: pickFirst(row.Email, row.Mail),
      website: pickFirst(row.WebSite, row.Website, row.Site),
    });
  }

  function formatSupervisorText(data, risk) {
    const lines = [];
    lines.push(`*${data.nameHe || "—"}*`);
    if (data.nameEn) lines.push(data.nameEn);
    lines.push(`סטטוס: ${data.status || "—"}`);
    lines.push("");
    lines.push(`כתובת: ${data.address || "—"}`);
    lines.push(`טלפון: ${(data.phones || []).join(" | ") || "—"}`);
    lines.push(`אימייל: ${data.email || "—"}`);
    lines.push(`אתר: ${data.website || "—"}`);
    if (data.activity) lines.push(`תחום פעילות: ${data.activity}`);
    lines.push("");
    const scoreDisplay = DundbUtils.parseScore(data.score);
    lines.push(`סקור ענפי: ${scoreDisplay === null ? "—" : String(scoreDisplay)}`);
    if (scoreDisplay !== null && risk?.warning) lines.push(risk.warning);
    lines.push(
      `ותק עסק: ${data.seniorityYears || "—"} שנים${
        data.senioritySince ? ` (שנת יסוד ${data.senioritySince})` : ""
      }`
    );
    lines.push(`מספר מועסקים: ${data.employees || "—"}`);
    lines.push("");
    lines.push("נתונים עסקיים:");
    lines.push(`מספר רישום: ${data.regNumber || "—"}`);
    lines.push(`מעמד משפטי: ${data.legalStatus || "—"}`);
    if (data.sector) lines.push(`מגזר: ${data.sector}`);
    if (data.mainIndustry) lines.push(`ענף ראשי: ${data.mainIndustry}`);
    if (data.subIndustry) lines.push(`ענף משני: ${data.subIndustry}`);
    return lines.join("\n");
  }

  global.DundbParser = {
    parseCompanyHtml,
    mapSearchRow,
    extractSearchRows,
    formatSupervisorText,
    extractDunsFromHtml,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
