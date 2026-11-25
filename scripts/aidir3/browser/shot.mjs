// Headless Edge over CDP: set cookies, visit pages, save screenshots.
//   node shot.mjs <plan.json>
// plan: { port, width, height, cookies:[{name,value,domain,path}], steps:[{url, wait, out, eval, click, fullPage}] }
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// "%%ENV:NAME%%" in the plan is replaced with that environment variable, so a
// secret a step must type (an API key) never has to be written into the plan.
const plan = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/%%ENV:([A-Z0-9_]+)%%/g, (_, k) => JSON.stringify(process.env[k] ?? "").slice(1, -1)));
const port = plan.port ?? 9333;
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const profile = join(dirname(process.argv[2]), "..", "edge-profile-" + port);
mkdirSync(profile, { recursive: true });

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${plan.width ?? 1440},${plan.height ?? 900}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error("TIMEOUT"); try { edge.kill(); } catch {} process.exit(2); }, plan.timeout ?? 240000);

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("no CDP target");
}

const ws = new WebSocket(await target());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  else if (m.method === "Runtime.exceptionThrown") logs.push("[exception] " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400));
  else if (m.method === "Network.responseReceived" && m.params.response.status >= 400) logs.push(`[http ${m.params.response.status}] ${m.params.response.url.slice(0, 160)}`);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
// Present as an ordinary desktop browser: the aidir3 site's bot shield refuses
// anything that announces itself as headless.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
await send("Network.setUserAgentOverride", { userAgent: UA, acceptLanguage: "en-GB,en;q=0.9", platform: "Win32", userAgentMetadata: { brands: [{ brand: "Chromium", version: "130" }, { brand: "Microsoft Edge", version: "130" }, { brand: "Not?A_Brand", version: "99" }], fullVersion: "130.0.0.0", platform: "Windows", platformVersion: "15.0.0", architecture: "x86", model: "", mobile: false } });
await send("Emulation.setDeviceMetricsOverride", { width: plan.width ?? 1440, height: plan.height ?? 900, deviceScaleFactor: plan.scale ?? 1, mobile: false });
for (const c of plan.cookies ?? []) await send("Network.setCookie", { path: "/", ...c });
if (plan.localStorage) {
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{${Object.entries(plan.localStorage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})`).join(";")}}catch(e){}` });
}

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.exceptionDetails ? "EVAL ERROR: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) : r.result.value;
};

for (const step of plan.steps) {
  logs.length = 0;
  if (step.url) await send("Page.navigate", { url: step.url });
  await sleep(step.wait ?? 4000);
  if (step.waitFor) {
    for (let i = 0; i < (step.waitForTries ?? 60); i++) { if (await evaluate(`!!(${step.waitFor})`) === true) break; await sleep(500); }
  }
  if (step.eval) { const v = await evaluate(step.eval); console.log(`eval(${step.name ?? step.out ?? ""}):`, typeof v === "string" ? v.slice(0, 3000) : JSON.stringify(v)?.slice(0, 3000)); }
  if (step.after) await sleep(step.after);
  if (step.out) {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!step.fullPage });
    mkdirSync(dirname(step.out), { recursive: true });
    writeFileSync(step.out, Buffer.from(data, "base64"));
    console.log("saved", step.out, "url:", await evaluate("location.href"));
  }
  if (logs.length) console.log("  console:", [...new Set(logs)].slice(0, 8).join("\n           "));
}
clearTimeout(deadline);
try { await send("Browser.close"); } catch {}
setTimeout(() => { try { edge.kill(); } catch {} process.exit(0); }, 500);
