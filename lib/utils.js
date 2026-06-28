(function (global) {
  const R_VALID = true;
  const R_NOT_VALID = false;
  const R_ELEGAL_INPUT = false;

  function normalizeRegisNumber(value) {
    let num = String(value || "").replace(/-/g, "").trim();
    if (!num) return "";
    while (num.length < 9) num = "0" + num;
    return num;
  }

  function validateIsraeliId(str) {
    if (!str) return R_VALID;
    let id = String(str).trim();
    if (id.length > 9 || id.length < 5) return R_ELEGAL_INPUT;
    if (isNaN(id)) return R_ELEGAL_INPUT;
    while (id.length < 9) id = "0" + id;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let inc = Number(id.charAt(i));
      inc *= (i % 2) + 1;
      if (inc > 9) inc -= 9;
      sum += inc;
    }
    return sum % 10 === 0 ? R_VALID : R_NOT_VALID;
  }

  function parseScore(score) {
    const t = cleanText(score);
    if (!t || t === "—") return null;
    const digits = t.replace(/[^\d]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isNaN(n) ? null : n;
  }

  function getRiskMeta(score) {
    const n = parseScore(score);
    if (n === null) {
      return { grade: null, label: "", color: "#9ca3af", warning: "" };
    }
    if (n >= 53) {
      return {
        grade: 2,
        label: "רמת סיכון נמוכה",
        color: "#22c55e",
        warning: "",
        range: "85-53",
      };
    }
    if (n >= 16) {
      return {
        grade: 3,
        label: "רמת סיכון בינונית",
        color: "#f59e0b",
        warning: n <= 28 ? "זהירות! רמת סיכון גבוהה" : "",
        range: "52-16",
      };
    }
    return {
      grade: 4,
      label: "רמת סיכון גבוהה מאוד",
      color: "#ef4444",
      warning: "זהירות! רמת סיכון גבוהה מאוד",
      range: "15-0",
    };
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function pickFirst(...values) {
    for (const v of values) {
      const t = cleanText(v);
      if (t) return t;
    }
    return "";
  }

  const ACTIVE_STATUS_RE = /^(פעיל|פעילה|active)$/i;
  const INACTIVE_STATUS_RE = /^(לא\s*פעיל|לא\s*פעילה|inactive|not\s*active)$/i;

  function isInactiveStatus(value) {
    const t = cleanText(value);
    return INACTIVE_STATUS_RE.test(t) || /^לא\s*פעיל/i.test(t);
  }

  function isActiveStatus(value) {
    return ACTIVE_STATUS_RE.test(cleanText(value));
  }

  function normalizeStatusLabel(value) {
    const t = cleanText(value);
    if (!t) return "";
    if (/לא\s*פעילה/i.test(t)) return "לא פעילה";
    if (/לא\s*פעיל/i.test(t)) return "לא פעיל";
    if (ACTIVE_STATUS_RE.test(t)) return t;
    return t;
  }

  function getStatusMeta(status) {
    const label = normalizeStatusLabel(status);
    if (isInactiveStatus(label)) {
      return {
        label: label || "לא פעילה",
        isInactive: true,
        isActive: false,
        bg: "#fee2e2",
        color: "#b91c1c",
      };
    }
    if (isActiveStatus(label)) {
      return {
        label,
        isInactive: false,
        isActive: true,
        bg: "#dcfce7",
        color: "#166534",
      };
    }
    if (label) {
      return {
        label,
        isInactive: false,
        isActive: false,
        bg: "#f3f4f6",
        color: "#374151",
      };
    }
    return {
      label: "—",
      isInactive: false,
      isActive: false,
      bg: "#f3f4f6",
      color: "#6b7280",
    };
  }

  function normalizeCompanyData(data) {
    if (!data) return data;
    if (data.status) data.status = normalizeStatusLabel(data.status);
    if (data.legalStatus && isInactiveStatus(data.legalStatus)) {
      if (!cleanText(data.status)) data.status = normalizeStatusLabel(data.legalStatus);
      data.legalStatus = "";
    } else if (data.legalStatus && isActiveStatus(data.legalStatus)) {
      if (!cleanText(data.status)) data.status = data.legalStatus;
      data.legalStatus = "";
    }
    return data;
  }

  global.DundbUtils = {
    normalizeRegisNumber,
    validateIsraeliId,
    parseScore,
    getRiskMeta,
    getStatusMeta,
    isInactiveStatus,
    isActiveStatus,
    normalizeStatusLabel,
    normalizeCompanyData,
    cleanText,
    pickFirst,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
