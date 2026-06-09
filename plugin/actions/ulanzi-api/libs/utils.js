const DEBUG_TRUE_VALUES = new Set(["1", "true", "yes", "on", "debug"]);
const DEBUG_FALSE_VALUES = new Set(["0", "false", "no", "off", "release", "production"]);
const REDACTED_LOG_KEYS = new Set(["finnhub_api_key", "api_key", "apikey", "token", "authorization"]);
const MAX_LOG_STRING_LENGTH = 300;

class UlanziUtils {


	/**
	 * 获取表单数据
	 * Returns the value from a form using the form controls name property
	 * @param {Element | string} form
	 * @returns
	 */
	getFormValue(form) {
		if (typeof form === 'string') {
			form = document.querySelector(form);
		}

		const elements = form?.elements;

		if (!elements) {
			this.error('Could not find form!');
		}

		const formData = new FormData(form);
		let formValue = {};

		formData.forEach((value, key) => {
			if (!Reflect.has(formValue, key)) {
				formValue[key] = value;
				return;
			}
			if (!Array.isArray(formValue[key])) {
				formValue[key] = [formValue[key]];
			}
			formValue[key].push(value);
		});

		return formValue;
	}

	/**
	 * 重载表单数据
	 * Sets the value of form controls using their name attribute and the jsn object key
	 * @param {*} jsn
	 * @param {Element | string} form
	 */
	setFormValue(jsn, form) {
		if (!jsn) {
			return;
		}

		if (typeof form === 'string') {
			form = document.querySelector(form);
		}

		const elements = form?.elements;

		if (!elements) {
			this.error('Could not find form!');
		}

		Array.from(elements)
			.filter((element) => element?.name)
			.forEach((element) => {
				const { name, type } = element;
				const value = name in jsn ? jsn[name] : null;
				const isCheckOrRadio = type === 'checkbox' || type === 'radio';

				if (value === null) return;

				if (isCheckOrRadio) {
					const isSingle = value === element.value;
					if (isSingle || (Array.isArray(value) && value.includes(element.value))) {
						element.checked = true;
					}
				} else {
					element.value = value ?? '';
				}
			});
	}

	/**
	 * 防抖
	 * This provides a slight delay before processing rapid events
	 * @param {function} fn
	 * @param {number} wait - delay before processing function (recommended time 150ms)
	 * @returns
	 */
	debounce(fn, wait = 150) {
		let timeoutId = null
		return (...args) => {
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				fn.apply(null, args);
			}, wait);
		};
	}



	/**
	   * JSON.parse优化
	 * parse json
	 * @param {string} jsonString
	 * @returns {object} json
	*/
	parseJson(jsonString) {
		if (typeof jsonString === 'object') return jsonString;
		try {
			const o = JSON.parse(jsonString);
			if (o && typeof o === 'object') {
				return o;
			}
		} catch (e) { }

		return false;
	}


	/**
   * 获取随机时间戳
   */
	joinTimestamp() {
		const now = new Date().getTime();
		return { _t: now };
	}

	isDebugEnabled() {
		const envDebug = String(process.env.ULANZI_PLUGIN_DEBUG_ALL ?? process.env.DEBUG_ALL ?? "").trim().toLowerCase();
		if (DEBUG_FALSE_VALUES.has(envDebug) || process.argv.includes("--no-debug-all")) return false;
		if (DEBUG_TRUE_VALUES.has(envDebug) || process.argv.includes("--debug-all")) return true;
		return false;
	}

	shouldLogMainMessageData(data) {
		return Boolean(data);
	}

	logMainMessageData(uuid, data) {
		if (!this.isDebugEnabled()) return;
		if (!this.shouldLogMainMessageData(data)) return;
		console.warn(
			`[ULANZIDECK] MAIN WEBSOCKET MESSGE DATA: ${uuid}, ${JSON.stringify(this.sanitizeForLog(data))}`
		);
	}

	sanitizeForLog(value, key = "", seen = new WeakSet()) {
		const normalizedKey = String(key || "").toLowerCase();
		if (REDACTED_LOG_KEYS.has(normalizedKey) || normalizedKey.endsWith("_key")) {
			return "[redacted]";
		}

		if (typeof value === "string") {
			if (value.startsWith("data:image/")) {
				return `[image data uri ${value.length} chars]`;
			}
			return value.length > MAX_LOG_STRING_LENGTH
				? `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[${value.length} chars]`
				: value;
		}

		if (!value || typeof value !== "object") {
			return value;
		}

		if (seen.has(value)) {
			return "[circular]";
		}
		seen.add(value);

		if (Array.isArray(value)) {
			return value.map((item) => this.sanitizeForLog(item, "", seen));
		}

		return Object.keys(value).reduce((result, itemKey) => {
			result[itemKey] = this.sanitizeForLog(value[itemKey], itemKey, seen);
			return result;
		}, {});
	}

	formatLogArgs(args) {
		return args.map((item) => {
			if (typeof item === "string") return item;
			try {
				return JSON.stringify(this.sanitizeForLog(item));
			} catch (error) {
				return String(item);
			}
		});
	}

	/**
	  * 适配语言环境
   */
	adaptLanguage(ln) {
		let userLanguage = ln;
		if (ln.indexOf('zh') == 0) {
			if(ln.indexOf('CN') > -1){
				userLanguage = 'zh_CN'
			}else{
				userLanguage = 'zh_HK'
			}
		} else if (ln.indexOf('en') == 0) {
			userLanguage = 'en'
		} else if (userLanguage.indexOf('-') !== -1) {
			userLanguage = userLanguage.replace(/-/g, '_');
		}

		return userLanguage
	}

	/**
   * 获取插件根目录路径
   */
	getPluginPath() {
		const currentFilePath = process.argv[1];
		let split_tag = '/'
		if (currentFilePath.indexOf('\\') > -1) {
			split_tag = '\\'
		}
		const pathArr = currentFilePath.split(split_tag);
		const idx = pathArr.findIndex(f => f.endsWith('ulanziPlugin'));
		const __folderpath = `${pathArr.slice(0, idx + 1).join("/")}`;

		return __folderpath;

	}

	// 获取运行环境系统类型
	getSystemType() {
		return process.platform === 'win32' ? 'windows' : 'mac';

	}
	getProperty(obj, dotSeparatedKeys, defaultValue) {
		if (arguments.length > 1 && typeof dotSeparatedKeys !== 'string') return undefined;
		if (typeof obj !== 'undefined' && typeof dotSeparatedKeys === 'string') {
			const pathArr = dotSeparatedKeys.split('.');
			pathArr.forEach((key, idx, arr) => {
				if (typeof key === 'string' && key.includes('[')) {
					try {
						// extract the array index as string
						const pos = /\[([^)]+)\]/.exec(key)[1];
						// get the index string length (i.e. '21'.length === 2)
						const posLen = pos.length;
						arr.splice(idx + 1, 0, Number(pos));

						// keep the key (array name) without the index comprehension:
						// (i.e. key without [] (string of length 2)
						// and the length of the index (posLen))
						arr[idx] = key.slice(0, -2 - posLen); // eslint-disable-line no-param-reassign
					} catch (e) {
						// do nothing
					}
				}
			});
			// eslint-disable-next-line no-param-reassign, no-confusing-arrow
			obj = pathArr.reduce((o, key) => (o && o[key] !== 'undefined' ? o[key] : undefined), obj);
		}
		return obj === undefined ? defaultValue : obj;
	};

	getProp(jsn, str, defaultValue = {}, sep = '.') {
		const arr = str.split(sep);
		return arr.reduce((obj, key) => (obj && obj.hasOwnProperty(key) ? obj[key] : defaultValue), jsn);
	};



	/**
	 * Logs a message 
	 * @param {any} msg
	 */
	log(...msg) {
		if (!this.isDebugEnabled()) return;
		console.warn(`[${new Date().toLocaleString('zh-CN', { hour12: false })}]`, ...this.formatLogArgs(msg));
	}

	/**
	 * Logs a warning message 
	 */
	warn(...msg) {
		if (!this.isDebugEnabled()) return;
		console.warn(`[${new Date().toLocaleString('zh-CN', { hour12: false })}]`, ...this.formatLogArgs(msg));
	}

	/**
	 * Logs an error message
	*/
	error(...msg) {
		if (!this.isDebugEnabled()) return;
		console.error(`[${new Date().toLocaleString('zh-CN', { hour12: false })}]`, ...this.formatLogArgs(msg));
	}
}
const Utils = new UlanziUtils();
export default Utils
