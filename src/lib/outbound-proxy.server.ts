import { execFileSync } from "node:child_process";

let installing: Promise<void> | null = null;

function envProxy(): string | null {
  const raw =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  const value = raw?.trim();
  return value || null;
}

function systemProxy(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const text = execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 1000 });
    const httpsOn = /HTTPSEnable\s*:\s*1/.test(text);
    const httpOn = /HTTPEnable\s*:\s*1/.test(text);
    const host = (httpsOn ? text.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1] : undefined)
      ?? (httpOn ? text.match(/HTTPProxy\s*:\s*(\S+)/)?.[1] : undefined);
    const port = (httpsOn ? text.match(/HTTPSPort\s*:\s*(\d+)/)?.[1] : undefined)
      ?? (httpOn ? text.match(/HTTPPort\s*:\s*(\d+)/)?.[1] : undefined);
    if (!host || !port) return null;
    return `http://${host}:${port}`;
  } catch {
    return null;
  }
}

// Node 的 fetch 不会自动使用 macOS 系统代理。浏览器登录能通、本地接口校验失败时，
// 就是请求没走代理，TLS 被中途重置。
export function installOutboundProxy(): Promise<void> {
  if (!installing) installing = setup();
  return installing;
}

async function setup() {
  if (typeof process === "undefined" || !process.versions?.node) return;
  const fromEnv = envProxy();
  const proxy = fromEnv || systemProxy();
  if (!proxy) return;
  if (!fromEnv) {
    process.env.HTTPS_PROXY = proxy;
    process.env.HTTP_PROXY = proxy;
  }
  if (!process.env.NO_PROXY && !process.env.no_proxy) {
    process.env.NO_PROXY = "localhost,127.0.0.1,::1";
  }
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
