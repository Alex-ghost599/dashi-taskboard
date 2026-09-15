import { constants, openSync, closeSync, fstatSync, readSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";

function readBounded(file, limit, expected = null, verify = () => {}) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino)) throw new Error("SOURCE_CHANGED");
    verify();
    if (!stat.isFile() || stat.size > limit) throw new Error("FILE_LIMIT_OR_TYPE");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) throw new Error("FILE_LIMIT_OR_TYPE");
    const after = fstatSync(fd);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error("SOURCE_CHANGED");
    verify();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { closeSync(fd); }
}

export function readObsSnapshot(manifestFilename) {
  const manifest = JSON.parse(readBounded(path.resolve(manifestFilename), 2 * 1024 * 1024));
  if (typeof manifest.root !== "string" || !path.isAbsolute(manifest.root) || !Array.isArray(manifest.files) || manifest.files.length > 1000) throw new Error("INVALID_FILE_SCOPE");
  const root = realpathSync(manifest.root);
  let total = 0;
  const documents = manifest.files.map((file) => {
    if (typeof file !== "string" || !file.endsWith(".md") || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("INVALID_FILE_SCOPE");
    const candidate = path.resolve(root, file);
    const resolved = realpathSync(candidate);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("OUTSIDE_ROOT");
    const inspectPath = () => {
      let current = root;
      for (const component of path.relative(root, candidate).split(path.sep)) {
        current = path.join(current, component);
        if (lstatSync(current).isSymbolicLink()) throw new Error("SYMLINK_UNSUPPORTED");
      }
      if (realpathSync(candidate) !== resolved || realpathSync(root) !== root) throw new Error("SOURCE_CHANGED");
      return lstatSync(resolved);
    };
    const expected = inspectPath();
    const verify = () => {
      const current = inspectPath();
      if (current.dev !== expected.dev || current.ino !== expected.ino
        || current.size !== expected.size || current.mtimeMs !== expected.mtimeMs || current.ctimeMs !== expected.ctimeMs) throw new Error("SOURCE_CHANGED");
    };
    const markdown = readBounded(resolved, 1024 * 1024, expected, verify);
    total += Buffer.byteLength(markdown);
    if (total > 10 * 1024 * 1024) throw new Error("INPUT_LIMIT");
    return { path: file, markdown };
  });
  return { sourceRoot: root, documents, projects: manifest.projects, scope: manifest.scope, existing: manifest.existing ?? [] };
}
