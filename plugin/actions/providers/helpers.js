export const DEFAULT_QUOTE_NAME = "---";
export const QUOTE_REQUEST_TIMEOUT = {
  response: 5000,
  deadline: 10000,
};
const NETWORK_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function getPercent(now, yesterday) {
  if (!yesterday) return 0;
  return now / yesterday - 1;
}

export function createQuote(normalized, data = {}) {
  const now = toNumber(data.now);
  const yesterday = toNumber(data.yesterday);
  const high = toNumber(data.high);
  const low = toNumber(data.low);
  const percent = data.percent !== undefined ? toNumber(data.percent) : getPercent(now, yesterday);
  const code = data.code || normalized?.displayCode || normalized?.rawInput || DEFAULT_QUOTE_NAME;
  const status = data.status || "ok";
  const fallbackName = status === "ok"
    ? (normalized?.nameHint || code)
    : DEFAULT_QUOTE_NAME;

  return {
    input: normalized?.rawInput || "",
    market: normalized?.market || "UNKNOWN",
    canonical: normalized?.canonical || "",
    providerSymbol: data.providerSymbol || "",
    code,
    name: data.name || fallbackName,
    now,
    yesterday,
    high,
    low,
    percent,
    status,
  };
}

export function createErrorQuote(normalized, status = "not_found", overrides = {}) {
  return createQuote(normalized, {
    name: DEFAULT_QUOTE_NAME,
    status,
    ...overrides,
  });
}

export function isNetworkError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if (status) {
    return false;
  }

  const codes = [
    error?.code,
    error?.errno,
    error?.cause?.code,
    error?.cause?.errno,
  ]
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean);

  if (codes.some((item) => NETWORK_ERROR_CODES.has(item))) {
    return true;
  }

  if (error?.timeout) {
    return true;
  }

  const message = String(error?.message || error?.cause?.message || "").toLowerCase();
  return /network|offline|timed?\s*out|socket hang up|getaddrinfo|dns|enotfound|eai_again|econnreset|enetunreach|ehostunreach/.test(message);
}

export function mapLimit(items, limit, iteratee) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(items) || items.length === 0) {
      resolve([]);
      return;
    }

    const size = Math.max(1, limit || 1);
    const results = new Array(items.length);
    let inFlight = 0;
    let currentIndex = 0;
    let resolvedCount = 0;

    const schedule = () => {
      if (resolvedCount >= items.length) {
        resolve(results);
        return;
      }

      while (inFlight < size && currentIndex < items.length) {
        const taskIndex = currentIndex++;
        inFlight += 1;

        Promise.resolve(iteratee(items[taskIndex], taskIndex))
          .then((value) => {
            results[taskIndex] = value;
            resolvedCount += 1;
            inFlight -= 1;
            schedule();
          })
          .catch(reject);
      }
    };

    schedule();
  });
}

export function uniqByCanonical(normalizedList) {
  const seen = new Set();
  const result = [];

  normalizedList.forEach((item) => {
    if (!item) return;
    const key = item.canonical || `invalid:${item.displayCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });

  return result;
}
