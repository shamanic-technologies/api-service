import { buildDocument, type DocumentAudience } from "./document.js";
import { isSelectionError, parseSelection, selectDocument, type SelectionError } from "./views.js";
import { catalogueBody, type CatalogueBody } from "../lib/catalogue-response.js";

/**
 * The catalogue a request asked for (`?view=`, `?tag=`, `?operation=`, see
 * views.ts), serialized once per (audience, selection) and cached: the registry
 * does not change while the process runs. The full document per audience is
 * built once and every slice is cut from it.
 */
const fullDocuments = new Map<DocumentAudience, Record<string, unknown>>();
const bodies = new Map<string, CatalogueBody>();
const MAX_CACHED_SLICES = 500;

export function catalogueFor(
  audience: DocumentAudience,
  query: Record<string, unknown>,
  full?: () => CatalogueBody,
): CatalogueBody | SelectionError {
  const selection = parseSelection(query);
  if (isSelectionError(selection)) return selection;
  const key = `${audience}|${JSON.stringify(selection)}`;
  const cached = bodies.get(key);
  if (cached) return cached;
  let body: CatalogueBody;
  if (selection.kind === "full" && full) {
    body = full();
  } else {
    let doc = fullDocuments.get(audience);
    if (!doc) {
      doc = buildDocument({ audience });
      fullDocuments.set(audience, doc);
    }
    const sliced = selectDocument(doc, selection);
    if (isSelectionError(sliced)) return sliced;
    body = catalogueBody(sliced);
  }
  if (bodies.size >= MAX_CACHED_SLICES) bodies.clear();
  bodies.set(key, body);
  return body;
}
