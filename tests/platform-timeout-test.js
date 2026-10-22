/**
 * 回归测试：各平台 $httpClient 的 timeout 单位
 *
 * 背景：v1.1.0 统一按「秒」传 timeout，但 Loon / QX 的 $httpClient 收的是「毫秒」，
 *       结果 Timeout=10 被当成 10ms，100% 超时（LNHTTPClientDomain Code=1）。
 *
 * 做法：在 Node 里伪造各平台的全局对象，让脚本认为自己跑在 Loon / Surge / QX 上，
 *       然后断言实际传给 $httpClient / $task.fetch 的 timeout 数值。
 *
 * 用法：node tests/platform-timeout-test.js
 */
const path = require("path");
const SCRIPT = path.join(__dirname, "..", "ninebot-sign.js");

const OK_BODY = JSON.stringify({ code: 0, data: { currentSignStatus: 1, consecutiveDays: 5 } });

async function simulate(setup) {
  delete require.cache[require.resolve(SCRIPT)];

  const captured = {};
  const respond = (cb) => cb(null, { status: 200, headers: {} }, OK_BODY);

  global.$httpClient = {
    get: (opts, cb) => { captured.last = opts; respond(cb); },
    post: (opts, cb) => { captured.last = opts; respond(cb); },
  };
  global.$task = { fetch: (req) => { captured.last = req; return Promise.resolve({ statusCode: 200, body: OK_BODY, headers: {} }); } };
  global.$persistentStore = { read: () => "aaaa1111bbbb2222cccc3333dddd4444:tok", write: () => true };
  global.$prefs = { valueForKey: () => "aaaa1111bbbb2222cccc3333dddd4444:tok", setValueForKey: () => true };
  global.$notification = { post: () => {} };
  global.$notify = () => {};
  global.$done = () => {};
  global.$argument = "";

  // 先清干净平台探测用的全局变量
  ["$loon", "$task", "$rocket", "Egern", "$environment"].forEach((k) => delete global[k]);

  setup(global, (obj) => { captured.last = obj; });

  require(SCRIPT);
  await new Promise((r) => setTimeout(r, 80)); // 等 promise 链跑完
  return captured;
}

function check(name, cond, extra) {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  " + extra));
  return cond ? 0 : 1;
}

(async () => {
  let failed = 0;

  // Loon：$httpClient timeout 单位是毫秒 → 10 秒应传 10000
  let r = await simulate((g) => { g.$loon = () => {}; });
  failed += check("Loon   Timeout=10 → 10000 (毫秒)", r.last && r.last.timeout === 10000, JSON.stringify(r.last && r.last.timeout));

  // Surge：$httpClient timeout 单位是秒 → 10 秒应传 10
  r = await simulate((g) => { g.$environment = { "surge-version": "5.0.0" }; });
  failed += check("Surge  Timeout=10 → 10    (秒)  ", r.last && r.last.timeout === 10, JSON.stringify(r.last && r.last.timeout));

  // Quantumult X：$task.fetch 收毫秒
  r = await simulate((g, rec) => {
    g.$task = { fetch: (req) => { rec(req); return Promise.resolve({ statusCode: 200, body: OK_BODY, headers: {} }); } };
  });
  failed += check("QX     Timeout=10 → 10000 (毫秒)", r.last && r.last.timeout === 10000, JSON.stringify(r.last && r.last.timeout));

  // Stash：秒
  r = await simulate((g) => { g.$environment = { "stash-version": "1.0.0" }; });
  failed += check("Stash  Timeout=10 → 10    (秒)  ", r.last && r.last.timeout === 10, JSON.stringify(r.last && r.last.timeout));

  // Policy 参数映射：Loon 用 node，Surge 用 policy，Stash 用 header
  r = await simulate((g) => { g.$loon = () => {}; g.$argument = "Policy=DIRECT"; });
  failed += check("Loon   Policy → node=DIRECT", r.last && r.last.node === "DIRECT", JSON.stringify(r.last && r.last.node));

  r = await simulate((g) => { g.$environment = { "surge-version": "5.0.0" }; g.$argument = "Policy=DIRECT"; });
  failed += check("Surge  Policy → policy=DIRECT", r.last && r.last.policy === "DIRECT", JSON.stringify(r.last && r.last.policy));

  r = await simulate((g) => { g.$environment = { "stash-version": "1.0.0" }; g.$argument = "Policy=DIRECT"; });
  failed += check("Stash  Policy → X-Stash-Selected-Proxy", r.last && r.last.headers && r.last.headers["X-Stash-Selected-Proxy"] === "DIRECT", JSON.stringify(r.last && r.last.headers));

  console.log(failed === 0 ? "\n全部通过" : "\n有 " + failed + " 项失败");
  process.exitCode = failed === 0 ? 0 : 1;

  // 扫尾：清掉伪造的全局，避免影响同进程的其他测试
  ["$loon", "$task", "$rocket", "Egern", "$environment", "$httpClient", "$persistentStore", "$prefs", "$notification", "$notify", "$done", "$argument"].forEach((k) => delete global[k]);
})();
