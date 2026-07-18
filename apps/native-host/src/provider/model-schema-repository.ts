import { readFile } from "node:fs/promises";
import { isAbsolute, join, win32 } from "node:path";

export type ModelOutputSchema = Record<string, unknown>;

export interface ModelSchemaRepositoryOptions {
  readSchema?: (path: string) => Promise<unknown>;
  schemaDirectory: string;
}

function isJsonObject(value: unknown): value is ModelOutputSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonSchema(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export class ModelSchemaRepository {
  readonly #readSchema: (path: string) => Promise<unknown>;
  readonly #schemaDirectory: string;
  readonly #schemas = new Map<string, Promise<ModelOutputSchema>>();

  constructor(options: ModelSchemaRepositoryOptions) {
    if (!isAbsolute(options.schemaDirectory) && !win32.isAbsolute(options.schemaDirectory)) {
      throw new TypeError("Model schema directory must be an absolute path.");
    }
    this.#readSchema = options.readSchema ?? readJsonSchema;
    this.#schemaDirectory = options.schemaDirectory;
  }

  load(filename: string): Promise<ModelOutputSchema> {
    if (!/^[a-z]+(?:-[a-z]+)*\.json$/u.test(filename)) {
      return Promise.reject(new TypeError("Invalid model schema filename."));
    }
    const cached = this.#schemas.get(filename);
    if (cached !== undefined) return cached;

    const pending = this.#readSchema(join(this.#schemaDirectory, filename)).then((schema) => {
      if (!isJsonObject(schema)) {
        throw new SyntaxError("Output schema must be a JSON object.");
      }
      return schema;
    });
    this.#schemas.set(filename, pending);
    return pending;
  }
}
