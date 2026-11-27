export type OutboxItem = {
  attemptId: string;
  questionId: string;
  response: unknown;
  flagged: boolean;
  seq: number;
  elapsedMs: number;
  updatedAt: number;
};

export type ScratchpadItem = {
  attemptId: string;
  text: string;
  updatedAt: number;
};

const DATABASE_NAME = "examsys-offline";
const DATABASE_VERSION = 2;
const OUTBOX_STORE = "outbox";
const SCRATCHPAD_STORE = "scratchpad";
const ATTEMPT_INDEX = "by-attempt";

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support local answer storage."));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = database.createObjectStore(OUTBOX_STORE, {
            keyPath: ["attemptId", "questionId"],
          });
          store.createIndex(ATTEMPT_INDEX, "attemptId", { unique: false });
        }
        if (!database.objectStoreNames.contains(SCRATCHPAD_STORE)) {
          database.createObjectStore(SCRATCHPAD_STORE, { keyPath: "attemptId" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open local answer storage."));
      request.onblocked = () => reject(new Error("Local answer storage is blocked by another open tab."));
    });
    void databasePromise.catch(() => {
      databasePromise = null;
    });
  }

  return databasePromise;
}

export async function getScratchpadItem(attemptId: string): Promise<ScratchpadItem | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SCRATCHPAD_STORE, "readonly");
    const request = transaction.objectStore(SCRATCHPAD_STORE).get(attemptId);
    request.onsuccess = () => resolve(request.result as ScratchpadItem | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not read the scratchpad from this device."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Reading the scratchpad was interrupted."));
  });
}

export async function putScratchpadItem(item: ScratchpadItem): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SCRATCHPAD_STORE, "readwrite");
    transaction.objectStore(SCRATCHPAD_STORE).put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the scratchpad on this device."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving the scratchpad was interrupted."));
  });
}

export async function deleteScratchpadItem(attemptId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SCRATCHPAD_STORE, "readwrite");
    transaction.objectStore(SCRATCHPAD_STORE).delete(attemptId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear the scratchpad on this device."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Clearing the scratchpad was interrupted."));
  });
}

export async function putOutboxItem(item: OutboxItem): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    transaction.objectStore(OUTBOX_STORE).put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save your answer on this device."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Saving your answer on this device was interrupted."));
  });
}

export async function getAttemptOutbox(attemptId: string): Promise<OutboxItem[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const request = transaction.objectStore(OUTBOX_STORE).index(ATTEMPT_INDEX).getAll(attemptId);
    request.onsuccess = () => resolve(request.result as OutboxItem[]);
    request.onerror = () => reject(request.error ?? new Error("Could not read locally saved answers."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Reading local answers was interrupted."));
  });
}

export async function deleteOutboxItemIfCurrent(item: OutboxItem): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const store = transaction.objectStore(OUTBOX_STORE);
    const request = store.get([item.attemptId, item.questionId]);
    request.onsuccess = () => {
      const current = request.result as OutboxItem | undefined;
      if (current?.seq === item.seq) store.delete([item.attemptId, item.questionId]);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not update the local answer queue."));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not update the local answer queue."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Updating the local answer queue was interrupted."));
  });
}
