/** 三个后端共用的失败映射：CLI 信封、CLI 退出码、HTTP 状态与信封都收敛到 BiliError。 */

import { BiliError, type BiliErrorCode, type CliResult } from "./types.js";
import { asRecord, str } from "./json.js";

const AUTH_ALIASES = new Set([
  "not_logged_in",
  "not_authenticated",
  "auth_expired",
  "login_pending",
  "login_expired",
  "auth_required",
  "BILI_AUTH_REQUIRED",
]);

const RISK_ALIASES = new Set([
  "risk_control",
  "captcha_required",
  "rate_limited",
  "risk",
  "BILI_RISK_CONTROL",
]);

const KNOWN: ReadonlySet<string> = new Set([
  "BILI_UNAVAILABLE",
  "BILI_AUTH_REQUIRED",
  "BILI_CAPABILITY_UNSUPPORTED",
  "BILI_RISK_CONTROL",
  "BILI_INVALID_URL",
]);

/** B 站接口业务码（常见于 `ResponseCodeException` / `-352` 之类文本）。 */
const BIZ_HINTS: Readonly<Record<string, { code: BiliErrorCode; hint: string }>> = {
  "-101": {
    code: "BILI_AUTH_REQUIRED",
    hint: "运行 bili auth login 扫码登录，或为 article 后端配置 BILI_COOKIE / BILI_COOKIE_FILE",
  },
  "-352": {
    code: "BILI_RISK_CONTROL",
    hint: "可更换出口 IP 或配置登录态 Cookie 后重试",
  },
  "-412": {
    code: "BILI_RISK_CONTROL",
    hint: "可更换出口 IP 或稍后重试",
  },
  "-509": {
    code: "BILI_RISK_CONTROL",
    hint: "B 站限流（-509），请稍后重试",
  },
  "-799": {
    code: "BILI_RISK_CONTROL",
    hint: "B 站请求过于频繁（-799），请稍后重试",
  },
};

export interface BiliBizError {
  bizCode: string;
  code: BiliErrorCode;
  hint: string;
}

/** 把外部错误码归一成 BILI_*；认不出的返回 undefined。 */
export function normalizeCode(raw: string | undefined): BiliErrorCode | undefined {
  if (!raw) return undefined;
  if (AUTH_ALIASES.has(raw)) return "BILI_AUTH_REQUIRED";
  if (RISK_ALIASES.has(raw)) return "BILI_RISK_CONTROL";
  return KNOWN.has(raw) ? (raw as BiliErrorCode) : undefined;
}

/** 从 message / stderr 里提取 B 站业务码；优先匹配“错误代码：-352”，否则取 -NNN。 */
export function biliBizCode(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const labeled = /(?:错误代码|错误码|error\s*code|code)\s*[：:=]?\s*(-?\d{1,6})\b/i.exec(text)?.[1];
  const raw = labeled ? (labeled.startsWith("-") ? labeled : `-${labeled}`) : /-\d{3,6}\b/.exec(text)?.[0];
  return raw && raw !== "-0" ? raw : undefined;
}

/** 只归一已知业务码，未知码留给调用方保留原始 code/message。 */
export function classifyBiz(text: string | undefined): BiliBizError | undefined {
  const bizCode = biliBizCode(text);
  if (!bizCode) return undefined;
  const known = BIZ_HINTS[bizCode];
  return known ? { bizCode, ...known } : undefined;
}

function detailOf(input: { upstreamCode?: string; upstreamMessage?: string; bizCode?: string }): Record<string, unknown> | undefined {
  const detail: Record<string, unknown> = {};
  if (input.upstreamCode) detail.upstreamCode = input.upstreamCode;
  if (input.upstreamMessage) detail.upstreamMessage = input.upstreamMessage;
  if (input.bizCode) detail.bizCode = input.bizCode;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

/** 解析 {"code","message","hint"} 形式的错误体。 */
export function errorFromEnvelope(raw: unknown, what: string): BiliError {
  const body = asRecord(raw) ?? {};
  const upstreamCode = str(body, "code");
  const message = str(body, "message") ?? str(body, "msg") ?? `${what} 失败`;
  const biz = classifyBiz(message);
  const code = normalizeCode(upstreamCode) ?? biz?.code ?? "BILI_UNAVAILABLE";
  const hint = str(body, "hint") ?? biz?.hint;
  return new BiliError(
    code,
    message,
    hint,
    detailOf({ upstreamCode, upstreamMessage: message, bizCode: biz?.bizCode }),
  );
}

/** CLI 失败：先看 spawn 错误与超时，再看 stderr 里的登录/风控特征。 */
export function cliFailure(result: CliResult, command: string, what: string): BiliError {
  if (result.spawnError === "ENOENT") {
    return new BiliError(
      "BILI_UNAVAILABLE",
      `spawn ${command} ENOENT`,
      `安装 ${command} 或修改 bilibili 配置里的命令路径`,
    );
  }
  if (result.timedOut) {
    return new BiliError("BILI_UNAVAILABLE", `${what}：命令超时（${command}）`);
  }
  const stderr = result.stderr.trim().slice(-300);
  const biz = classifyBiz(stderr);
  if (biz) {
    const message = stderr ? `${what}：${stderr}` : `${what}：B 站返回 ${biz.bizCode}`;
    return new BiliError(
      biz.code,
      message,
      biz.hint,
      detailOf({ upstreamMessage: stderr, bizCode: biz.bizCode }),
    );
  }
  const probe = stderr.toLowerCase();
  if (/login|not_logged|未登录|-101/.test(probe)) {
    return new BiliError(
      "BILI_AUTH_REQUIRED",
      `${what}：需要登录`,
      stderr || undefined,
      detailOf({ upstreamMessage: stderr }),
    );
  }
  if (/412|403|risk|风控|验证码/.test(probe)) {
    return new BiliError(
      "BILI_RISK_CONTROL",
      `${what}：被 B 站风控拦截`,
      stderr || undefined,
      detailOf({ upstreamMessage: stderr }),
    );
  }
  return new BiliError(
    "BILI_UNAVAILABLE",
    `${what}：${command} 退出码 ${result.exitCode ?? "unknown"}${stderr ? `（${stderr}）` : ""}`,
    undefined,
    detailOf({ upstreamMessage: stderr }),
  );
}

/** HTTP 失败：状态码优先，其次后端信封里的业务码。 */
export function httpFailure(status: number, body: unknown, what: string): BiliError {
  if (status === 401 || status === 403) {
    return new BiliError(
      "BILI_AUTH_REQUIRED",
      `${what}：HTTP ${status}`,
      undefined,
      detailOf({ upstreamMessage: `${what}：HTTP ${status}` }),
    );
  }
  if (status === 412) {
    return new BiliError(
      "BILI_RISK_CONTROL",
      `${what}：HTTP 412`,
      "可更换出口 IP 或稍后重试",
      detailOf({ upstreamMessage: `${what}：HTTP 412` }),
    );
  }
  if (status === 429) {
    return new BiliError(
      "BILI_RISK_CONTROL",
      `${what}：HTTP 429`,
      "B 站限流，请稍后重试",
      detailOf({ upstreamMessage: `${what}：HTTP 429` }),
    );
  }
  const envelope = asRecord(body);
  if (envelope?.ok === false) return errorFromEnvelope(envelope.error, what);
  if (envelope && ("code" in envelope || "message" in envelope || "msg" in envelope)) {
    return errorFromEnvelope(envelope, what);
  }
  const message = `${what}：HTTP ${status}`;
  return new BiliError("BILI_UNAVAILABLE", message, undefined, detailOf({ upstreamMessage: message }));
}
