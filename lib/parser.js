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

  const BUSINESS_FIELD_LABELS = {
    regNumber: LABELS.regNumber,
    legalStatus: LABELS.legalStatus,
    sector: LABELS.sector,
    activity: ["אופי פעילות"],
    mainIndustry: LABELS.mainIndustry,
    subIndustry: LABELS.subIndustry,
    email: LABELS.email,
    website: LABELS.website,
  };

  const KNOWN_LABELS = new Set([
    ...Object.values(LABELS).flat(),
    ...Object.values(BUSINESS_FIELD_LABELS).flat(),
    "חברות אם",
    "חברות בת",
    "פקס",
    "מחזור הכנסות (באלפים)",
    "מחזור הכנסות",
    "סוג מניה",
    "D-U-N-S",
    "DUNS",
    "הציגו",
    "נתונים עסקיים",
    "תחום פעילות",
  ]);

  function isKnownLabel(text) {
    const t = cleanText(text);
    if (!t) return true;
    if (KNOWN_LABELS.has(t)) return true;
    return [...KNOWN_LABELS].some((label) => t === label || t.startsWith(label + " "));
  }

  function findSectionByHeading(root, headingText) {
    const candidates = Array.from(root.querySelectorAll("h2, h3, h4, div, span, strong"));
    const heading = candidates.find((el) => textOf(el) === headingText);
    if (!heading) return null;
    return (
      heading.closest("section, article, .tabContent, .tabContent_with_title, .innerinformation") ||
      heading.parentElement
    );
  }

  function extractValueForLabelEl(labelEl, labelText) {
    const parent = labelEl.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child === labelEl) continue;
        const val = textOf(child);
        if (val && val !== labelText && !isKnownLabel(val)) return val;
      }
    }

    const sibling = labelEl.nextElementSibling;
    if (sibling) {
      const val = textOf(sibling);
      if (val && val !== labelText && !isKnownLabel(val)) return val;
    }

    const row = labelEl.closest("tr, li");
    if (row) {
      const cells = Array.from(row.querySelectorAll("td, th, div, span")).filter(
        (el) => textOf(el) !== labelText && !isKnownLabel(textOf(el))
      );
      if (cells.length) return textOf(cells[0]);
    }

    return "";
  }

  function findFieldValue(root, labels, options = {}) {
    const scope = options.section
      ? findSectionByHeading(root, options.section) || root
      : root;
    const exclude = options.excludeSection
      ? findSectionByHeading(root, options.excludeSection)
      : null;

    const nodes = Array.from(scope.querySelectorAll("td, th, label, span, div, li, p, strong, b"));
    for (const el of nodes) {
      if (exclude && exclude.contains(el)) continue;
      const own = textOf(el);
      if (!own || own.length > 80) continue;
      const matched = labels.some((label) => own === label || own.startsWith(label + ":"));
      if (!matched) continue;

      const val = extractValueForLabelEl(el, own);
      if (val && !isKnownLabel(val)) return val;
    }
    return "";
  }

  function parseBusinessDataSection(root) {
    const section = findSectionByHeading(root, "נתונים עסקיים");
    if (!section) return {};

    const result = {};
    for (const [field, labels] of Object.entries(BUSINESS_FIELD_LABELS)) {
      const val = findFieldValue(root, labels, { section: "נתונים עסקיים" });
      if (!val) continue;
      if (field === "regNumber" && !/^\d{5,9}$/.test(val.replace(/-/g, ""))) continue;
      if (field === "legalStatus" && (ACTIVE_STATUS_RE.test(val) || /מחזור|סוג מניה|^-/.test(val))) {
        continue;
      }
      if (field === "website" && !/^https?:\/\//i.test(val) && !/^www\./i.test(val)) continue;
      result[field] = val;
    }
    return result;
  }

  function findMetricBox(titleEl, titleText) {
    let box = titleEl;
    const otherTitles = ["סקור ענפי", "ותק עסק", "מספר מועסקים"].filter((t) => t !== titleText);

    for (let depth = 0; depth < 8 && box; depth++, box = box.parentElement) {
      const boxText = textOf(box);
      if (!boxText.includes(titleText)) continue;
      if (otherTitles.some((t) => boxText.includes(t))) continue;
      if (boxText.length > 160) continue;
      return box;
    }
    return titleEl.parentElement;
  }

  function extractMetricBoxes(root) {
    const metrics = {
      score: "",
      seniorityYears: "",
      senioritySince: "",
      employees: "",
    };

    const titleMap = {
      score: "סקור ענפי",
      seniority: "ותק עסק",
      employees: "מספר מועסקים",
    };

    for (const [key, title] of Object.entries(titleMap)) {
      const titleEl = Array.from(root.querySelectorAll("div, span, td, label, p")).find(
        (el) => textOf(el) === title
      );
      if (!titleEl) continue;

      const box = findMetricBox(titleEl, title);
      if (!box) continue;
      const boxText = textOf(box);

      if (key === "score") {
        const scoreEl = box.querySelector(".scorenumber");
        const fromClass = parseScoreDigits(textOf(scoreEl));
        if (fromClass) {
          metrics.score = fromClass;
          continue;
        }
        const afterTitle = boxText.slice(boxText.indexOf(title) + title.length);
        const nums = afterTitle.match(/\b(\d{1,3})\b/g) || [];
        for (const num of nums) {
          const parsed = parseScoreDigits(num);
          if (parsed && Number(parsed) >= 10) {
            metrics.score = parsed;
            break;
          }
        }
        if (!metrics.score) {
          for (const num of nums) {
            const parsed = parseScoreDigits(num);
            if (parsed) {
              metrics.score = parsed;
              break;
            }
          }
        }
        continue;
      }

      if (key === "seniority") {
        const yearMatch = boxText.match(/שנת\s+יסוד[^\d]*(\d{1,2})\/(\d{4})/);
        if (yearMatch) metrics.senioritySince = yearMatch[2];

        const afterTitle = boxText.slice(boxText.indexOf(title) + title.length);
        const withoutNotes = afterTitle.replace(/\([^)]*\)/g, " ");
        const numMatch = withoutNotes.match(/(\d{1,3})/);
        if (numMatch) metrics.seniorityYears = numMatch[1];
        continue;
      }

      if (key === "employees") {
        const afterTitle = boxText.slice(boxText.indexOf(title) + title.length);
        const withoutNotes = afterTitle.replace(/\([^)]*\)/g, " ");
        const numMatch = withoutNotes.match(/(\d{1,5})/);
        if (numMatch) metrics.employees = numMatch[1];
      }
    }

    return metrics;
  }

  function validateWebsiteValue(val) {
    const t = cleanText(val);
    if (!t || t === "-" || t === "–" || t === "—") return "";
    if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return t;
    return "";
  }

  function findValueByLabels(root, labels) {
    return findFieldValue(root, labels, { excludeSection: "נתונים עסקיים" });
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

    return "";
  }

  function findSectorScore(root, fallback, htmlSource = "") {
    const metrics = extractMetricBoxes(root);
    if (metrics.score) return metrics.score;

    const selectors = [
      "#compDetailsDunsScore .scorenumber",
      ".score-metric .scorenumber",
    ];

    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      if (el.closest("#Legend, .rating-scale, .scale-bar, [id*='ScoreGraph']")) continue;
      const parsed = parseScoreDigits(textOf(el));
      if (parsed) return parsed;
    }

    const fromSource = extractScoreFromSource(htmlSource);
    if (fromSource) return fromSource;

    return parseScoreDigits(fallback.score);
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
    const fromBusiness = parseBusinessDataSection(root).legalStatus;
    let val = fromBusiness || findFieldValue(root, LABELS.legalStatus, {
      section: "נתונים עסקיים",
    });
    if (ACTIVE_STATUS_RE.test(val)) val = "";
    if (/מחזור|סוג מניה|^-/.test(val)) val = "";
    return pickFirst(val, fallback.legalStatus);
  }

  function findEmail(root, fallback) {
    const fromBusiness = validateEmailValue(
      findFieldValue(root, LABELS.email, { section: "נתונים עסקיים" })
    );
    if (fromBusiness) return fromBusiness;

    const fromContact = validateEmailValue(findFieldValue(root, LABELS.email));
    if (fromContact) return fromContact;

    return validateEmailValue(fallback.email);
  }

  function findWebsite(root, fallback) {
    const fromBusiness = validateWebsiteValue(
      findFieldValue(root, LABELS.website, { section: "נתונים עסקיים" })
    );
    if (fromBusiness) return fromBusiness;

    const links = Array.from(root.querySelectorAll('a[href^="http"], a[href^="www."]'));
    for (const a of links) {
      const businessSection = findSectionByHeading(root, "נתונים עסקיים");
      if (businessSection && businessSection.contains(a)) continue;
      const href = validateWebsiteValue(a.getAttribute("href"));
      if (href && !/dundb|facebook|google|linkedin|youtube|instagram/i.test(href)) {
        return href;
      }
    }

    return validateWebsiteValue(fallback.website);
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
    const metrics = extractMetricBoxes(root);
    const seniority = pickFirst(
      metrics.seniorityYears && `(${metrics.seniorityYears})`,
      findFieldValue(root, LABELS.seniority),
      fallback.seniorityText
    );

    const founded = findFieldValue(root, LABELS.founded);
    const yearsFromText = metrics.seniorityYears || (seniority.match(/(\d{1,3})/) || [])[1] || "";
    const yearFromFounded =
      metrics.senioritySince ||
      (founded.match(/20\d{2}/) || [])[0] ||
      (founded.match(/(\d{1,2})\/(\d{4})/) || [])[2] ||
      (seniority.match(/(\d{1,2})\/(\d{4})/) || [])[2] ||
      "";

    return {
      seniorityText: seniority,
      seniorityYears: yearsFromText || fallback.seniorityYears || "",
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

    const metrics = extractMetricBoxes(root);
    const business = parseBusinessDataSection(root);

    const score = pickFirst(metrics.score, findSectorScore(root, fallback, htmlSource));
    const employees = normalizeEmployees(
      pickFirst(
        metrics.employees,
        findFieldValue(root, LABELS.employees),
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
      regNumber: pickFirst(
        business.regNumber,
        findFieldValue(root, LABELS.regNumber, { section: "נתונים עסקיים" }),
        fallback.regNumber
      ),
      legalStatus: findLegalStatus(root, { ...fallback, legalStatus: business.legalStatus }),
      sector: pickFirst(business.sector, findFieldValue(root, LABELS.sector, { section: "נתונים עסקיים" }), fallback.sector),
      activity: pickFirst(
        findFieldValue(root, LABELS.activity),
        business.activity,
        fallback.activity
      ),
      mainIndustry: pickFirst(
        business.mainIndustry,
        findFieldValue(root, LABELS.mainIndustry, { section: "נתונים עסקיים" }),
        fallback.mainIndustry
      ),
      subIndustry: pickFirst(
        business.subIndustry,
        findFieldValue(root, LABELS.subIndustry, { section: "נתונים עסקיים" }),
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
