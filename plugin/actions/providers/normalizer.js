import { uniqByCanonical } from "./helpers.js";

const INDEX_ALIASES = [
  {
    id: "SSECI",
    canonical: "SSECI.INDEX",
    market: "SH",
    symbol: "000001",
    displayCode: "000001.SH",
    nameHint: "上证指数",
    inputs: ["上证指数", "上证", "SSECI", "SH000001", "000001.SH", "000001.SS"],
  },
  {
    id: "SZCI",
    canonical: "SZCI.INDEX",
    market: "SZ",
    symbol: "399001",
    displayCode: "399001.SZ",
    nameHint: "深证成指",
    inputs: ["深证成指", "深证", "SZCI", "SZ399001", "399001.SZ"],
  },
  {
    id: "HSI",
    canonical: "HSI.INDEX",
    market: "HK",
    symbol: "HSI",
    displayCode: "^HSI",
    nameHint: "恒生指数",
    inputs: ["恒生指数", "恒生", "HSI", "HKHSI", "^HSI"],
  },
  {
    id: "DJI",
    canonical: "DJI.INDEX",
    market: "US",
    symbol: "DJI",
    displayCode: "^DJI",
    nameHint: "道琼斯",
    inputs: ["道琼斯", "道指", "DJI", "USDJI", "^DJI"],
  },
];

const INDEX_ALIAS_MAP = new Map();

INDEX_ALIASES.forEach((alias) => {
  alias.inputs.forEach((item) => {
    INDEX_ALIAS_MAP.set(normalizeAliasKey(item), alias);
  });
});

function normalizeAliasKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function buildInvalid(rawInput) {
  const compact = String(rawInput || "").trim();
  const displayCode = compact.toUpperCase();

  return {
    rawInput: compact,
    canonical: `INVALID:${displayCode}`,
    displayCode,
    market: "UNKNOWN",
    symbol: displayCode,
    kind: "invalid",
    aliasId: null,
    isValid: false,
    nameHint: "",
  };
}

function buildStock(rawInput, market, symbol) {
  const upperMarket = market.toUpperCase();
  const normalizedSymbol = upperMarket === "HK" ? normalizeHkDisplaySymbol(symbol) : String(symbol).toUpperCase();
  const displayCode = upperMarket === "US" ? normalizedSymbol : `${normalizedSymbol}.${upperMarket}`;

  return {
    rawInput: String(rawInput).trim(),
    canonical: upperMarket === "US" ? `${normalizedSymbol}.US` : `${normalizedSymbol}.${upperMarket}`,
    displayCode,
    market: upperMarket,
    symbol: normalizedSymbol,
    kind: "stock",
    aliasId: null,
    isValid: true,
    nameHint: "",
  };
}

function buildPassthroughStock(rawInput, symbol, suffix, providerIds = []) {
  const normalizedSymbol = String(symbol).toUpperCase();
  const normalizedSuffix = String(suffix).toUpperCase();
  const passthroughSymbol = `${normalizedSymbol}.${normalizedSuffix}`;
  const providerSymbols = providerIds.reduce((result, providerId) => {
    result[providerId] = passthroughSymbol;
    return result;
  }, {});

  return {
    rawInput: String(rawInput).trim(),
    canonical: passthroughSymbol,
    displayCode: passthroughSymbol,
    market: normalizedSuffix,
    symbol: normalizedSymbol,
    kind: "stock",
    aliasId: null,
    isValid: true,
    nameHint: "",
    providerSymbols,
  };
}

function buildIndex(rawInput, alias) {
  return {
    rawInput: String(rawInput).trim(),
    canonical: alias.canonical,
    displayCode: alias.displayCode,
    market: alias.market,
    symbol: alias.symbol,
    kind: "index",
    aliasId: alias.id,
    isValid: true,
    nameHint: alias.nameHint,
  };
}

function findIndexAlias(rawInput) {
  return INDEX_ALIAS_MAP.get(normalizeAliasKey(rawInput)) || null;
}

function normalizeHkDisplaySymbol(symbol) {
  const trimmed = String(symbol || "").replace(/^0+/, "");
  const compact = trimmed || "0";
  if (!/^\d+$/.test(compact)) return String(symbol || "").toUpperCase();
  return compact.length >= 4 ? compact : compact.padStart(4, "0");
}

function parseProviderSymbol(rawInput) {
  const compact = rawInput.replace(/\s+/g, "");
  const gbMatch = compact.match(/^GB_([A-Z][A-Z0-9.\-]{0,15})$/i);
  if (gbMatch) {
    return buildStock(rawInput, "US", gbMatch[1]);
  }

  return null;
}

function parseExplicitSymbol(rawInput) {
  const compact = rawInput.replace(/\s+/g, "");

  const shMatch = compact.match(/^(\d{6})\.(SH|SS)$/i);
  if (shMatch) {
    if (shMatch[1] === "000001") {
      return buildIndex(rawInput, INDEX_ALIAS_MAP.get("SH000001"));
    }
    return buildStock(rawInput, "SH", shMatch[1]);
  }

  const szMatch = compact.match(/^(\d{6})\.SZ$/i);
  if (szMatch) {
    if (szMatch[1] === "399001") {
      return buildIndex(rawInput, INDEX_ALIAS_MAP.get("SZ399001"));
    }
    return buildStock(rawInput, "SZ", szMatch[1]);
  }

  const hkMatch = compact.match(/^(\d{1,5})\.HK$/i);
  if (hkMatch) {
    return buildStock(rawInput, "HK", hkMatch[1]);
  }

  const usMatch = compact.match(/^([A-Z][A-Z0-9.\-]{0,15})\.US$/i);
  if (usMatch) {
    return buildStock(rawInput, "US", usMatch[1]);
  }

  return null;
}

function parsePassthroughSymbol(rawInput) {
  const compact = rawInput.replace(/\s+/g, "");
  const match = compact.match(/^(\d[\dA-Z.\-]{0,31})\.([A-Z]{1,8})$/i);
  if (!match) {
    return null;
  }

  return buildPassthroughStock(rawInput, match[1], match[2], ["yahoo", "finnhub"]);
}

function parseLegacySymbol(rawInput) {
  const compact = rawInput.replace(/\s+/g, "");
  const upperCompact = compact.toUpperCase();

  if (INDEX_ALIAS_MAP.has(upperCompact)) {
    return buildIndex(rawInput, INDEX_ALIAS_MAP.get(upperCompact));
  }

  const shMatch = compact.match(/^SH(\d{6})$/i);
  if (shMatch) {
    return buildStock(rawInput, "SH", shMatch[1]);
  }

  const szMatch = compact.match(/^SZ(\d{6})$/i);
  if (szMatch) {
    return buildStock(rawInput, "SZ", szMatch[1]);
  }

  const hkMatch = compact.match(/^HK(\d{1,5})$/i);
  if (hkMatch) {
    return buildStock(rawInput, "HK", hkMatch[1]);
  }

  const usMatch = compact.match(/^US([A-Z][A-Z0-9.\-]{0,15})$/i);
  if (usMatch) {
    return buildStock(rawInput, "US", usMatch[1]);
  }

  return null;
}

function parseBareSymbol(rawInput) {
  const compact = rawInput.replace(/\s+/g, "");
  const upperCompact = compact.toUpperCase();

  const alias = findIndexAlias(upperCompact);
  if (alias) {
    return buildIndex(rawInput, alias);
  }

  if (/^\d{6}$/.test(compact)) {
    if (compact === "399001") {
      return buildIndex(rawInput, INDEX_ALIAS_MAP.get("SZ399001"));
    }
    if (compact.startsWith("6")) {
      return buildStock(rawInput, "SH", compact);
    }
    if (compact.startsWith("0") || compact.startsWith("3")) {
      return buildStock(rawInput, "SZ", compact);
    }
    return buildInvalid(rawInput);
  }

  if (/^\d{1,5}$/.test(compact)) {
    return buildStock(rawInput, "HK", compact);
  }

  if (/^[A-Z][A-Z0-9.\-]{0,15}$/i.test(compact)) {
    return buildStock(rawInput, "US", compact);
  }

  return buildInvalid(rawInput);
}

export function normalizeInput(rawInput) {
  const compact = String(rawInput || "").trim();
  if (!compact) return null;

  return (
    findIndexAlias(compact) && buildIndex(compact, findIndexAlias(compact))
  ) || parseProviderSymbol(compact) || parseExplicitSymbol(compact) || parsePassthroughSymbol(compact) || parseLegacySymbol(compact) || parseBareSymbol(compact);
}

export function normalizeInputs(rawInputs) {
  return uniqByCanonical(
    (Array.isArray(rawInputs) ? rawInputs : [rawInputs])
      .map((item) => normalizeInput(item))
      .filter(Boolean)
  );
}

export function toEastMoneySecid(normalized) {
  if (!normalized?.isValid) return "";

  if (normalized.kind === "index") {
    if (normalized.aliasId === "SSECI") return "1.000001";
    if (normalized.aliasId === "SZCI") return "0.399001";
    return "";
  }

  if (normalized.market === "SH") return `1.${normalized.symbol}`;
  if (normalized.market === "SZ") return `0.${normalized.symbol}`;
  if (normalized.market === "HK") return `116.${String(normalized.symbol).replace(/^0+/, "").padStart(5, "0")}`;
  if (normalized.market === "US") return `105.${normalized.symbol}`;
  return "";
}

export function toTencentSymbol(normalized) {
  if (!normalized?.isValid) return "";

  if (normalized.kind === "index") {
    if (normalized.aliasId === "SSECI") return "sh000001";
    if (normalized.aliasId === "SZCI") return "sz399001";
    if (normalized.aliasId === "HSI") return "hkHSI";
    if (normalized.aliasId === "DJI") return "usDJI";
    return "";
  }

  if (normalized.market === "SH") return `sh${normalized.symbol}`;
  if (normalized.market === "SZ") return `sz${normalized.symbol}`;
  if (normalized.market === "HK") return `hk${String(normalized.symbol).replace(/^0+/, "").padStart(5, "0")}`;
  if (normalized.market === "US") return `us${normalized.symbol}`;
  return "";
}

export function toYahooSymbol(normalized) {
  if (!normalized?.isValid) return "";
  if (normalized.providerSymbols?.yahoo) return normalized.providerSymbols.yahoo;

  if (normalized.kind === "index") {
    if (normalized.aliasId === "SSECI") return "000001.SS";
    if (normalized.aliasId === "SZCI") return "399001.SZ";
    if (normalized.aliasId === "HSI") return "^HSI";
    if (normalized.aliasId === "DJI") return "^DJI";
    return "";
  }

  if (normalized.market === "SH") return `${normalized.symbol}.SS`;
  if (normalized.market === "SZ") return `${normalized.symbol}.SZ`;
  if (normalized.market === "HK") return `${normalized.symbol}.HK`;
  if (normalized.market === "US") return normalized.symbol;
  return "";
}

export function toFinnhubSymbol(normalized) {
  if (!normalized?.isValid) return "";
  if (normalized.providerSymbols?.finnhub) return normalized.providerSymbols.finnhub;

  if (normalized.kind === "index") {
    return "";
  }

  if (normalized.market === "SH") return `${normalized.symbol}.SS`;
  if (normalized.market === "SZ") return `${normalized.symbol}.SZ`;
  if (normalized.market === "HK") return `${normalized.symbol}.HK`;
  if (normalized.market === "US") return normalized.symbol;
  return "";
}
