import { buildDocument } from "../src/openapi/document.js";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const document = buildDocument();

const outputFile = join(projectRoot, "openapi.json");
fs.writeFileSync(outputFile, JSON.stringify(document, null, 2));
console.log("✅ api-service openapi.json generated");
