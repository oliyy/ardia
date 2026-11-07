import { readDocument, writeDocument } from "../../platform/documents";
import { systemInfo } from "../../platform/app";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { hadSessionBeforeLaunch } from "../session/persist";

const DOC = "release-notes.json";
const DOC_VERSION = 1;
const DOC_MIGRATIONS: Migrations = { 0: unchanged };

function readLastVersion(): string | null {
  const doc = parseSaved(readDocument(DOC), DOC_VERSION, DOC_MIGRATIONS);
  return doc && typeof doc.lastVersion === "string" ? doc.lastVersion : null;
}

function saveLastVersion(lastVersion: string) {
  try {
    writeDocument(DOC, versionedJson({ lastVersion }, DOC_VERSION));
  } catch (error) {
    console.warn("Couldn't save release notes state", error);
  }
}

export function trackAppVersion(): boolean {
  const version = systemInfo().appVersion;
  if (!version) return false;
  const last = readLastVersion();
  const updated = last !== null ? last !== version : hadSessionBeforeLaunch();
  saveLastVersion(version);
  return updated;
}
