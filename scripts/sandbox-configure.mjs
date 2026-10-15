// Points the running Browsby sandbox at the local gate (OpenAI-compatible) and
// gives it a placeholder key, same shape as the bench harness's buildConfig(). Not part of
// the extension; run manually after the sandbox service starts or restarts:
//   node scripts/sandbox-configure.mjs [devtoolsPort=9333] [model=qwen3.5-122b-a10b]
import { connectChrome } from "../src/chrome.js";
import { mergeConfig } from "../src/config-core.js";

const port = Number(process.argv[2]) || 9333;
const model = process.argv[3] || "qwen3.5-122b-a10b";
const cdp = await connectChrome({ devtoolsPort: port });
const { targetInfos } = await cdp.send("Target.getTargets");
const panel = targetInfos.find((t) => t.type === "page" && t.url.endsWith("/sidepanel.html"));
if (!panel) throw new Error("sidepanel not found - open the panel in the sandbox browser first");
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: panel.targetId, flatten: true });

const config = mergeConfig({
  provider: "openai",
  openaiBaseUrl: "http://127.0.0.1:8090/v1",
  keys: { openai: "local-placeholder" },
  models: { openai: model },
  guardModels: { openai: model },
  permissionMode: "guarded",
  thinking: false,
});
await cdp.send("Runtime.evaluate", { expression: `chrome.storage.local.set(${JSON.stringify({ config })})`, awaitPromise: true, returnByValue: true }, sessionId);
console.log(`sandbox configured: provider=openai model=${model} baseUrl=${config.openaiBaseUrl}`);
cdp.close();
