import { test, expect } from "./fixtures";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP_PROJECT = join(tmpdir(), "mk-test-env-parsing");

test.describe("Env Var Parsing - Comment Stripping", () => {
  test.beforeAll(() => {
    mkdirSync(join(TMP_PROJECT, "src", "main", "java"), { recursive: true });

    // Create a minimal pom.xml
    writeFileSync(join(TMP_PROJECT, "pom.xml"), `<project><modelVersion>4.0.0</modelVersion><groupId>test</groupId><artifactId>test</artifactId><version>1.0</version></project>`);

    // Create template.yaml with inline comments
    writeFileSync(join(TMP_PROJECT, "template.yaml"), `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Environment:
        Variables:
          VAULT_URL: http://vault:8200
          PAYMENT_URL: http://mockoon:8080  # mock server url
          APP_ENV: LOCAL # environment
          AUTH_URL: https://example.com/#/oauth  # has hash in URL
          PLAIN_VAR: some_value
`);
  });

  test.afterAll(() => {
    try { rmSync(TMP_PROJECT, { recursive: true, force: true }); } catch {}
  });

  test("analyze endpoint strips inline comments from SAM template vars", async ({ page }) => {
    const res = await page.request.post("http://localhost:3001/api/analyze", {
      data: { projectPath: TMP_PROJECT },
    });
    const data = await res.json();
    const envVars: Record<string, string> = data.environmentVariables || {};

    // Should strip comment after space+#
    expect(envVars["PAYMENT_URL"]).toBe("http://mockoon:8080");
    expect(envVars["APP_ENV"]).toBe("LOCAL");

    // Should NOT strip # that's part of URL (no space before #)
    expect(envVars["AUTH_URL"]).toBe("https://example.com/#/oauth");

    // Plain values unchanged
    expect(envVars["VAULT_URL"]).toBe("http://vault:8200");
    expect(envVars["PLAIN_VAR"]).toBe("some_value");
  });

  test("analyze endpoint strips inline comments from .env files", async ({ page }) => {
    // Remove template.yaml so it falls back to .env
    rmSync(join(TMP_PROJECT, "template.yaml"));

    // Create .env file with comments
    writeFileSync(join(TMP_PROJECT, ".env"), [
      "VAULT_URL=http://vault:8200",
      "SERVICE_URL=http://mockoon:8080  # mock server",
      "APP_MODE=debug # dev mode",
      "URL_WITH_HASH=http://example.com/#/path",
    ].join("\n"));

    const res = await page.request.post("http://localhost:3001/api/analyze", {
      data: { projectPath: TMP_PROJECT },
    });
    const data = await res.json();
    const envVars: Record<string, string> = data.environmentVariables || {};

    expect(envVars["SERVICE_URL"]).toBe("http://mockoon:8080");
    expect(envVars["APP_MODE"]).toBe("debug");
    expect(envVars["VAULT_URL"]).toBe("http://vault:8200");
    expect(envVars["URL_WITH_HASH"]).toBe("http://example.com/#/path");
  });
});
