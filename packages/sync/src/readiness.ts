let localDataIsReady = false;
const waitingForLocalData = new Set<() => void>();

export const localDataReady = () => localDataIsReady;

export function markLocalDataReady() {
  if (localDataIsReady) return;
  localDataIsReady = true;
  const resumes = [...waitingForLocalData];
  waitingForLocalData.clear();
  for (const resume of resumes) resume();
}

export function whenLocalDataReady(resume: () => void) {
  if (localDataIsReady) resume();
  else waitingForLocalData.add(resume);
}
