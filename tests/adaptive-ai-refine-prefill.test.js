const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function expectText(text, message) {
  if (!text.includes(message)) throw new Error(`Missing ${message}`);
}

expectText(app, "function prefillAiAssistantRefineControls", "adaptive refine prefill function");
expectText(app, "filters.area || filters.district", "AI location prefill");
expectText(app, "filters.bedrooms", "AI bedroom prefill");
expectText(app, "filters.max_price", "AI budget prefill");
expectText(app, "filters.property_type", "AI property type prefill");
expectText(app, "filters.transaction_type", "AI transaction prefill");
expectText(app, "prefillAiAssistantRefineControls(responseData", "assistant response prefill invocation");
expectText(app, "rent-max-price-custom-f", "custom rent budget fallback");
expectText(app, "student-budget-custom-f", "custom student budget fallback");
expectText(html, "adaptive-ai-refine-prefill-20260724", "release marker");

console.log("adaptive AI refine prefill checks passed");
