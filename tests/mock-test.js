/* 本地 mock 验证：校验修复点，不依赖真实接口
 * 用法：node tests/mock-test.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "ninebot-sign.js");
const NODE = process.execPath;
const TMP = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const out = handler(req, body) || {};
        res.writeHead(out.status || 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.json === undefined ? {} : out.json));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

function runScript(port, extraArg) {
  const dataFile = path.join(TMP, "acc-" + port + ".dat");
  fs.writeFileSync(dataFile, "aabbccddeeff00112233445566778899:tok_test");
  return new Promise((resolve) => {
    const child = spawn(NODE, [SCRIPT], {
      cwd: TMP,
      env: Object.assign({}, process.env, {
        NINEBOT_ARG: `BaseUrl=http://127.0.0.1:${port}&LogLevel=debug&Retry=${extraArg.retry}&Interval=0`,
        NINEBOT_DATA: dataFile,
        NINEBOT_LOG: path.join(TMP, "test.log"),
      }),
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function check(name, cond, out) {
  console.log((cond ? "PASS  " : "FAIL  ") + name);
  if (!cond) console.log("---- 输出 ----\n" + out + "\n--------------");
  else console.log("      " + out.trim().split("\n").filter((l) => /INFO|ERROR|WARN|DEBUG/.test(l)).slice(-3).join("\n      "));
}

(async () => {
  /* A. 未签 → 签到成功 → 复核，奖励解析 */
  let calls = { status: 0, sign: 0, signed: false };
  let srv = await serve((req) => {
    if (req.url.indexOf("/status") >= 0) {
      calls.status++;
      return { json: { code: 0, data: { currentSignStatus: calls.signed ? 1 : 0, consecutiveDays: calls.signed ? 4 : 3 } } };
    }
    if (req.url.indexOf("/sign") >= 0) {
      calls.sign++;
      calls.signed = true;
      return { json: { code: 0, data: { rewardList: [{ rewardValue: 5 }] } } };
    }
  });
  let r = await runScript(srv.address().port, { retry: 0 });
  srv.close();
  check("A 新签流程 + N币解析", r.code === 0 && /新签 \| 连签 4 天 \| \+5N币/.test(r.out) && calls.sign === 1, r.out);

  /* B. currentSignStatus 返回字符串 "1"（原版会误判未签） */
  calls = { status: 0, sign: 0 };
  srv = await serve((req) => {
    if (req.url.indexOf("/status") >= 0) {
      calls.status++;
      return { json: { code: 0, data: { currentSignStatus: "1", consecutiveDays: "12" } } };
    }
    calls.sign++;
    return { json: { code: 0 } };
  });
  r = await runScript(srv.address().port, { retry: 0 });
  srv.close();
  check("B 字符串状态码不误签", r.code === 0 && /已签 \| 连签 12 天/.test(r.out) && calls.sign === 0, r.out);

  /* C. 5xx 重试后成功 */
  let hits = 0;
  srv = await serve((req) => {
    if (req.url.indexOf("/status") >= 0) {
      hits++;
      if (hits <= 2) return { status: 503, json: { code: 503 } };
      return { json: { code: 0, data: { currentSignStatus: 1, consecutiveDays: 9 } } };
    }
    return { json: { code: 0 } };
  });
  r = await runScript(srv.address().port, { retry: 2 });
  srv.close();
  check("C 503 重试 2 次后成功", r.code === 0 && hits === 3 && /已签 \| 连签 9 天/.test(r.out), r.out);

  /* D. 401 不重试，直接失败并退出码 1 */
  let hits401 = 0;
  srv = await serve(() => { hits401++; return { status: 401, json: { code: 401, msg: "未授权" } }; });
  r = await runScript(srv.address().port, { retry: 3 });
  srv.close();
  check("D 401 不重试 + 退出码 1", r.code === 1 && hits401 === 1 && /HTTP 401/.test(r.out), r.out);

  /* E. 多账号结果可辨识 */
  srv = await serve(() => ({ json: { code: 0, data: { currentSignStatus: 1, consecutiveDays: 5 } } }));
  const multi = path.join(TMP, "acc-multi.dat");
  fs.writeFileSync(multi, "aaaa1111bbbb2222cccc3333dddd4444:t1;eeee5555ffff6666aaaa7777bbbb8888:t2");
  r = await new Promise((resolve) => {
    const child = spawn(NODE, [SCRIPT], {
      cwd: TMP,
      env: Object.assign({}, process.env, {
        NINEBOT_ARG: `BaseUrl=http://127.0.0.1:${srv.address().port}&Interval=0`,
        NINEBOT_DATA: multi,
        NINEBOT_LOG: path.join(TMP, "test.log"),
      }),
    });
    let out = ""; child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
  srv.close();
  check("E 多账号逐条标识", r.code === 0 && /aaaa11…4444/.test(r.out) && /eeee55…8888/.test(r.out) && /成功 2\/2/.test(r.out), r.out);
})();
