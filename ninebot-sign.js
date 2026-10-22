/**
 * @name         九号出行 签到（修复版）
 * @description  自动签到领 N 币 · Token 抓取 · 多账号 · 失败重试 · 单号结果可辨识
 * @version      1.1.1
 * @author       凉心（原版） / 蛋卷（修复）
 * @build        2026-10-22
 *
 * 1.1.1 修复：Loon / QX 的 $httpClient timeout 单位是毫秒，修复版统一按秒传导致 100% 超时
 *             （v1.1.0 自己踩的坑）；新增 Policy 参数；重试日志提到 info 级别
 *
 * 兼容：Surge / Loon / Stash / Egern / Shadowrocket / Quantumult X / Node.js(18+)
 * 说明：作者栏保留原作者，修复点见 REVIEW.md
 */

(function () {
  "use strict";

  /* ======================= 1. 平台识别 ======================= */
  var PLATFORM = (function () {
    if (typeof $task !== "undefined") return "Quantumult X";
    if (typeof $loon !== "undefined") return "Loon";
    if (typeof $rocket !== "undefined") return "Shadowrocket";
    if (typeof Egern !== "undefined") return "Egern";
    if (globalThis.$environment && globalThis.$environment["surge-version"]) return "Surge";
    if (globalThis.$environment && globalThis.$environment["stash-version"]) return "Stash";
    if (typeof process !== "undefined" && process.versions && process.versions.node) return "Node.js";
    return "Unknown";
  })();

  var IS_NODE = PLATFORM === "Node.js";
  var IS_PROXY = ["Surge", "Loon", "Stash", "Egern", "Shadowrocket", "Quantumult X"].indexOf(PLATFORM) >= 0;

  /* ======================= 2. 参数与常量 ======================= */
  var NAME = "九号出行 签到";
  var STORE_KEY = "Ninebot.Accounts"; // 与原版保持一致，升级不会丢账号
  var API = {
    status: "/portal/api/user-sign/v2/status",
    sign: "/portal/api/user-sign/v2/sign"
  };

  function parseArg(raw) {
    var out = {};
    if (!raw) return out;
    String(raw).replace(/^\?/, "").split("&").forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf("=");
      var k = i < 0 ? pair : pair.slice(0, i);
      var v = i < 0 ? "" : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    return out;
  }

  var ARG = parseArg(
    typeof $argument !== "undefined" ? $argument : (IS_NODE ? (process.env.NINEBOT_ARG || "") : "")
  );

  function num(v, dft) {
    var n = Number(v);
    return isFinite(n) ? n : dft;
  }

  var CFG = {
    base: String(ARG.BaseUrl || "https://cn-cbu-gateway.ninebot.com").replace(/\/+$/, ""),
    timeout: num(ARG.Timeout, 10) > 0 ? num(ARG.Timeout, 10) : 10, // 秒（内部按平台换算）
    retry: Math.max(0, Math.min(5, num(ARG.Retry, 2))),             // 重试次数
    interval: Math.max(0, num(ARG.Interval, 800)),                  // 多账号间隔 ms
    policy: String(ARG.Policy || "").trim(),                        // 指定节点/策略，如 DIRECT
    showId: String(ARG.ShowDeviceId || "true").toLowerCase() !== "false",
    logLevel: String(ARG.LogLevel || "info").toLowerCase()
  };

  // ⚠️ 各平台 $httpClient 的 timeout 单位不一致，传错单位等于 100% 超时：
  //    Loon / Quantumult X / Node.js → 毫秒
  //    Surge / Stash / Egern / Shadowrocket → 秒
  var TIMEOUT_IS_MS = (PLATFORM === "Loon" || PLATFORM === "Quantumult X" || IS_NODE);
  var TIMEOUT_VALUE = TIMEOUT_IS_MS ? CFG.timeout * 1000 : CFG.timeout;

  /* ======================= 3. 日志 ======================= */
  var LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };
  var LV = LEVELS[CFG.logLevel] === undefined ? 3 : LEVELS[CFG.logLevel];
  var LOG_FILE = null;

  function logFile() {
    if (LOG_FILE !== null) return LOG_FILE;
    LOG_FILE = "";
    if (!IS_NODE) return LOG_FILE;
    try {
      var path = require("path");
      LOG_FILE = process.env.NINEBOT_LOG || path.resolve(process.cwd(), "ninebot-sign.log");
    } catch (e) { LOG_FILE = ""; }
    return LOG_FILE;
  }

  function log(level, msg) {
    if (LEVELS[level] > LV) return;
    var line = "[" + level.toUpperCase() + "] " + msg;
    console.log(line);
    if (IS_NODE) {
      var f = logFile();
      if (f) { try { require("fs").appendFileSync(f, new Date().toISOString() + " " + line + "\n"); } catch (e) {} }
    }
  }

  /* ======================= 4. 持久化 ======================= */
  // 修复点：不再对原始字符串做 JSON.parse（原版会把 "123" 之类误转成 number）
  var store = {
    get: function (key) {
      try {
        if (IS_NODE) {
          var path = require("path");
          var file = process.env.NINEBOT_DATA || path.resolve(process.cwd(), "ninebot-accounts.dat");
          if (!require("fs").existsSync(file)) return null;
          return require("fs").readFileSync(file, "utf8").trim();
        }
        if (PLATFORM === "Quantumult X") return $prefs.valueForKey(key);
        return $persistentStore.read(key);
      } catch (e) {
        log("error", "读取存储失败: " + e.message);
        return null;
      }
    },
    set: function (key, value) {
      try {
        if (IS_NODE) {
          var path = require("path");
          var file = process.env.NINEBOT_DATA || path.resolve(process.cwd(), "ninebot-accounts.dat");
          require("fs").writeFileSync(file, String(value), "utf8");
          return true;
        }
        if (PLATFORM === "Quantumult X") return $prefs.setValueForKey(String(value), key);
        return $persistentStore.write(String(value), key);
      } catch (e) {
        log("error", "写入存储失败: " + e.message);
        return false;
      }
    }
  };

  /* ======================= 5. 通知 ======================= */
  function notify(title, subtitle, body) {
    var text = String(body || "");
    try {
      if (PLATFORM === "Quantumult X") $notify(title, subtitle, text);
      else if (IS_NODE) log("info", "通知: " + (subtitle || "") + " | " + text.replace(/\r?\n/g, " / "));
      else $notification.post(title, subtitle, text);
    } catch (e) {
      log("error", "通知失败: " + e.message);
    }
  }

  /* ======================= 6. HTTP ======================= */
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function headersFor(acc) {
    return {
      Accept: "application/json, text/plain, */*",
      Authorization: acc.token,
      "Content-Type": "application/json",
      device_id: acc.deviceId,
      language: "zh",
      from_platform_1: "1",
      Origin: "https://h5-bj.ninebot.com",
      Referer: "https://h5-bj.ninebot.com/",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6"
    };
  }

  function rawRequest(opt) {
    var method = (opt.method || "GET").toUpperCase();
    var headers = opt.headers || {};
    var timeoutMs = CFG.timeout * 1000;
    var policy = CFG.policy;

    // 按平台把「指定节点 / 策略」映射到各自的字段
    function applyPolicy(target) {
      if (!policy) return;
      switch (PLATFORM) {
        case "Loon": target.node = policy; break;                          // 节点名 / 策略组 / DIRECT
        case "Surge": target.policy = policy; break;
        case "Stash": target.headers = target.headers || {}; target.headers["X-Stash-Selected-Proxy"] = encodeURI(policy); break;
        case "Shadowrocket": target.headers = target.headers || {}; target.headers["X-Surge-Proxy"] = policy; break;
        case "Quantumult X": target.opts = { policy: policy }; break;
        default: break;                                                    // Egern / Node 无对应映射
      }
    }

    // ---- Node.js：用内置 fetch（18+），无需 node-fetch / fetch-cookie ----
    if (IS_NODE) {
      return (function () {
        var fetchFn = globalThis.fetch;
        if (typeof fetchFn !== "function") {
          return Promise.reject(new Error("当前 Node.js 没有内置 fetch，请升级到 18+"));
        }
        var ctrl = typeof AbortController === "function" ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
        var init = { method: method, headers: headers, redirect: "manual" };
        if (opt.body !== undefined && opt.body !== null) init.body = opt.body;
        if (ctrl) init.signal = ctrl.signal;
        return fetchFn(opt.url, init).then(function (res) {
          return res.text().then(function (text) {
            return { status: res.status, body: text, headers: {} };
          });
        }).then(function (r) {
          if (timer) clearTimeout(timer);
          return r;
        }, function (e) {
          if (timer) clearTimeout(timer);
          throw new Error(e && e.name === "AbortError" ? "请求超时 " + CFG.timeout + "s" : String((e && e.message) || e));
        });
      })();
    }

    // ---- Quantumult X ----
    if (PLATFORM === "Quantumult X") {
      return new Promise(function (resolve, reject) {
        var req = { url: opt.url, method: method.toLowerCase(), headers: headers };
        if (opt.body !== undefined && opt.body !== null) req.body = opt.body;
        req.timeout = TIMEOUT_VALUE;
        applyPolicy(req);
        $task.fetch(req).then(function (res) {
          var code = res.statusCode !== undefined ? res.statusCode : res.status;
          resolve({ status: Number(code), body: res.body, headers: res.headers || {} });
        }, function (err) {
          reject(new Error(String((err && (err.error || err.message)) || err)));
        });
      });
    }

    // ---- Surge / Loon / Stash / Egern / Shadowrocket ----
    return new Promise(function (resolve, reject) {
      if (typeof $httpClient === "undefined") return reject(new Error("当前环境不支持 $httpClient"));
      var fn = method === "POST" ? $httpClient.post : $httpClient.get;
      var options = { url: opt.url, headers: headers, timeout: TIMEOUT_VALUE };
      if (opt.body !== undefined && opt.body !== null) options.body = opt.body;
      applyPolicy(options);
      fn(options, function (err, res, data) {
        if (err) return reject(new Error(String(err)));
        var code = res && (res.status !== undefined ? res.status : res.statusCode);
        resolve({ status: Number(code), body: data, headers: (res && res.headers) || {} });
      });
    });
  }

  /**
   * 带重试的 JSON 请求
   * - 网络错误 / 429 / 5xx  → 重试
   * - 其它 4xx             → 直接失败（重试也没用，只会加重风控）
   */
  function requestJson(url, opt) {
    opt = opt || {};
    var attempt = 0;

    function run() {
      return rawRequest({ url: url, method: opt.method, headers: opt.headers, body: opt.body }).then(function (res) {
        var status = res.status;
        if (status === 429 || status >= 500) {
          var e1 = new Error("HTTP " + status);
          e1.retryable = true;
          throw e1;
        }
        if (!(status >= 200 && status < 300)) {
          var e2 = new Error("HTTP " + status);
          e2.retryable = false;
          throw e2;
        }
        try {
          return JSON.parse(res.body);
        } catch (pe) {
          var e3 = new Error("响应不是合法 JSON: " + String(res.body || "").slice(0, 80));
          e3.retryable = false;
          throw e3;
        }
      }).catch(function (err) {
        // 未标注的（网络层/超时）一律视为可重试
        if (err.retryable === undefined) err.retryable = true;
        if (!err.retryable || attempt >= CFG.retry) throw err;
        attempt++;
        var wait = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
        // 用 info 而不是 debug：重试是排障时必须能看到的信息
        log("info", "第 " + attempt + "/" + CFG.retry + " 次重试，等待 " + wait + "ms → " + url);
        return sleep(wait).then(run);
      });
    }
    return run();
  }

  /* ======================= 7. 账号表 ======================= */
  // 存储格式：deviceId:token;deviceId:token
  function parseAccounts(raw) {
    var list = [];
    String(raw || "").split(";").forEach(function (item) {
      var s = item.trim();
      if (!s) return;
      var i = s.indexOf(":");
      if (i <= 0) return;
      var deviceId = s.slice(0, i).trim();
      var token = s.slice(i + 1).trim();
      if (deviceId && token) list.push({ deviceId: deviceId, token: token });
    });
    return list;
  }

  function serializeAccounts(list) {
    return list.map(function (a) { return a.deviceId + ":" + a.token; }).join(";");
  }

  /** 返回 "new" | "updated" | "same" */
  function upsertAccount(deviceId, token) {
    var list = parseAccounts(store.get(STORE_KEY));
    for (var i = 0; i < list.length; i++) {
      if (list[i].deviceId === deviceId) {
        if (list[i].token === token) return "same";
        list[i].token = token;
        store.set(STORE_KEY, serializeAccounts(list));
        return "updated";
      }
    }
    list.push({ deviceId: deviceId, token: token });
    store.set(STORE_KEY, serializeAccounts(list));
    return "new";
  }

  function maskId(id) {
    var s = String(id || "");
    if (!CFG.showId) return "账号";
    if (s.length <= 10) return s;
    return s.slice(0, 6) + "…" + s.slice(-4);
  }

  /* ======================= 8. 签到逻辑 ======================= */
  function isAuthError(err) {
    var msg = String((err && err.message) || "");
    return /40[13]/.test(msg) || /登录|未授权|token|失效/i.test(msg);
  }

  function getStatus(acc) {
    return requestJson(CFG.base + API.status + "?t=" + Date.now(), { headers: headersFor(acc) }).then(function (json) {
      if (Number(json.code) !== 0) {
        var e = new Error(json.msg || "status code=" + json.code);
        e.apiCode = json.code;
        throw e;
      }
      return json.data || {};
    });
  }

  function postSign(acc) {
    return requestJson(CFG.base + API.sign, {
      method: "POST",
      headers: headersFor(acc),
      body: JSON.stringify({ deviceId: acc.deviceId })
    });
  }

  // 修复点：currentSignStatus 可能是字符串 "1"，统一转数字判断
  function signOne(acc, tag) {
    return getStatus(acc).then(function (st) {
      var days = Number(st.consecutiveDays) || 0;
      if (Number(st.currentSignStatus) === 1) {
        return { ok: true, tag: tag, text: "已签 | 连签 " + days + " 天", signed: false };
      }
      return postSign(acc).then(function (res) {
        if (Number(res.code) !== 0) {
          return { ok: false, tag: tag, text: "签到失败: " + (res.msg || "code=" + res.code), signed: false };
        }
        var rewards = ((res.data && res.data.rewardList) || [])
          .map(function (r) { return r && r.rewardValue ? "+" + r.rewardValue + "N币" : ""; })
          .filter(Boolean).join(" ");
        return getStatus(acc).then(function (st2) {
          var newDays = Number(st2.consecutiveDays) || days + 1;
          return { ok: true, tag: tag, signed: true, text: "新签 | 连签 " + newDays + " 天" + (rewards ? " | " + rewards : "") };
        }, function (e) {
          log("warn", tag + " 签到成功但复核失败: " + e.message);
          return { ok: true, tag: tag, signed: true, text: "新签 | 连签 " + (days + 1) + " 天 | 复核失败" };
        });
      });
    }).catch(function (err) {
      log("error", tag + " " + err.message);
      // 实测：Token 失效时接口不返回 401，而是 {code!=0, msg:"系统错误"}，
      // 只能靠 code 存在与否给出方向性提示，不能假装能确诊。
      var hint = "";
      if (isAuthError(err)) hint = "（Token 可能已失效，请重新抓取）";
      else if (err && err.apiCode !== undefined) hint = "（接口返回异常，可能是 Token 失效或服务波动，先重抓 Token 再试）";
      else if (/timeout|超时|network|failed|ENOTFOUND|ECONNRESET/i.test(String(err && err.message))) {
        hint = "（网络层失败：检查客户端是否联网、节点是否可用，可加 Policy=DIRECT 强制直连）";
      }
      return { ok: false, tag: tag, signed: false, text: "失败: " + err.message + hint };
    });
  }

  function runSign() {
    var accounts = parseAccounts(store.get(STORE_KEY));
    if (!accounts.length) {
      notify(NAME, "未配置账号", "请打开九号出行 App 的签到页，触发一次 user-sign 请求以抓取 Token");
      log("warn", "账号表为空");
      return Promise.resolve({ exitCode: 1 });
    }

    var results = [];
    var chain = Promise.resolve();

    accounts.forEach(function (acc, i) {
      chain = chain.then(function () {
        var tag = CFG.showId ? maskId(acc.deviceId) : "账号#" + (i + 1);
        log("info", "开始签到 " + tag);
        return signOne(acc, tag).then(function (r) {
          results.push(r);
          log(r.ok ? "info" : "error", tag + " → " + r.text);
          if (i < accounts.length - 1 && CFG.interval > 0) {
            return sleep(CFG.interval + Math.floor(Math.random() * 400));
          }
        });
      });
    });

    return chain.then(function () {
      var total = results.length;
      var ok = results.filter(function (r) { return r.ok; }).length;
      var fresh = results.filter(function (r) { return r.signed; }).length;
      var dup = ok - fresh;
      var failed = total - ok;
      var sub = "成功 " + ok + "/" + total + "（新签 " + fresh + " · 已签 " + dup + (failed ? " · 失败 " + failed : "") + "）";
      var body = results.map(function (r) { return r.tag + " " + r.text; }).join("\n");
      notify(NAME, sub, body);
      log("info", "汇总: " + sub);
      return { exitCode: failed > 0 ? 1 : 0 };
    });
  }

  /* ======================= 9. Token 抓取 ======================= */
  function passThrough() {
    // 修复点：QX 的 http-request 脚本必须回传 $request，$done({}) 有中断请求的风险
    if (PLATFORM === "Quantumult X") return $done($request);
    return $done({});
  }

  function handleCapture() {
    var url = ($request && $request.url) || "";
    if (!/user-sign/i.test(url)) {
      log("debug", "非签到接口，忽略: " + url);
      return passThrough();
    }
    var h = ($request && $request.headers) || {};
    var token = h.Authorization || h.authorization || "";
    var deviceId = h.device_id || h["device-id"] || h.Device_Id || h.DeviceId || "";

    if (!token || !deviceId) {
      log("warn", "缺少 Authorization 或 device_id，跳过");
      return passThrough();
    }

    var change = upsertAccount(deviceId, token);
    var masked = maskId(deviceId);
    if (change === "new") notify(NAME, "获取成功", "已保存新账号 " + masked);
    else if (change === "updated") notify(NAME, "获取成功", "Token 已更新 " + masked);
    else log("info", masked + " Token 未变化，跳过写入");

    return passThrough();
  }

  /* ======================= 10. 入口 ======================= */
  function main() {
    log("info", "运行环境: " + PLATFORM + " | retry=" + CFG.retry + " | timeout=" + TIMEOUT_VALUE +
      (TIMEOUT_IS_MS ? "ms" : "s") + " | policy=" + (CFG.policy || "默认"));

    if (typeof $request !== "undefined" && $request) {
      return handleCapture();
    }

    return runSign().then(function (r) {
      if (IS_NODE) {
        // 修复点：按实际结果给出退出码，cron / 监控才能正确判断
        process.exitCode = r.exitCode;
        return;
      }
      if (IS_PROXY) $done({});
    }).catch(function (err) {
      log("error", "未捕获异常: " + ((err && err.stack) || err));
      notify(NAME, "执行异常", String((err && err.message) || err));
      if (IS_NODE) process.exitCode = 1;
      else if (IS_PROXY) $done({});
    });
  }

  main();
})();
