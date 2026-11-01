/** Where user files live (OVH Object Storage in dev and prod). Keys look like `users/<userId>/<uuid>.webp`. */
export type ObjectStore = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Throws `ObjectNotFoundError` when the key does not exist. */
  get(key: string): Promise<Buffer>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
};

export class ObjectNotFoundError extends Error {
  override readonly name = "ObjectNotFoundError";
  constructor(readonly key: string) {
    super("object not found");
  }
}
