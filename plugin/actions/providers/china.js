import superagent from "superagent";
import iconv from "iconv-lite";

import { QUOTE_REQUEST_TIMEOUT, createErrorQuote, createQuote, isNetworkError } from "./helpers.js";
import { normalizeInput, normalizeInputs, toEastMoneySecid, toTencentSymbol } from "./normalizer.js";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://quote.eastmoney.com/",
};

function getPriceDivisor(normalized) {
  if (normalized.market === "HK" || normalized.market === "US") {
    return 1000;
  }
  return 100;
}

function scalePrice(value, normalized) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num / getPriceDivisor(normalized);
}

function toEastMoneyQuote(normalized, item) {
  if (!item) {
    return createErrorQuote(normalized, "not_found");
  }

  return createQuote(normalized, {
    providerSymbol: toEastMoneySecid(normalized),
    name: item.f14 || normalized.nameHint,
    now: scalePrice(item.f2, normalized),
    yesterday: scalePrice(item.f18, normalized),
    high: scalePrice(item.f15, normalized),
    low: scalePrice(item.f16, normalized),
  });
}

function parseTencentBody(body, fallbackSymbols) {
  const rows = iconv.decode(body, "gbk").split(";\n");

  return fallbackSymbols.map((normalized, index) => {
    const row = rows[index] || "";
    const lineMatch = row.match(/="([^"]*)"/);
    if (!lineMatch || !lineMatch[1] || /none_match/i.test(row)) {
      return createErrorQuote(normalized, "not_found");
    }

    const params = lineMatch[1].split("~");
    if (params.length < 5) {
      return createErrorQuote(normalized, "not_found");
    }

    const now = Number(params[3] || 0);
    const yesterday = Number(params[4] || 0);
    const high = Number(params[33] || params[5] || 0);
    const low = Number(params[34] || params[6] || 0);

    return createQuote(normalized, {
      providerSymbol: toTencentSymbol(normalized),
      name: params[1] || normalized.nameHint,
      now,
      yesterday,
      high,
      low,
    });
  });
}

async function fetchEastMoneyQuotes(normalizedList) {
  if (!normalizedList.length) return [];

  const secids = normalizedList.map((item) => toEastMoneySecid(item)).filter(Boolean);
  if (!secids.length) {
    return normalizedList.map((item) => createErrorQuote(item, "unsupported"));
  }

  try {
    const response = await superagent
      .get("https://push2.eastmoney.com/api/qt/ulist.np/get")
      .query({
        fields: "f12,f14,f2,f3,f4,f15,f16,f17,f18",
        secids: secids.join(","),
      })
      .set(BROWSER_HEADERS)
      .timeout(QUOTE_REQUEST_TIMEOUT);

    const diff = response.body?.data?.diff || [];
    return normalizedList.map((item, index) => toEastMoneyQuote(item, diff[index]));
  } catch (error) {
    const status = isNetworkError(error) ? "network_error" : "not_found";
    return normalizedList.map((item) => createErrorQuote(item, status));
  }
}

async function fetchTencentQuotes(normalizedList) {
  if (!normalizedList.length) return [];

  try {
    const symbols = normalizedList.map((item) => toTencentSymbol(item)).filter(Boolean);
    const response = await superagent
      .get(`https://qt.gtimg.cn/q=${symbols.join(",")}`)
      .set(BROWSER_HEADERS)
      .responseType("blob")
      .timeout(QUOTE_REQUEST_TIMEOUT);

    return parseTencentBody(response.body, normalizedList);
  } catch (error) {
    const status = isNetworkError(error) ? "network_error" : "not_found";
    return normalizedList.map((item) => createErrorQuote(item, status));
  }
}

function splitQuoteTargets(normalizedList) {
  const invalid = [];
  const eastmoney = [];
  const tencent = [];

  normalizedList.forEach((item) => {
    if (!item.isValid) {
      invalid.push(createErrorQuote(item, "invalid"));
      return;
    }

    if (item.kind === "index" && (item.aliasId === "HSI" || item.aliasId === "DJI")) {
      tencent.push(item);
      return;
    }

    if (toEastMoneySecid(item)) {
      eastmoney.push(item);
      return;
    }

    if (toTencentSymbol(item)) {
      tencent.push(item);
      return;
    }

    invalid.push(createErrorQuote(item, "unsupported"));
  });

  return { invalid, eastmoney, tencent };
}

async function getQuotes(rawInputs) {
  const normalizedList = normalizeInputs(rawInputs);
  const { invalid, eastmoney, tencent } = splitQuoteTargets(normalizedList);

  const eastmoneyQuotes = await fetchEastMoneyQuotes(eastmoney);
  const eastmoneyOkMap = new Map();
  const eastmoneyRetry = [];

  eastmoneyQuotes.forEach((quote, index) => {
    if (quote.status === "ok") {
      eastmoneyOkMap.set(quote.canonical, quote);
      return;
    }
    eastmoneyRetry.push(eastmoney[index]);
  });

  const tencentQuotes = await fetchTencentQuotes([...tencent, ...eastmoneyRetry]);
  const quoteMap = new Map();

  eastmoneyOkMap.forEach((value, key) => {
    quoteMap.set(key, value);
  });

  tencentQuotes.forEach((quote) => {
    quoteMap.set(quote.canonical, quote);
  });

  invalid.forEach((quote) => {
    quoteMap.set(quote.canonical, quote);
  });

  return normalizedList.map((item) => quoteMap.get(item.canonical) || createErrorQuote(item, "not_found"));
}

async function getQuote(rawInput) {
  const [quote] = await getQuotes([rawInput]);
  return quote || createErrorQuote(normalizeInput(rawInput), "invalid");
}

export default {
  id: "china",
  getQuote,
  getQuotes,
};
