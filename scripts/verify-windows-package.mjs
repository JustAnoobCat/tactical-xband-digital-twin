import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";
import { strict as assert } from "node:assert";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = join(root, "release");
const unpacked = join(release, "win-unpacked");
const archive = join(unpacked, "resources", "app.asar");
const installer = readdirSync(release)
  .filter((name) => name.endsWith(".exe") && name.includes("Setup"))
  .map((name) => join(release, name))
  .find((candidate) => statSync(candidate).isFile());

assert.ok(installer, `Missing NSIS installer in ${release}`);
assert.ok(statSync(installer).size > 1024 * 1024, "NSIS installer is unexpectedly small");
assert.ok(existsSync(archive), `Missing packaged app archive: ${archive}`);

const archiveFiles = asar.listPackage(archive);
const packagedPaths = archiveFiles.map((file) => file.replace(/^\/+/, ""));
const requiredPaths = [
  "package.json",
  "electron/main.cjs",
  "dist/index.html",
];
for (const requiredPath of requiredPaths) {
  assert.ok(packagedPaths.includes(requiredPath), `Missing packaged path: ${requiredPath}`);
}
assert.ok(packagedPaths.every((file) => !file.split("/").includes("..")),
  "Packaged paths must not contain parent-directory traversal");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(packageJson.main, "electron/main.cjs");
assert.ok(readdirSync(unpacked).includes("resources"), "Windows package has no resources directory");

console.log(`Verified NSIS installer: ${installer}`);
console.log(`Verified ${packagedPaths.length} paths in resources/app.asar`);
console.log("Windows installation was not executed on Fedora; validate the installer on Windows.");
