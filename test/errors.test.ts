import { describe, expect, it } from "vitest";
import { biliBizCode, classifyBiz, cliFailure, errorFromEnvelope, httpFailure } from "../src/errors.js";
import type { CliResult } from "../src/sdk/channels.js";

describe("B 站业务码归一", () => {
  it("从 message 提取 -352 / -509 / -101", () => {
    expect(biliBizCode("ResponseCodeException: 接口返回错误代码：-352，信息：-352。")).toBe("-352");
    expect(biliBizCode("错误码：-509")).toBe("-509");
    expect(biliBizCode("code: -101")).toBe("-101");
    expect(biliBizCode("没有业务码")).toBeUndefined();
  });

  it("已知业务码映射到 BILI_* 并带提示", () => {
    expect(classifyBiz("接口返回错误代码：-352")).toMatchObject({ code: "BILI_RISK_CONTROL" });
    expect(classifyBiz("错误码：-509")?.hint).toContain("稍后重试");
    expect(classifyBiz("未登录 -101")).toMatchObject({ code: "BILI_AUTH_REQUIRED" });
  });

  it("未知业务码不强行归一", () => {
    expect(classifyBiz("错误代码：-99999")).toBeUndefined();
  });
});

describe("errorFromEnvelope", () => {
  it("保留未知上游码与 message，并按 -352 识别风控", () => {
    const err = errorFromEnvelope({
      code: "BILI_ARTICLE_FAIL",
      message: "获取专栏失败：ResponseCodeException: 接口返回错误代码：-352，信息：-352。",
    }, "/article");

    expect(err.code).toBe("BILI_RISK_CONTROL");
    expect(err.message).toContain("-352");
    expect(err.detail).toMatchObject({
      upstreamCode: "BILI_ARTICLE_FAIL",
      bizCode: "-352",
    });
    expect(err.hint).toContain("出口 IP");
  });

  it("-509 给出限流提示", () => {
    const err = errorFromEnvelope({
      code: "BILI_ARTICLE_FAIL",
      message: "获取专栏失败：接口返回错误代码：-509，信息：请求过于频繁。",
    }, "/article");

    expect(err.code).toBe("BILI_RISK_CONTROL");
    expect(err.hint).toContain("稍后重试");
  });

  it("-101 归一为需要登录", () => {
    const err = errorFromEnvelope({
      code: "BILI_DETAIL_FAIL",
      message: "获取视频详情失败：接口返回错误代码：-101，信息：账号未登录。",
    }, "/detail");

    expect(err.code).toBe("BILI_AUTH_REQUIRED");
  });

  it("完全未知的上游码仍保留可诊断信息", () => {
    const err = errorFromEnvelope({
      code: "BILI_DETAIL_FAIL",
      message: "获取视频详情失败：upstream exploded",
    }, "/detail");

    expect(err.code).toBe("BILI_UNAVAILABLE");
    expect(err.message).toContain("upstream exploded");
    expect(err.detail).toMatchObject({
      upstreamCode: "BILI_DETAIL_FAIL",
      upstreamMessage: "获取视频详情失败：upstream exploded",
    });
  });
});

describe("httpFailure", () => {
  it("识别 HTTP 429 限流", () => {
    const err = httpFailure(429, undefined, "/article");
    expect(err.code).toBe("BILI_RISK_CONTROL");
    expect(err.hint).toContain("稍后重试");
  });

  it("信封错误走统一解析", () => {
    const err = httpFailure(200, {
      ok: false,
      error: { code: "BILI_DETAIL_FAIL", message: "接口返回错误代码：-412" },
    }, "/detail");
    expect(err.code).toBe("BILI_RISK_CONTROL");
    expect(err.detail).toMatchObject({ upstreamCode: "BILI_DETAIL_FAIL", bizCode: "-412" });
  });
});

describe("cliFailure", () => {
  const base: CliResult = {
    failed: true,
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "",
  };

  it("stderr 里的 -352 识别为风控并保留 stderr", () => {
    const err = cliFailure({ ...base, stderr: "接口返回错误代码：-352" }, "bili", "video info");
    expect(err.code).toBe("BILI_RISK_CONTROL");
    expect(err.detail).toMatchObject({ bizCode: "-352" });
    expect(err.detail?.upstreamMessage).toContain("-352");
  });
});
