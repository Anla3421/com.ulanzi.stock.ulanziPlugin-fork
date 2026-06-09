import { createSVGWindow } from "svgdom";
import { SVG, registerWindow } from "@svgdotjs/svg.js";
import fs from "fs";
import path from "path";
import { getQuote, getQuotes } from "./providers/index.js";
import { Utils } from "./ulanzi-api/index.js";

const window = createSVGWindow();
const document = window.document;
const PLUGIN_PATH = Utils.getPluginPath();
const MAX_INLINE_ICON_CACHE_CHARS = 256 * 1024;
const TREND_ICON_PATHS = {
  down: [
    path.join(PLUGIN_PATH, "assets", "actions", "down.svg"),
  ],
  up: [
    path.join(PLUGIN_PATH, "assets", "actions", "up.svg"),
  ],
};

registerWindow(window, document);

class Stock {
  constructor(context, $UD) {
    this.$UD = $UD;
    this.context = context;
    this.allowSend = true;
    this.canvasWH = 256;
    this.debounceTimer = null;
    this.fetchInFlight = false;
    this.fetchQueued = false;
    this.fetchToken = 0;
    this.trendIconCache = new Map();
    this.disposed = false;

    this.refreshTimer = null;
    this.rollingTimer = null;
    this.rollingIndex = 0;

    this.stockResults = [];

    this.config = {
      mode: "single",
      code_single: "",
      code_multiple: [],
      code_multiple_before: "",
      rotate_duration: "10",
      refresh_duration: "60",
      provider: this.getDefaultProvider(),
      finnhub_api_key: "",
      bgColor: "#000000",
      bgImgName: "",
      bgImg: "",
    };
  }

  getDefaultProvider() {
    return String(this.$UD?.language || "").trim() === "zh_CN" ? "china" : "yahoo";
  }

  normalizeProvider(provider) {
    return String(provider || "").trim() || this.getDefaultProvider();
  }

  usesCnColorScheme() {
    const lang = String(this.$UD?.language || "").trim();
    return lang.startsWith("zh") || lang.startsWith("ja") || lang.startsWith("ko");
  }

  getTrendColors(quote) {
    const isDown = Number(quote?.percent) < 0;
    const isCnStyle = this.usesCnColorScheme();

    if (isCnStyle) {
      return {
        isDown,
        priceFill: isDown ? "#2fbe25" : "#be3b25",
        trendFill: isDown ? "#2fbe25" : "#be3b25",
      };
    }

    return {
      isDown,
      priceFill: isDown ? "#be3b25" : "#2fbe25",
      trendFill: isDown ? "#be3b25" : "#2fbe25",
    };
  }

  async getStockInfo(stockCode) {
    const providerId = this.normalizeProvider(this.config.provider);
    if (typeof stockCode === "string") {
      return getQuote(providerId, stockCode, this.config);
    }

    if (stockCode instanceof Array) {
      return getQuotes(providerId, stockCode, this.config);
    }

    return null;
  }

  isSuccessfulQuote(quote) {
    return quote?.status === "ok";
  }

  isNetworkErrorQuote(quote) {
    return quote?.status === "network_error";
  }

  createPreviousQuoteLookup(results) {
    const list = Array.isArray(results)
      ? results
      : results
        ? [results]
        : [];

    const byCanonical = new Map();
    list.forEach((quote, index) => {
      if (!quote) return;
      if (quote.canonical) {
        byCanonical.set(quote.canonical, quote);
      }
      byCanonical.set(`__index__:${index}`, quote);
    });

    return byCanonical;
  }

  getPreviousSuccessfulQuote(lookup, quote, index) {
    const canonical = quote?.canonical;
    if (canonical) {
      const previousByCanonical = lookup.get(canonical);
      return this.isSuccessfulQuote(previousByCanonical) ? previousByCanonical : null;
    }

    const previousByIndex = lookup.get(`__index__:${index}`);
    return this.isSuccessfulQuote(previousByIndex) ? previousByIndex : null;
  }

  mergeNetworkErrorResults(nextResults) {
    const lookup = this.createPreviousQuoteLookup(this.stockResults);

    if (Array.isArray(nextResults)) {
      return nextResults.map((quote, index) => {
        if (!this.isNetworkErrorQuote(quote)) {
          return quote;
        }

        return this.getPreviousSuccessfulQuote(lookup, quote, index) || quote;
      });
    }

    if (!this.isNetworkErrorQuote(nextResults)) {
      return nextResults;
    }

    return this.getPreviousSuccessfulQuote(lookup, nextResults, 0) || nextResults;
  }

  getRefreshDurationMs() {
    const seconds = Number(this.config.refresh_duration);
    return Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000;
  }

  getRotateDurationMs() {
    const seconds = Number(this.config.rotate_duration);
    return Math.max(1, Number.isFinite(seconds) ? seconds : 10) * 1000;
  }

  getConfiguredStockCode() {
    let stockCode = this.config.mode === "single" ? this.config.code_single : this.config.code_multiple;
    if (!stockCode) return null;

    if (this.config.mode === "multiple") {
      stockCode = Array.isArray(stockCode)
        ? stockCode
        : stockCode.includes("\n")
          ? stockCode.split("\n")
          : [stockCode];

      const uniqueCodes = [];
      stockCode.forEach((item) => {
        const trimItem = item && item.trim();
        if (trimItem && uniqueCodes.indexOf(trimItem) < 0) {
          uniqueCodes.push(trimItem);
        }
      });

      return uniqueCodes.length ? uniqueCodes : null;
    }

    return String(stockCode).trim() ? stockCode : null;
  }

  invalidatePendingFetch() {
    this.fetchToken += 1;
    this.fetchQueued = false;
  }

  releaseTransientData() {
    this.stockResults = [];
    this.lastBase64 = null;
    this.trendIconCache.clear();
    Utils.log("stock transient data released", { context: this.context });
  }

  stopTimers({ resetRolling = false } = {}) {
    const hadTimer = Boolean(this.rollingTimer || this.refreshTimer || this.debounceTimer);
    if (this.rollingTimer) {
      clearInterval(this.rollingTimer);
      this.rollingTimer = null;
    }

    if (resetRolling) {
      this.rollingIndex = 0;
    }

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (hadTimer) {
      Utils.log("stock timers stopped", { context: this.context, resetRolling });
    }
  }

  startTimers() {
    if (!this.allowSend || !this.getConfiguredStockCode()) return;

    this.stopTimers();
    this.fetchData();

    this.refreshTimer = setInterval(() => {
      this.fetchData();
    }, this.getRefreshDurationMs());

    if (this.config.mode === "multiple") {
      this.rollingTimer = setInterval(() => {
        if (!this.allowSend) return;
        this.rollingIndex += 1;
        this.createIcon();
      }, this.getRotateDurationMs());
    }

    Utils.log("stock timers started", {
      context: this.context,
      mode: this.config.mode,
      refreshMs: this.getRefreshDurationMs(),
      rotateMs: this.config.mode === "multiple" ? this.getRotateDurationMs() : 0,
    });
  }

  isImageUrl(str) {
    return /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(str);
  }

  changePathToBase64(filePath) {
    const imgData = fs.readFileSync(filePath);
    const base64Image = Buffer.from(imgData).toString("base64");
    return `data:image/jpeg;base64,${base64Image}`;
  }

  readAssetText(filePaths) {
    for (const filePath of filePaths) {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch (error) {
        // Try the next candidate path.
      }
    }

    return "";
  }

  getTrendIconDataUri(isDown, color) {
    const cacheKey = `${isDown ? "down" : "up"}:${color}`;
    if (this.trendIconCache.has(cacheKey)) {
      return this.trendIconCache.get(cacheKey);
    }

    const baseSvg = isDown
      ? this.readAssetText(TREND_ICON_PATHS.down)
      : this.readAssetText(TREND_ICON_PATHS.up);

    if (!baseSvg) {
      return "";
    }

    const tintedSvg = baseSvg
      .replace(/stroke="(?!none)[^"]*"/g, `stroke="${color}"`)
      .replace(/fill="(?!none)[^"]*"/g, `fill="${color}"`);
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(tintedSvg).toString("base64")}`;
    this.trendIconCache.set(cacheKey, dataUri);
    return dataUri;
  }

  normalizeLabelText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  estimateCharacterWidth(char, fontSize) {
    if (!char) return 0;
    if (/\s/.test(char)) return fontSize * 0.32;
    if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]/u.test(char)) {
      return fontSize * 0.98;
    }
    if (/[A-Z]/.test(char)) return fontSize * 0.68;
    if (/[a-z]/.test(char)) return fontSize * 0.58;
    if (/[0-9]/.test(char)) return fontSize * 0.6;
    if (/[.,:%]/.test(char)) return fontSize * 0.34;
    if (/[-+_/]/.test(char)) return fontSize * 0.42;
    return fontSize * 0.5;
  }

  measureText(_draw, text, fontOptions) {
    const fontSize = this.getFontSize(fontOptions);
    const width = Array.from(String(text || "")).reduce((total, char) => {
      return total + this.estimateCharacterWidth(char, fontSize);
    }, 0);

    return {
      width,
      height: Math.max(fontSize, Math.round(fontSize * 1.08)),
    };
  }

  truncateText(draw, text, fontOptions, maxWidth, suffix = "...") {
    let value = this.normalizeLabelText(text);
    if (!value) return value;

    while (value && this.measureText(draw, `${value}${suffix}`, fontOptions).width > maxWidth) {
      value = value.slice(0, -1).trimEnd();
    }

    return value ? `${value}${suffix}` : suffix;
  }

  wrapTextToLines(draw, text, fontOptions, maxWidth, maxLines = 2) {
    const normalized = this.normalizeLabelText(text);
    if (!normalized) {
      return {
        lines: [],
        overflow: false,
      };
    }

    const chars = Array.from(normalized);
    const lines = [];
    let current = "";
    let index = 0;

    while (index < chars.length) {
      const char = chars[index];
      if (char === " " && !current) {
        index += 1;
        continue;
      }

      const candidate = `${current}${char}`;
      if (!current || this.measureText(draw, candidate, fontOptions).width <= maxWidth) {
        current = candidate;
        index += 1;
        continue;
      }

      lines.push(current.trimEnd());
      if (lines.length === maxLines) {
        return {
          lines,
          overflow: true,
        };
      }

      current = char === " " ? "" : char;
      index += 1;
    }

    if (current) {
      lines.push(current.trimEnd());
    }

    return {
      lines,
      overflow: false,
    };
  }

  fitTextBlock(
    draw,
    text,
    { maxWidth, maxLines = 2, maxFontSize = 36, minFontSize = 22, fontFactory }
  ) {
    for (let size = maxFontSize; size >= minFontSize; size -= 2) {
      const fontOptions = fontFactory(size);
      const wrapped = this.wrapTextToLines(draw, text, fontOptions, maxWidth, maxLines);
      if (!wrapped.overflow) {
        return {
          lines: wrapped.lines,
          fontOptions,
        };
      }
    }

    const fontOptions = fontFactory(minFontSize);
    const wrapped = this.wrapTextToLines(draw, text, fontOptions, maxWidth, maxLines);
    const lines = wrapped.lines.slice(0, maxLines);

    if (wrapped.overflow && lines.length > 0) {
      lines[lines.length - 1] = this.truncateText(
        draw,
        lines[lines.length - 1],
        fontOptions,
        maxWidth
      );
    }

    return {
      lines,
      fontOptions,
    };
  }

  getFontSize(fontOptions, fallback = 36) {
    const rawSize = fontOptions?.size;
    if (typeof rawSize === "number") return rawSize;

    const matched = String(rawSize || "").match(/[\d.]+/);
    return matched ? Number(matched[0]) : fallback;
  }

  placeCenteredText(textNode, topY) {
    return this.placeTextAt(textNode, this.canvasWH / 2, topY, "middle");
  }

  placeTextAt(textNode, centerX, topY, anchor = "middle") {
    const fontSize = this.getFontSize({ size: textNode.attr("font-size") });
    const baselineOffset = Math.round(fontSize * 0.82);

    textNode.attr({
      x: centerX,
      y: topY + baselineOffset,
      "text-anchor": anchor,
    });

    return {
      width: 0,
      height: Math.max(fontSize, Math.round(fontSize * 1.08)),
    };
  }

  drawCenteredText(draw, text, fontOptions, topY) {
    const textNode = draw.text(text).font(fontOptions);
    const metrics = this.measureText(draw, text, fontOptions);
    const box = this.placeCenteredText(textNode, topY);
    return {
      width: metrics.width,
      height: box.height,
    };
  }

  drawCenteredImage(draw, imageHref, width, height, topY) {
    if (!imageHref) {
      return {
        width: 0,
        height: 0,
      };
    }

    draw
      .image(imageHref)
      .size(width, height)
      .move((this.canvasWH - width) / 2, topY);

    return {
      width,
      height,
    };
  }

  drawCenteredPair(
    draw,
    leftText,
    leftFontOptions,
    rightText,
    rightFontOptions,
    topY,
    gap = 8,
    { leftTopOffset = 0, rightTopOffset = 0 } = {}
  ) {
    const leftMetrics = this.measureText(draw, leftText, leftFontOptions);
    const rightMetrics = this.measureText(draw, rightText, rightFontOptions);
    const totalWidth = leftMetrics.width + gap + rightMetrics.width;
    const startX = (this.canvasWH - totalWidth) / 2;
    const leftCenterX = startX + leftMetrics.width / 2;
    const rightCenterX = startX + leftMetrics.width + gap + rightMetrics.width / 2;

    const leftNode = draw.text(leftText).font(leftFontOptions);
    const rightNode = draw.text(rightText).font(rightFontOptions);
    const leftBox = this.placeTextAt(leftNode, leftCenterX, topY + leftTopOffset, "middle");
    const rightBox = this.placeTextAt(rightNode, rightCenterX, topY + rightTopOffset, "middle");

    return {
      width: totalWidth,
      height: Math.max(leftBox.height, rightBox.height),
    };
  }

  drawLineBlock(draw, lines, fontOptions, topY, lineHeightRatio = 1.08) {
    const textLines = lines && lines.length > 0 ? lines : [""];
    const fontSize = this.getFontSize(fontOptions);
    const lineHeight = Math.max(fontSize, Math.round(fontSize * lineHeightRatio));

    textLines.forEach((line, index) => {
      const textNode = draw.text(line).font(fontOptions);
      this.placeCenteredText(textNode, topY + index * lineHeight);
    });

    return {
      height: textLines.length * lineHeight,
      lineCount: textLines.length,
    };
  }

  drawNameBlock(draw, currentData) {
    const label = this.$UD.language === "zh_CN" ? currentData.name : currentData.code;
    const nameConfig = this.fitTextBlock(draw, label, {
      maxWidth: 220,
      maxLines: 2,
      maxFontSize: 36,
      minFontSize: 22,
      fontFactory: (size) => ({
        family: "Source Han Sans",
        size: `${size}px`,
        weight: "bold",
        fill: "#ffffff",
      }),
    });

    return this.drawLineBlock(draw, nameConfig.lines, nameConfig.fontOptions, 26);
  }

  drawNoDataBlock(draw, currentData) {
    const codeConfig = this.fitTextBlock(draw, currentData.code, {
      maxWidth: 220,
      maxLines: 2,
      maxFontSize: 36,
      minFontSize: 22,
      fontFactory: (size) => ({
        family: "Source Han Sans",
        size: `${size}px`,
        weight: "bold",
        fill: "#ffffff",
      }),
    });

    const codeBox = this.drawLineBlock(draw, codeConfig.lines, codeConfig.fontOptions, 34);

    const textNoData = draw.text("NULL").font({
      family: "Source Han Sans",
      size: "36px",
      weight: "bold",
      fill: "#be3b25",
    });
    this.placeCenteredText(textNoData, 34 + codeBox.height + 24);
  }

  async createIcon() {
    if (!this.allowSend) return;
    if (!this.stockResults || this.stockResults.length === 0) return;

    let currentData = null;
    if (this.stockResults instanceof Array) {
      currentData = this.stockResults[this.rollingIndex % this.stockResults.length];
    } else {
      currentData = this.stockResults;
    }

    let draw = null;
    try {
      draw = SVG(document.documentElement).size(this.canvasWH, this.canvasWH);
      const param = this.config;

      if (param.bgImg) {
        let bgImg = param.bgImg;
        if (this.isImageUrl(bgImg)) {
          bgImg = this.changePathToBase64(bgImg);
        }
        draw.image(bgImg).size(this.canvasWH, this.canvasWH).attr({ preserveAspectRatio: "none" });
      } else {
        draw.rect(this.canvasWH, this.canvasWH).fill(param.bgColor);
      }

      if (currentData && currentData.name && currentData.name !== "---") {
        const nameBox = this.drawNameBlock(draw, currentData);
        const isSingleLineName = nameBox.lineCount === 1;
        const { isDown, priceFill, trendFill } = this.getTrendColors(currentData);
        const trendIcon = isSingleLineName
          ? this.getTrendIconDataUri(isDown, trendFill)
          : "";

        const priceFont = {
          family: "Source Han Sans",
          size: "42px",
          weight: "bold",
          fill: priceFill,
        };
        const percentFont = {
          family: "Source Han Sans",
          size: "36px",
          weight: "bold",
          fill: trendFill,
        };
        const percentText = `(${(currentData.percent * 100).toFixed(2)}%)`;
        const priceTopY = 26 + nameBox.height + 18;

        const priceBox = this.drawCenteredText(draw, String(currentData.now), priceFont, priceTopY);

        const percentTopY = priceTopY + priceBox.height + 10;
        if (isSingleLineName) {
          const percentBox = this.drawCenteredText(draw, percentText, percentFont, percentTopY);
          const iconSize = 40;
          const iconTopY = percentTopY + percentBox.height + 2;
          this.drawCenteredImage(draw, trendIcon, iconSize, iconSize, iconTopY);
        } else {
          this.drawCenteredText(draw, percentText, percentFont, percentTopY);
        }
      } else {
        this.drawNoDataBlock(draw, currentData);
      }

      const svgContent = draw.svg();
      const base64Svg = Buffer.from(svgContent).toString("base64");
      const resultBase64 = `data:image/svg+xml;base64,${base64Svg}`;
      this.setIcon(resultBase64);
    } finally {
      if (draw) {
        draw.clear();
      }
    }
  }

  async fetchData() {
    const stockCode = this.getConfiguredStockCode();
    const token = this.fetchToken;
    if (!stockCode) return;
    if (!this.allowSend) return;

    if (this.fetchInFlight) {
      this.fetchQueued = true;
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      if (!this.allowSend || token !== this.fetchToken) return;

      if (this.fetchInFlight) {
        this.fetchQueued = true;
        return;
      }

      this.fetchInFlight = true;
      try {
        const latestResults = await this.getStockInfo(stockCode);
        if (!this.allowSend || token !== this.fetchToken) return;

        this.stockResults = this.mergeNetworkErrorResults(latestResults);
        this.createIcon();
      } catch (error) {
        if (!this.allowSend || token !== this.fetchToken) return;

        Utils.warn("fetch data error", error);
        this.stockResults = { code: stockCode };
        this.createIcon();
      } finally {
        this.fetchInFlight = false;
        if (this.fetchQueued && this.allowSend) {
          this.fetchQueued = false;
          this.fetchData();
        }
      }
    }, 150);
  }

  run(jsn) {
    this.config = Object.assign(this.config, jsn?.param || {});
    this.config.provider = this.normalizeProvider(this.config.provider);

    this.stopTimers({ resetRolling: true });
    this.invalidatePendingFetch();
    this.stockResults = [];

    if (this.allowSend) {
      this.startTimers();
    }
  }

  setActive(bool) {
    const nextActive = bool !== false;
    if (this.allowSend === nextActive) {
      if (nextActive) this.setIcon();
      return;
    }

    this.allowSend = nextActive;
    this.invalidatePendingFetch();

    if (!nextActive) {
      this.stopTimers();
      this.releaseTransientData();
      return;
    }

    this.setIcon();
    this.startTimers();
  }
  
  setIcon(icon){
    const nextIcon = icon || this.lastBase64;
    if (icon) {
      this.lastBase64 = icon.length <= MAX_INLINE_ICON_CACHE_CHARS ? icon : null;
      if (!this.lastBase64) {
        Utils.warn("large icon skipped memory cache", { context: this.context, chars: icon.length });
      }
    }
    if(this.allowSend && nextIcon) this.$UD.setBaseDataIcon(this.context, nextIcon);
  }

  setParams(param) {
    this.config = Object.assign(this.config, param || {});
    this.config.provider = this.normalizeProvider(this.config.provider);
    this.run();
  }

  clear() {
    this.allowSend = false;
    this.disposed = true;
    this.stopTimers({ resetRolling: true });
    this.invalidatePendingFetch();
    this.fetchQueued = false;
    this.releaseTransientData();
  }

  dispose() {
    this.clear();
  }
}

export default Stock;
