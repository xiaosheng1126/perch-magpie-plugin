import { PerchAuthPlugin } from "./index.mjs";

async function run() {
  console.log("== Testing Perch AI Magpie Plugin ==");
  const plugin = await PerchAuthPlugin();

  // 1. Test Config
  const cfg = {};
  await plugin.config(cfg);
  console.log("✔ Config initialized:", Object.keys(cfg.provider));

  // 2. Test Auth Authorize
  const authMethod = plugin.auth.methods[0];
  console.log("Testing auth method:", authMethod.label);
  const authRes = await authMethod.authorize();
  if (authRes.type !== "success") {
    console.error("❌ Auth failed:", authRes.error);
    process.exit(1);
  }
  console.log("✔ Auth success, user metadata:", authRes.metadata);

  // 3. Test Models
  const models = await plugin.provider.models(cfg.provider["perch"], { auth: { key: authRes.key } });
  console.log("✔ Models registered:", Object.keys(models));
  for (const [id, m] of Object.entries(models)) {
    console.log(`   - ${id}: ${m.name} (free: ${m.free}, rate: ${m.rate})`);
  }

  // 4. Test Usage / Quota
  const usage = await plugin.auth.usage(async () => ({ key: authRes.key }));
  console.log("✔ Usage retrieved:");
  console.log(`   Plan: ${usage.plan}, User: ${usage.user}`);
  for (const w of usage.windows) {
    console.log(`   [${w.name}] Used: ${w.used}% | ${w.display}${w.resetsAt ? ` | Resets: ${w.resetsAt}` : ""}`);
  }

  console.log("🎉 Perch plugin core features tested successfully!");
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
