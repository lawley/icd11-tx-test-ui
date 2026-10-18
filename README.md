# ICD-11 TX Test Compare

Vite + React UI that runs [HL7 tx-ecosystem](https://github.com/HL7/fhir-tx-ecosystem-ig) test cases (default suite `icd-11`) against several FHIR terminology servers and compares the results with each other and with the expected responses.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # comparison engine unit tests
```

Test cases are fetched live from GitHub (repo/ref configurable in Settings). Servers, their runner modes and externals files are configurable too (stored in localStorage).

## How results are judged

Mirrors the Java runner (`validator_cli.jar txTests`), ported from `TxTester`, `TxTesterScrubbers`, `TxTesterSorters` and `CompareUtilities` in hapifhir/org.hl7.fhir.core:

- suite `setup` resources appended to each request as `tx-resource` (batch: first entry only); `profile` (default `parameters-default.json`), `lenient-display`, `Accept-Language`, `header`, `request:{mode}`/`response:{mode}` honoured
- FHIR version from `$versions` then `/metadata`; R4 responses converted to R5 (expansion property extensions)
- actual response scrubbed (meta, text, `issue.diagnostics`, unmanaged extensions) and sorted, then matched against the expected template: `$uuid$`, `$instant$`, `$choice:…$`, `$fragments:…$`, `$external:N:…$`, `$optional$`, `$only$`, `$optional-properties$`, `$count-arrays$`, `$version$`, etc.; mode/version filters use the server's modes
- `http-code` checked (`2xx` default)

Pass/fail matches the Java runner, but all differences are reported rather than only the first.

**Side by side** view flattens expected + every response into rows keyed by identity (parameter name, property code, concept code, issue severity/code, extension url) instead of array index, hides volatile fields (ids, timestamps, uuids, anything the expected marks with a type template) and highlights rows where servers disagree or deviate from expected.

## Network

`proxy.mjs` adds `/__proxy/<url>` to the dev/preview server: avoids CORS and http mixed content (tx.fhir.org), and sends no `Accept-Language` unless the test sets one — browsers always send one, and servers may echo it (e.g. a `displayLanguage` expansion parameter), causing spurious failures. Direct mode (Settings) skips the proxy, for static hosting. The proxy only serves same-origin `fetch` (navigations and cross-site requests get 403), serves non-JSON responses as `text/plain`, and is limited to the hosts in `PROXY_ALLOW_HOSTS` (see below).

## Deploy (Azure App Service)

`server.mjs` is a dependency-free Node server that serves `dist/` and the proxy (`pnpm build && pnpm start` to try it locally on :8080). The proxy only reaches the three default hosts; set `PROXY_ALLOW_HOSTS` (comma-separated, or `*`) to change that.

```sh
az login
APP=<unique-name> pnpm deploy:azure     # -> https://<unique-name>.azurewebsites.net
az group delete -n icd11-tx-ui-rg       # tear down when finished
```

Options (env): `RG` (default `icd11-tx-ui-rg`), `LOCATION` (`australiaeast`), `SKU` (`B1`), `RUNTIME` (`NODE:22-lts`). Redeploy by re-running. To allow another server's host:
`az webapp config appsettings set -g icd11-tx-ui-rg -n $APP --settings PROXY_ALLOW_HOSTS=host1,host2`

## License

Released into the public domain. See [LICENSE](LICENSE) (The Unlicense).
