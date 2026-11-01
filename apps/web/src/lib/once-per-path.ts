/** `true` the first time a path is seen after a different one: guards against React strict mode's double effect. */
export function createOncePerPath() {
  let last: string | null = null;
  return (path: string): boolean => {
    if (last === path) return false;
    last = path;
    return true;
  };
}
