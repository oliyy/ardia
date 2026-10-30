import { useEffect } from "react";
import { emptyCounts, type ImportKind } from "../../state/import/apply";
import { useExtensionInstalls } from "../../state/import/extensions";
import { importSafariDirect, importSafariExport } from "../../state/import/fileImports";
import { backTo, chooseSource, closeImport, setImportKinds, setWithExtensions, type ImportFlow } from "../../state/import/flow";
import { continueImport, skipEncryptedData, unlockAndImport } from "../../state/import/runImport";
import { devRegister } from "../dev/devRegister";

export function useImportDevHandle(flow: ImportFlow) {
  const installs = useExtensionInstalls((s) => s.list);
  useEffect(() => {
    const { step } = flow;
    const done = step.name === "done" ? step : null;
    return devRegister("acImport", null, {
      select: (id: string) => {
        const b = flow.browsers.find((x) => x.id === id);
        if (b) chooseSource(b);
        return !!b;
      },
      next: continueImport,
      back: () => backTo("choose"),
      unlock: unlockAndImport,
      skipEncrypted: skipEncryptedData,
      importSafariDirect,
      importSafari: importSafariExport,
      close: closeImport,
      kinds: [...flow.kinds],
      setKinds: (list: ImportKind[]) => setImportKinds(list),
      counts: done?.counts ?? emptyCounts(),
      failures: done?.failures ?? [],
      installs,
      withExtensions: flow.withExtensions,
      setWithExtensions,
      notes: done?.notes ?? [],
      step: step.name,
      error: "error" in step ? step.error : null,
      status: step.name === "progress" ? step.status : {},
      preparing: step.name === "progress" ? step.preparing : 1,
      source: flow.source?.id ?? null,
      sourceProfiles: flow.sourceProfiles,
      spaces: flow.spaces,
      fullDiskAccess: flow.fullDiskAccess,
    });
  });
}
