import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { certNames, certPaths, httpsName } from "./https.js";

// A throwaway self-signed test certificate (no private key here) for hemma.example.org.
const PEM = `-----BEGIN CERTIFICATE-----
MIIBvDCCAWGgAwIBAgIUMpmvfpRZ5IP4YCEmN9HE8y7gOMswCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRaGVtbWEuZXhhbXBsZS5vcmcwHhcNMjYxMDIzMTQwMjMzWhcN
MzYxMDIwMTQwMjMzWjAcMRowGAYDVQQDDBFoZW1tYS5leGFtcGxlLm9yZzBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABJwjRyypVuy4UqyJpwOhDfKa4Y9syT11JmI/
UAdDm4SkpVuHOxFRuCOWkxVdt0YFf8CFcX/1zSk6dch9eU1CJx6jgYAwfjAdBgNV
HQ4EFgQUSitC0Br093pkb2jkppg4K+fHuE0wHwYDVR0jBBgwFoAUSitC0Br093pk
b2jkppg4K+fHuE0wDwYDVR0TAQH/BAUwAwEB/zArBgNVHREEJDAighFoZW1tYS5l
eGFtcGxlLm9yZ4INKi5leGFtcGxlLm9yZzAKBggqhkjOPQQDAgNJADBGAiEAlO0i
Y8adVzbcmcXrVxpCXZGAOHZhJwnNUF7xvZO+ENcCIQCOwit7ymnUjekxozYN4+To
6LoCx6lC9BDixODV53J+6w==
-----END CERTIFICATE-----`;

describe("https", () => {
  it("reads the address the certificate is for, not wildcards", () => {
    expect(certNames(PEM)).toEqual(["hemma.example.org"]);
    expect(certNames("inte ett certifikat")).toEqual([]);
  });

  it("uses Home Assistant's /ssl files only when both exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "ssl-"));
    writeFileSync(join(dir, "fullchain.pem"), PEM);
    expect(certPaths({ SSL_CERT: join(dir, "fullchain.pem"), SSL_KEY: join(dir, "privkey.pem") })).toBeNull();
    writeFileSync(join(dir, "privkey.pem"), "x");
    expect(certPaths({ SSL_CERT: join(dir, "fullchain.pem"), SSL_KEY: join(dir, "privkey.pem") })).toEqual({ cert: join(dir, "fullchain.pem"), key: join(dir, "privkey.pem") });
  });
});

// A throwaway self-signed certificate (no key kept) for two sites, the other one listed first: like a home server whose
// Let's Encrypt certificate also covers a work domain.
const MULTI = `-----BEGIN CERTIFICATE-----
MIIBwDCCAWWgAwIBAgIUPJbY3V/drFQKLMbjRfD99C5RFjQwCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRaGVtbWEuZXhhbXBsZS5vcmcwHhcNMjYxMTEzMDczMTI5WhcN
MzYxMTEwMDczMTI5WjAcMRowGAYDVQQDDBFoZW1tYS5leGFtcGxlLm9yZzBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABPRhdKv2Pyl0FG8SCXx0zrGDCblgf3NUq0Nc
N5JBj2LJ051zeKwdu264InlXtR/CZjv9/y2Ja6kYNO4VQkxG9VmjgYQwgYEwHQYD
VR0OBBYEFItsilz17z+2161aEWPgQ2twqpehMB8GA1UdIwQYMBaAFItsilz17z+2
161aEWPgQ2twqpehMA8GA1UdEwEB/wQFMAMBAf8wLgYDVR0RBCcwJYIQam9iYi5l
eGFtcGxlLmNvbYIRaGVtbWEuZXhhbXBsZS5vcmcwCgYIKoZIzj0EAwIDSQAwRgIh
AO01f34CG8IgiCd7VNVlwXlPLq7llCMFCZKFfrLfzQDjAiEAj9FcyFG3bdoz89XB
KwRFDfeA7j4B1UuGNdT1h6e5oHY=
-----END CERTIFICATE-----`;

describe("https address shown on the tablet", () => {
  it("is the certificate's own name, not the first other name", () => {
    expect(certNames(MULTI)).toEqual(["jobb.example.com", "hemma.example.org"]);
    expect(httpsName(MULTI, {})).toBe("hemma.example.org");
  });
  it("HTTPS_HOST wins when set", () => {
    expect(httpsName(MULTI, { HTTPS_HOST: "jobb.example.com" })).toBe("jobb.example.com");
    expect(httpsName(MULTI, { HTTPS_HOST: "inte ok/väg" })).toBe("hemma.example.org");
  });
});
