import { ObjectNotFoundError, type ObjectStore } from "./store";

/** Objects kept in the process: tests and local development without S3 credentials. */
export function memoryStore(): ObjectStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(key, body) {
      objects.set(key, Buffer.from(body));
    },
    async get(key) {
      const body = objects.get(key);
      if (!body) throw new ObjectNotFoundError(key);
      return Buffer.from(body);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
